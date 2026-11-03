// Earthquake Monitor explainer: a Cloudflare Worker that asks Claude to explain
// one USGS earthquake in plain English. The browser sends only an event id;
// the Worker fetches the facts from USGS itself, so the endpoint cannot be used
// as a general-purpose Claude proxy, and the API key never leaves Cloudflare.

import Anthropic from "@anthropic-ai/sdk";
import {
    EVENT_ID_PATTERN,
    SYSTEM_PROMPT,
    buildQuakeFacts,
    classifyCaller,
    toParagraphs
} from "./prompt.js";

const MODEL = "claude-opus-5-5";
const PROMPT_VERSION = "v2"; // bump to invalidate every cached explanation
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const USGS_DETAIL = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=";

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function json(body, status, origin, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status: status,
        headers: Object.assign(
            { "Content-Type": "application/json; charset=utf-8" },
            origin ? corsHeaders(origin) : {},
            extraHeaders || {}
        )
    });
}

async function fetchUsgsEvent(eventId) {
    const response = await fetch(USGS_DETAIL + encodeURIComponent(eventId), {
        headers: { "Accept": "application/geo+json, application/json" },
        cf: { cacheTtl: 300 }
    });
    if (response.status === 404 || response.status === 204) {
        return null;
    }
    if (!response.ok) {
        throw new Error("USGS responded " + response.status);
    }
    const feature = await response.json();
    return feature && feature.type === "Feature" ? feature : null;
}

async function askClaude(env, feature) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const message = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        // A ~140-word explanation of supplied facts is not a hard reasoning
        // task; low effort keeps latency popup-friendly.
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildQuakeFacts(feature) }]
    });

    if (message.stop_reason === "refusal") {
        return { refused: true, model: message.model };
    }
    const text = message.content
        .filter(function (block) { return block.type === "text"; })
        .map(function (block) { return block.text; })
        .join("\n\n");
    return {
        paragraphs: toParagraphs(text),
        model: message.model,
        truncated: message.stop_reason === "max_tokens",
        usage: message.usage
    };
}

async function handleExplain(request, env, ctx, origin) {
    const url = new URL(request.url);
    const eventId = (url.searchParams.get("id") || "").trim();
    if (!EVENT_ID_PATTERN.test(eventId)) {
        return json({ error: "Invalid event id." }, 400, origin);
    }

    // One explanation per event per USGS revision, shared by every visitor.
    const feature = await fetchUsgsEvent(eventId);
    if (!feature) {
        return json({ error: "USGS has no event with that id." }, 404, origin);
    }
    const updated = (feature.properties && feature.properties.updated) || 0;
    const cacheKey = new Request("https://explainer.cache/" + PROMPT_VERSION + "/" + eventId + "?u=" + updated);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
        const body = await hit.json();
        return json(Object.assign(body, { cached: true }), 200, origin);
    }

    // Only cache misses spend API credit, so only they count against the limit.
    if (env.EXPLAIN_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.EXPLAIN_LIMITER.limit({ key: ip });
        if (!success) {
            return json({ error: "Too many new explanations right now. Try again in a minute." }, 429, origin, { "Retry-After": "60" });
        }
    }

    let result;
    try {
        result = await askClaude(env, feature);
    } catch (error) {
        // 429 and 5xx/529 (overloaded) are transient; the SDK already retried twice.
        if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError
            || error instanceof Anthropic.APIConnectionError) {
            return json({ error: "Claude is busy. Try again shortly." }, 503, origin, { "Retry-After": "30" });
        }
        if (error instanceof Anthropic.AuthenticationError) {
            console.error("Explainer API key rejected");
            return json({ error: "The explainer is not configured." }, 500, origin);
        }
        if (error instanceof Anthropic.APIError) {
            console.error("Claude API error", error.status, error.message);
            return json({ error: "Claude could not explain this quake right now." }, 502, origin);
        }
        throw error;
    }

    if (result.refused || !result.paragraphs.length) {
        return json({ error: "Claude could not explain this quake." }, 502, origin);
    }

    const body = {
        id: eventId,
        title: feature.properties && feature.properties.title,
        paragraphs: result.paragraphs,
        model: result.model,
        generatedAt: new Date().toISOString()
    };
    console.log(JSON.stringify({ event: eventId, model: result.model, usage: result.usage, truncated: result.truncated }));
    if (!result.truncated) {
        ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + CACHE_SECONDS }
        })));
    }
    return json(Object.assign(body, { cached: false }), 200, origin);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Only /api/* reaches this code (run_worker_first); the site itself is
        // served straight from static assets.
        if (url.pathname !== "/api/explain") {
            return json({ error: "Not found." }, 404, null);
        }
        const caller = classifyCaller({
            origin: request.headers.get("Origin"),
            secFetchSite: request.headers.get("Sec-Fetch-Site")
        }, url.origin, env.ALLOWED_ORIGINS);
        if (!caller) {
            return json({ error: "Origin not allowed." }, 403, null);
        }
        // CORS headers only for allow-listed cross-origin callers.
        const origin = caller === "cross" ? request.headers.get("Origin") : null;
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
        }
        if (request.method !== "GET") {
            return json({ error: "Use GET." }, 405, origin);
        }
        try {
            return await handleExplain(request, env, ctx, origin);
        } catch (error) {
            console.error("Explainer failure", error && error.stack || error);
            return json({ error: "Something went wrong explaining this quake." }, 500, origin);
        }
    }
};
