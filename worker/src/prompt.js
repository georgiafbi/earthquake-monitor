// Pure helpers for the quake explainer: no network, no Workers APIs, so they
// can be unit-tested with plain `node --test`.

export const EVENT_ID_PATTERN = /^[a-z0-9]{4,40}$/i;

// Frozen system prompt. Keep it byte-stable: it is the cacheable prefix.
export const SYSTEM_PROMPT = `You explain individual earthquakes to curious members of the public who are looking at a live earthquake map. You are given the official USGS record for one event, and sometimes the USGS tectonic summary for the region.

Write three short paragraphs in plain English, about 140 words in total:
1. What happened: size, depth and place, with one everyday comparison that makes the magnitude and depth meaningful.
2. Why here: the tectonic setting (plates, faults, subduction) if the data supports it. If no tectonic summary is given, describe the setting only in general terms you are confident about for that region, or say the record does not include it.
3. What it means for people: likely shaking from the felt reports and intensity values, and whether aftershocks are typical for an event of this size.

Rules:
- For energy comparisons use the radiated energy figure given; do not calculate your own.
- Use only the facts given plus well-established general seismology. Never invent casualties, damage, building collapses or named towns that are not in the data.
- The USGS "tsunami" field equal to 1 only means the event is large enough and in an oceanic region where a tsunami is possible; it is not a warning. If it is 1, say people should check tsunami.gov or local authorities for official warnings. If it is 0, do not discuss tsunamis.
- If the event type is not "earthquake" (for example a quarry blast or explosion), say so in the first sentence and explain it accordingly.
- Plain text only: no markdown, no headings, no bullet points. Separate paragraphs with one blank line.`;

const FIELD_LIMIT = 6000;

function stripHtml(html) {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

// Mirrors getTectonicSummaryText() in the front end, minus DOMParser.
export function extractTectonicSummary(feature) {
    const products = feature && feature.properties && feature.properties.products;
    const generalText = products && products["general-text"];
    if (!Array.isArray(generalText)) {
        return "";
    }
    const ranked = generalText.slice().sort(function (a, b) {
        return Number(b.preferredWeight || 0) - Number(a.preferredWeight || 0)
            || Number(b.updateTime || 0) - Number(a.updateTime || 0);
    });
    for (const product of ranked) {
        const contents = product && product.contents ? Object.values(product.contents) : [];
        const match = contents.find(function (c) {
            return c && typeof c.bytes === "string" && /tectonic\s+summary/i.test(c.bytes);
        });
        if (match) {
            const text = stripHtml(match.bytes).replace(/^tectonic\s+summary\s*/i, "");
            // The summary is reference material, not the question. Regional
            // summaries are 1-4 KB; the cap only guards against a malformed feed.
            return text.length > FIELD_LIMIT ? text.slice(0, FIELD_LIMIT) : text;
        }
    }
    return "";
}

// Radiated energy from magnitude (Gutenberg-Richter: log10 E[J] = 1.5 M + 4.8),
// as tonnes of TNT. Computed here because models are unreliable at log math.
export function tntEquivalent(mag) {
    const m = Number(mag);
    if (!Number.isFinite(m)) {
        return null;
    }
    const tonnes = Math.pow(10, 1.5 * m + 4.8) / 4.184e9;
    if (tonnes >= 1e6) {
        return Number((tonnes / 1e6).toPrecision(2)).toLocaleString("en-US") + " million tonnes of TNT";
    }
    if (tonnes >= 1) {
        return Number(tonnes.toPrecision(2)).toLocaleString("en-US") + " tonnes of TNT";
    }
    return Number((tonnes * 1000).toPrecision(2)).toLocaleString("en-US") + " kg of TNT";
}

function line(label, value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return label + ": " + value;
}

// Builds the user message from a USGS event-detail GeoJSON Feature.
// Only server-fetched USGS data goes in; nothing the browser sent.
export function buildQuakeFacts(feature) {
    const p = (feature && feature.properties) || {};
    const coords = (feature && feature.geometry && feature.geometry.coordinates) || [];
    const lines = [
        line("Event id", feature && feature.id),
        line("Title", p.title),
        line("Event type", p.type),
        line("Magnitude", p.mag != null ? p.mag + (p.magType ? " (" + p.magType + ")" : "") : null),
        line("Approximate radiated energy", tntEquivalent(p.mag)),
        line("Depth (km)", coords[2] != null ? Number(coords[2]).toFixed(1) : null),
        line("Latitude, longitude", coords.length >= 2 ? Number(coords[1]).toFixed(3) + ", " + Number(coords[0]).toFixed(3) : null),
        line("Place", p.place),
        line("Time (UTC)", p.time ? new Date(Number(p.time)).toISOString() : null),
        line("Review status", p.status),
        line("Felt reports (Did You Feel It?)", p.felt),
        line("Max community intensity (CDI, MMI scale)", p.cdi),
        line("Max instrumental intensity (ShakeMap MMI)", p.mmi),
        line("PAGER alert level", p.alert),
        line("USGS tsunami flag", p.tsunami),
        line("USGS significance (0-1000+)", p.sig)
    ].filter(Boolean);

    const summary = extractTectonicSummary(feature);
    let text = "USGS event record:\n" + lines.join("\n");
    text += summary
        ? "\n\nUSGS tectonic summary for the region:\n" + summary
        : "\n\nNo USGS tectonic summary is available for this event.";
    return text + "\n\nExplain this event.";
}

// Turns the model's plain text into clean paragraphs for the client.
export function toParagraphs(text) {
    return String(text || "")
        .replace(/\r\n/g, "\n")
        .split(/\n\s*\n/)
        .map(function (para) {
            return para.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
        })
        .filter(Boolean);
}

export function isAllowedOrigin(origin, allowedList) {
    if (!origin) {
        return false;
    }
    return String(allowedList || "")
        .split(",")
        .map(function (o) { return o.trim(); })
        .filter(Boolean)
        .includes(origin);
}

// "same": the site's own page (browsers usually omit Origin on same-origin GETs,
// but always send Sec-Fetch-Site). "cross": an allow-listed other origin, which
// needs CORS headers. null: refuse. This is a courtesy gate against hotlinking,
// not security; the id-only input and the rate limit are the real guards.
export function classifyCaller(headers, selfOrigin, allowedList) {
    const origin = headers.origin || null;
    if (origin === selfOrigin || (!origin && headers.secFetchSite === "same-origin")) {
        return "same";
    }
    return isAllowedOrigin(origin, allowedList) ? "cross" : null;
}
