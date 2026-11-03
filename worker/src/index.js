// Earthquake Monitor Worker: serves the site (static assets) and two Claude endpoints.
//   /api/explain?id=EVENT                         plain-English explanation of one quake
//   /api/tutor?id=EVENT&q=&guess=&answer=&mode=    Quake Quest tutor for a wrong guess
// The browser sends only an event id plus fixed keywords; the Worker fetches the
// facts from USGS itself, so neither endpoint is a general-purpose Claude proxy,
// and the API key never leaves Cloudflare.

import Anthropic from "@anthropic-ai/sdk";
import {
    EVENT_ID_PATTERN,
    SYSTEM_PROMPT,
    TUTOR_SYSTEM_PROMPT,
    buildQuakeFacts,
    buildTutorMessage,
    classifyCaller,
    parseTutorParams,
    settleTutorAnswer,
    toParagraphs
} from "./prompt.js";

const MODEL = "claude-opus-5-5";
const PROMPT_VERSION = "v2";       // bump to invalidate every cached explanation
const TUTOR_PROMPT_VERSION = "t1"; // bump to invalidate every cached tutor answer
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

async function askClaude(env, system, userMessage) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const message = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        // Short explanations of supplied facts are not hard reasoning tasks;
        // low effort keeps latency popup-friendly.
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: system,
        messages: [{ role: "user", content: userMessage }]
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

// Shared by both endpoints: edge cache first (free for everyone), then the
// per-IP limit on new answers, then Claude; the answer is cached for 7 days.
async function cachedClaudeAnswer({ request, env, ctx, origin, cacheUrl, system, userMessage, body, log }) {
    const cacheKey = new Request(cacheUrl);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
        const cachedBody = await hit.json();
        return json(Object.assign(cachedBody, { cached: true }), 200, origin);
    }

    if (env.EXPLAIN_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.EXPLAIN_LIMITER.limit({ key: ip });
        if (!success) {
            return json({ error: "Too many new answers right now. Try again in a minute." }, 429, origin, { "Retry-After": "60" });
        }
    }

    let result;
    try {
        result = await askClaude(env, system, userMessage);
    } catch (error) {
        // 429 and 5xx/529 (overloaded) are transient; the SDK already retried twice.
        if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError
            || error instanceof Anthropic.APIConnectionError) {
            return json({ error: "Claude is busy. Try again shortly." }, 503, origin, { "Retry-After": "30" });
        }
        if (error instanceof Anthropic.AuthenticationError) {
            console.error("Claude API key rejected");
            return json({ error: "The explainer is not configured." }, 500, origin);
        }
        if (error instanceof Anthropic.APIError) {
            console.error("Claude API error", error.status, error.message);
            return json({ error: "Claude could not answer right now." }, 502, origin);
        }
        throw error;
    }

    if (result.refused || !result.paragraphs.length) {
        return json({ error: "Claude could not answer this one." }, 502, origin);
    }

    const out = Object.assign({}, body, {
        paragraphs: result.paragraphs,
        model: result.model,
        generatedAt: new Date().toISOString()
    });
    console.log(JSON.stringify(Object.assign({ model: result.model, usage: result.usage, truncated: result.truncated }, log)));
    if (!result.truncated) {
        ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(out), {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + CACHE_SECONDS }
        })));
    }
    return json(Object.assign(out, { cached: false }), 200, origin);
}

async function loadEvent(url, origin) {
    const eventId = (url.searchParams.get("id") || "").trim();
    if (!EVENT_ID_PATTERN.test(eventId)) {
        return { error: json({ error: "Invalid event id." }, 400, origin) };
    }
    const feature = await fetchUsgsEvent(eventId);
    if (!feature) {
        return { error: json({ error: "USGS has no event with that id." }, 404, origin) };
    }
    const updated = (feature.properties && feature.properties.updated) || 0;
    return { eventId, feature, updated };
}

async function handleExplain(request, env, ctx, origin) {
    const url = new URL(request.url);
    const ev = await loadEvent(url, origin);
    if (ev.error) return ev.error;
    // One explanation per event per USGS revision, shared by every visitor.
    return cachedClaudeAnswer({
        request, env, ctx, origin,
        cacheUrl: "https://explainer.cache/" + PROMPT_VERSION + "/" + ev.eventId + "?u=" + ev.updated,
        system: SYSTEM_PROMPT,
        userMessage: buildQuakeFacts(ev.feature),
        body: { id: ev.eventId, title: ev.feature.properties && ev.feature.properties.title },
        log: { route: "explain", event: ev.eventId }
    });
}

async function handleTutor(request, env, ctx, origin) {
    const url = new URL(request.url);
    const asked = parseTutorParams(url.searchParams);
    if (!asked) {
        return json({ error: "Invalid tutor question." }, 400, origin);
    }
    const ev = await loadEvent(url, origin);
    if (ev.error) return ev.error;
    const req = settleTutorAnswer(asked, ev.feature);
    if (req.answer === req.guess) {
        return json({ error: "That guess was right, so there's nothing to explain." }, 400, origin);
    }
    return cachedClaudeAnswer({
        request, env, ctx, origin,
        cacheUrl: "https://tutor.cache/" + TUTOR_PROMPT_VERSION + "/" + ev.eventId + "/" + req.q + "/"
            + encodeURIComponent(req.guess) + "/" + encodeURIComponent(req.answer) + "/" + req.mode + "?u=" + ev.updated,
        system: TUTOR_SYSTEM_PROMPT,
        userMessage: buildTutorMessage(ev.feature, req),
        body: { id: ev.eventId, q: req.q, answer: req.answer },
        log: { route: "tutor", event: ev.eventId, q: req.q, mode: req.mode }
    });
}

const ROUTES = { "/api/explain": handleExplain, "/api/tutor": handleTutor };

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Only /api/* reaches this code (run_worker_first); the site itself is
        // served straight from static assets.
        const handler = ROUTES[url.pathname];
        if (!handler) {
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
            return await handler(request, env, ctx, origin);
        } catch (error) {
            console.error("Worker failure", url.pathname, error && error.stack || error);
            return json({ error: "Something went wrong. Try again." }, 500, origin);
        }
    }
};
