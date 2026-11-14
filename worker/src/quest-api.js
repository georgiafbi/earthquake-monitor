// Quake Quest accounts: cloud save, activity log and leaderboard for Emberkite gamer tags.
// Tags, PINs and device tokens belong to the shared player database (bhalo-scores, also used
// by Bhalo's Airship Dash, whose API creates tags and signs devices in). This module only
// checks a device token the same way (SHA-256 of a 48-hex token) and keeps Quake Quest's
// own tables. All routes are POST with a JSON body.
//
//   POST /api/quest/load   {token}                       the cloud save
//   POST /api/quest/save   {token, data}                 store the cloud save
//   POST /api/quest/log    {token, entries: [...]}       record predictions (up to 25 per call)
//   POST /api/quest/board  {token?}                      top 20 by XP, and your place

// keep in step with QUEST_SCHEMA in bhalo-airship-dash/functions/api/[[path]].js (its admin page reads these)
export const QUEST_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS quest_saves (player_id INTEGER PRIMARY KEY, data TEXT NOT NULL, xp INTEGER NOT NULL, updated INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS quest_log (player_id INTEGER NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL, guess TEXT NOT NULL,
     answer TEXT NOT NULL, ok INTEGER NOT NULL, checked INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (player_id, event_id))`,
    `CREATE INDEX IF NOT EXISTS quest_log_time ON quest_log (player_id, t DESC)`
];

export const SAVE_MAX_BYTES = 64000;
export const LOG_PER_CALL = 25;
export const LOG_KEEP = 5000;            // newest predictions kept per player
// Energy keys say how far a choice is from the true energy; "x1" is always the truth. The game
// offers four of the seven per quake (ENERGY_LADDERS in quest-data.js), so the truth is not
// always the same rung. Keep in step with ENERGY_STEPS there and TUTOR_KEYS in prompt.js.
const KINDS = {
    depth: ["shallow", "intermediate", "deep"],
    boundary: ["subduction", "collision", "divergent", "transform", "intraplate"],
    energy: ["x1/32000", "x1/1000", "x1/32", "x1", "x32", "x1000", "x32000"]
};
const EVENT_ID = /^[a-z0-9]{4,40}$/i;

// Highest XP a player can plausibly have, given what the server has logged for them
// (see XP in quest-data.js): 20 + 5 streak bonus per prediction, the 26 Field Guide
// categories (15 each) and 14 badges (25 each) once, and 3 missions (40 each) a day.
export function xpCeiling(predictions, activeDays) {
    return 25 * predictions + 26 * 15 + 14 * 25 + 120 * activeDays;
}

export function depthClassOf(km) {
    const d = Number(km);
    if (!Number.isFinite(d) || d < 70) return "shallow";
    return d < 300 ? "intermediate" : "deep";
}

// one logged prediction from the browser -> a row, or null if malformed
export function cleanEntry(e) {
    if (!e || typeof e !== "object") return null;
    const id = String(e.id || "");
    const keys = KINDS[e.k];
    if (!EVENT_ID.test(id) || !keys || !keys.includes(e.g) || !keys.includes(e.a)) return null;
    const t = Number(e.t);
    if (!Number.isFinite(t) || t < Date.UTC(2026, 0, 1) || t > Date.now() + 5 * 60 * 1000) return null;
    return { id: id, k: e.k, g: e.g, a: e.a, t: Math.floor(t) };
}

// Depth and energy answers are re-checked against USGS; boundary answers come from the
// game's own plate map (kept as reported, marked unchecked).
export function settleEntry(entry, feature) {
    if (entry.k === "depth" && feature) {
        const coords = (feature.geometry && feature.geometry.coordinates) || [];
        const answer = depthClassOf(coords[2]);
        return Object.assign({}, entry, { a: answer, ok: entry.g === answer ? 1 : 0, checked: 1 });
    }
    if (entry.k === "energy") return Object.assign({}, entry, { a: "x1", ok: entry.g === "x1" ? 1 : 0, checked: 1 });
    return Object.assign({}, entry, { ok: entry.g === entry.a ? 1 : 0, checked: 0 });
}

let ready = false;
async function ensureTables(db) {
    if (ready) return;
    await db.batch(QUEST_SCHEMA.map(function (s) { return db.prepare(s); }));
    ready = true;
}

async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

// the same check Airship Dash makes: a 48-hex device token, stored only hashed
export async function playerFor(db, token) {
    if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return null;
    return db.prepare("SELECT p.id, p.tag FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = ?")
        .bind(await sha256(token)).first();
}

function respond(body, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
}
const fail = function (status, error) { return respond({ error: error }, status); };

async function taggedPlayer(db, body) {
    const p = await playerFor(db, body && body.token);
    if (!p) return { error: fail(401, "Sign in with your gamer tag first.") };
    if (!p.tag) return { error: fail(403, "Claim a gamer tag first.") };
    return { player: p };
}

async function loadSave(db, body) {
    const who = await taggedPlayer(db, body);
    if (who.error) return who.error;
    const row = await db.prepare("SELECT data, updated FROM quest_saves WHERE player_id = ?").bind(who.player.id).first();
    let data = null;
    try { data = row ? JSON.parse(row.data) : null; } catch (e) { data = null; }
    return respond({ tag: who.player.tag, data: data, updated: row ? row.updated : null });
}

async function storeSave(db, body) {
    const who = await taggedPlayer(db, body);
    if (who.error) return who.error;
    const data = body.data;
    if (!data || typeof data !== "object" || data.v !== 1) return fail(400, "Bad save.");
    const text = JSON.stringify(data);
    if (text.length > SAVE_MAX_BYTES) return fail(413, "Save too large.");
    const xp = Math.max(0, Math.floor(Number(data.xp) || 0));
    await db.prepare("INSERT INTO quest_saves (player_id, data, xp, updated) VALUES (?, ?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET data = excluded.data, xp = excluded.xp, updated = excluded.updated")
        .bind(who.player.id, text, xp, Date.now()).run();
    return respond({ ok: true });
}

async function logPredictions(db, body, fetchEvent) {
    const who = await taggedPlayer(db, body);
    if (who.error) return who.error;
    const raw = Array.isArray(body.entries) ? body.entries.slice(0, LOG_PER_CALL) : [];
    const entries = raw.map(cleanEntry).filter(Boolean);
    if (!entries.length) return respond({ ok: true, logged: 0 });
    // re-check depth answers against USGS (in parallel; a failed lookup keeps the entry unchecked)
    const settled = await Promise.all(entries.map(async function (e) {
        let feature = null;
        if (e.k === "depth") { try { feature = await fetchEvent(e.id); } catch (err) { feature = null; } }
        const s = settleEntry(e, feature);
        if (e.k === "depth" && !feature) { s.a = e.a; s.ok = e.g === e.a ? 1 : 0; s.checked = 0; }
        return s;
    }));
    const pid = who.player.id;
    await db.batch(settled.map(function (s) {
        return db.prepare("INSERT OR IGNORE INTO quest_log (player_id, event_id, kind, guess, answer, ok, checked, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(pid, s.id, s.k, s.g, s.a, s.ok, s.checked, s.t);
    }).concat([
        // keep the newest LOG_KEEP per player
        db.prepare("DELETE FROM quest_log WHERE player_id = ? AND event_id NOT IN (SELECT event_id FROM quest_log WHERE player_id = ? ORDER BY t DESC LIMIT ?)")
            .bind(pid, pid, LOG_KEEP)
    ]));
    return respond({ ok: true, logged: settled.length, results: settled.map(function (s) { return { id: s.id, ok: !!s.ok, checked: !!s.checked }; }) });
}

async function leaderboard(db, body) {
    const me = body && body.token ? await playerFor(db, body.token) : null;
    const { results } = await db.prepare(`SELECT p.id, p.tag, s.xp,
            (SELECT COUNT(*) FROM quest_log l WHERE l.player_id = p.id) AS predictions,
            (SELECT SUM(ok) FROM quest_log l WHERE l.player_id = p.id) AS right_,
            (SELECT COUNT(DISTINCT t / 86400000) FROM quest_log l WHERE l.player_id = p.id) AS days
        FROM quest_saves s JOIN players p ON p.id = s.player_id
        WHERE p.tag IS NOT NULL AND (p.tester IS NULL OR p.tester = 0)`).all();
    const rows = results.map(function (r) {
        const predictions = r.predictions || 0;
        return {
            id: r.id, tag: r.tag,
            xp: Math.min(r.xp, xpCeiling(predictions, r.days || 0)),   // capped by what's been logged
            predictions: predictions,
            accuracy: predictions ? Math.round(100 * (r.right_ || 0) / predictions) : null
        };
    }).filter(function (r) { return r.predictions > 0; })
        .sort(function (a, b) { return b.xp - a.xp || b.predictions - a.predictions; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    const mine = me ? rows.find(function (r) { return r.id === me.id; }) || null : null;
    return respond({
        top: rows.slice(0, 20).map(function (r) { return { rank: r.rank, tag: r.tag, xp: r.xp, predictions: r.predictions, accuracy: r.accuracy, you: !!(me && r.id === me.id) }; }),
        you: mine ? { rank: mine.rank, xp: mine.xp, predictions: mine.predictions, accuracy: mine.accuracy } : null,
        players: rows.length
    });
}

// route: "load" | "save" | "log" | "board"; fetchEvent(id) -> USGS GeoJSON feature or null
export async function handleQuestApi(route, request, env, fetchEvent) {
    if (!env.DB) return fail(503, "Player accounts aren't set up yet.");
    if (request.method !== "POST") return fail(405, "Use POST.");
    let body;
    try { body = await request.json(); } catch (e) { return fail(400, "Bad request."); }
    if (!body || typeof body !== "object") return fail(400, "Bad request.");
    await ensureTables(env.DB);
    if (route === "load") return loadSave(env.DB, body);
    if (route === "save") return storeSave(env.DB, body);
    if (route === "log") return logPredictions(env.DB, body, fetchEvent);
    if (route === "board") return leaderboard(env.DB, body);
    return fail(404, "Not found.");
}
