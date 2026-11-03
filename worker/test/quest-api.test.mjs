import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEntry, settleEntry, xpCeiling, depthClassOf, QUEST_SCHEMA } from "../src/quest-api.js";

const now = Date.now();

test("log entries: only known keywords, a real-looking id and a sane time", () => {
    assert.deepEqual(cleanEntry({ id: "us7000tuxy", k: "depth", g: "deep", a: "shallow", t: now }),
        { id: "us7000tuxy", k: "depth", g: "deep", a: "shallow", t: now });
    assert.equal(cleanEntry({ id: "us7000tuxy", k: "depth", g: "very deep", a: "deep", t: now }), null, "unknown guess");
    assert.equal(cleanEntry({ id: "../etc", k: "depth", g: "deep", a: "deep", t: now }), null, "bad id");
    assert.equal(cleanEntry({ id: "us7000tuxy", k: "poem", g: "a", a: "b", t: now }), null, "unknown question");
    assert.equal(cleanEntry({ id: "us7000tuxy", k: "energy", g: "x1", a: "x1", t: now + 3600e3 }), null, "from the future");
    assert.equal(cleanEntry({ id: "us7000tuxy", k: "energy", g: "x1", a: "x1", t: Date.UTC(2020, 0, 1) }), null, "too old");
    assert.equal(cleanEntry(null), null);
});

test("depth and energy answers are re-checked; boundary answers are kept as reported", () => {
    const deep = { geometry: { coordinates: [-178, -18, 560] } };
    const claimedRight = settleEntry({ id: "a1b2", k: "depth", g: "shallow", a: "shallow", t: now }, deep);
    assert.equal(claimedRight.a, "deep");
    assert.equal(claimedRight.ok, 0, "a false 'shallow was right' is corrected by USGS");
    assert.equal(claimedRight.checked, 1);
    assert.equal(settleEntry({ id: "a1b2", k: "energy", g: "x32", a: "x32", t: now }, null).ok, 0, "energy truth is always x1");
    const b = settleEntry({ id: "a1b2", k: "boundary", g: "transform", a: "transform", t: now }, null);
    assert.equal(b.ok, 1);
    assert.equal(b.checked, 0, "boundary answers are marked unchecked");
    assert.equal(depthClassOf(70), "intermediate");
});

test("leaderboard XP is capped by what has been logged", () => {
    assert.equal(xpCeiling(0, 0), 375 + 350, "one-off categories and badges only");
    assert.equal(xpCeiling(10, 2), 250 + 725 + 240);
    assert.ok(xpCeiling(100, 5) < 100000, "a hand-edited 100,000 XP save can't top the board");
});

test("the shared tables match what the Airship Dash admin page reads", () => {
    const sql = QUEST_SCHEMA.join("\n");
    for (const col of ["quest_saves", "player_id", "data", "xp", "updated", "quest_log", "event_id", "kind", "guess", "answer", "ok", "checked"]) {
        assert.ok(sql.includes(col), col);
    }
});
