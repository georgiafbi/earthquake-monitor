// Explain and the tutor need an Emberkite tag (X-Emberkite-Token header), while
// their answers stay cached once for every player: the token is never in a cache key.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker, { TOKEN_HEADER, explainCacheUrl, tutorCacheUrl } from "../src/index.js";

const SITE = "https://quakes.emberkitegames.com";
const GOOD = "a".repeat(48);           // a tagged player's device token
const UNTAGGED = "b".repeat(48);       // a device that never claimed a tag
const OTHER = "c".repeat(48);          // a second tagged player
const hash = (t) => createHash("sha256").update(t).digest("hex");

// the shared player database: tokens are stored only hashed
const players = {
    [hash(GOOD)]: { id: 1, tag: "Seismo" },
    [hash(UNTAGGED)]: { id: 2, tag: null },
    [hash(OTHER)]: { id: 3, tag: "Rift" }
};
const DB = {
    prepare() {
        return { bind(h) { return { first: async () => players[h] || null }; } };
    }
};
const env = { DB, ALLOWED_ORIGINS: "http://localhost:3000" };
const ctx = { waitUntil() {} };

const quake = {
    type: "Feature", id: "us7000abcd",
    geometry: { type: "Point", coordinates: [142.37, 38.29, 29] },
    properties: { title: "M 6.1 - off Japan", mag: 6.1, place: "off Japan", time: Date.UTC(2026, 9, 31), updated: 1700000000000 }
};

let cacheKeys;
let usgsCalls;
beforeEach(() => {
    cacheKeys = [];
    usgsCalls = 0;
    // every answer is already cached, so Claude is never called
    globalThis.caches = {
        default: {
            match: async (req) => {
                cacheKeys.push(req);
                return new Response(JSON.stringify({ id: "us7000abcd", paragraphs: ["Cached for everyone."] }));
            },
            put: async () => {}
        }
    };
    globalThis.fetch = async () => {
        usgsCalls++;
        return new Response(JSON.stringify(quake), { status: 200 });
    };
});

function call(path, headers) {
    return worker.fetch(new Request(SITE + path, {
        headers: Object.assign({ "Sec-Fetch-Site": "same-origin" }, headers || {})
    }), env, ctx);
}
const EXPLAIN = "/api/explain?id=us7000abcd";
const TUTOR = "/api/tutor?id=us7000abcd&q=depth&guess=deep&answer=shallow&mode=cadet";

test("explain and tutor without a token: 401 with a short message, and nothing is looked up", async () => {
    for (const path of [EXPLAIN, TUTOR]) {
        const r = await call(path);
        assert.equal(r.status, 401, path);
        assert.match((await r.json()).error, /Emberkite tag/);
    }
    assert.equal(usgsCalls, 0, "no USGS fetch before the tag check");
    assert.equal(cacheKeys.length, 0, "no cache read before the tag check");
});

test("a bad, unknown or tagless token is refused too", async () => {
    for (const token of ["not-a-token", "d".repeat(48), UNTAGGED]) {
        const r = await call(EXPLAIN, { [TOKEN_HEADER]: token });
        assert.equal(r.status, 401, token);
    }
});

test("the token in the URL does not count: only the header does", async () => {
    const r = await call(EXPLAIN + "&token=" + GOOD);
    assert.equal(r.status, 401);
});

test("with a valid tag token, explain and tutor pass the gate", async () => {
    const e = await call(EXPLAIN, { [TOKEN_HEADER]: GOOD });
    assert.equal(e.status, 200);
    const body = await e.json();
    assert.deepEqual(body.paragraphs, ["Cached for everyone."]);
    assert.equal(body.cached, true);
    const t = await call(TUTOR, { [TOKEN_HEADER]: GOOD });
    assert.equal(t.status, 200);
});

test("the cache key is the same for every player and never holds the token", async () => {
    await call(EXPLAIN, { [TOKEN_HEADER]: GOOD });
    await call(EXPLAIN, { [TOKEN_HEADER]: OTHER });
    await call(TUTOR, { [TOKEN_HEADER]: GOOD });
    await call(TUTOR, { [TOKEN_HEADER]: OTHER });
    assert.equal(cacheKeys.length, 4);
    assert.equal(cacheKeys[0].url, cacheKeys[1].url, "two players share one cached explanation");
    assert.equal(cacheKeys[2].url, cacheKeys[3].url, "and one cached tutor answer");
    assert.equal(cacheKeys[0].url, explainCacheUrl("us7000abcd", quake.properties.updated));
    assert.equal(cacheKeys[2].url, tutorCacheUrl("us7000abcd", { q: "depth", guess: "deep", answer: "shallow", mode: "cadet" }, quake.properties.updated));
    for (const req of cacheKeys) {
        assert.ok(!req.url.includes(GOOD) && !req.url.includes(OTHER), "no token in the key URL");
        assert.equal(req.headers.get(TOKEN_HEADER), null, "no token header on the key request");
    }
});

test("allowed localhost callers may send the token header (CORS preflight)", async () => {
    const pre = await worker.fetch(new Request(SITE + EXPLAIN, {
        method: "OPTIONS",
        headers: { "Origin": "http://localhost:3000", "Access-Control-Request-Headers": "x-emberkite-token" }
    }), env, ctx);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
    assert.match(pre.headers.get("Access-Control-Allow-Headers"), /X-Emberkite-Token/i);

    const refused = await worker.fetch(new Request(SITE + EXPLAIN, { headers: { "Origin": "http://localhost:3000" } }), env, ctx);
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000", "the 401 is readable cross-origin");

    const ok = await worker.fetch(new Request(SITE + EXPLAIN, { headers: { "Origin": "http://localhost:3000", [TOKEN_HEADER]: GOOD } }), env, ctx);
    assert.equal(ok.status, 200);

    const stranger = await worker.fetch(new Request(SITE + EXPLAIN, { headers: { "Origin": "https://example.com", [TOKEN_HEADER]: GOOD } }), env, ctx);
    assert.equal(stranger.status, 403, "other origins are still refused");
});
