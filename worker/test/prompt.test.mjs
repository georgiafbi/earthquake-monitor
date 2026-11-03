import { test } from "node:test";
import assert from "node:assert/strict";
import {
    EVENT_ID_PATTERN,
    buildQuakeFacts,
    extractTectonicSummary,
    classifyCaller,
    isAllowedOrigin,
    toParagraphs,
    tntEquivalent
} from "../src/prompt.js";

const feature = {
    type: "Feature",
    id: "us7000abcd",
    geometry: { type: "Point", coordinates: [142.37, 38.29, 29.0] },
    properties: {
        title: "M 6.1 - 80 km E of Ishinomaki, Japan",
        type: "earthquake",
        mag: 6.1,
        magType: "mww",
        place: "80 km E of Ishinomaki, Japan",
        time: Date.UTC(2026, 9, 31, 12, 0, 0),
        status: "reviewed",
        felt: 212,
        cdi: 5.4,
        mmi: 6.2,
        alert: "green",
        tsunami: 1,
        sig: 700,
        products: {
            "general-text": [
                { preferredWeight: 1, updateTime: 1, contents: { "a.html": { bytes: "<h2>Other text</h2><p>Not this.</p>" } } },
                { preferredWeight: 5, updateTime: 2, contents: { "b.html": { bytes: "<h2>Tectonic Summary</h2><p>The Pacific &amp; Okhotsk plates converge at the Japan Trench.</p>" } } }
            ]
        }
    }
};

test("event id pattern accepts USGS ids and rejects junk", () => {
    assert.ok(EVENT_ID_PATTERN.test("us7000abcd"));
    assert.ok(EVENT_ID_PATTERN.test("ci40123456"));
    assert.ok(!EVENT_ID_PATTERN.test("../etc"));
    assert.ok(!EVENT_ID_PATTERN.test("us7000abcd&format=xml"));
    assert.ok(!EVENT_ID_PATTERN.test(""));
});

test("tectonic summary is found, stripped and unescaped", () => {
    assert.equal(extractTectonicSummary(feature), "The Pacific & Okhotsk plates converge at the Japan Trench.");
    assert.equal(extractTectonicSummary({ properties: {} }), "");
});

test("facts include the key fields and the summary", () => {
    const facts = buildQuakeFacts(feature);
    assert.match(facts, /Magnitude: 6\.1 \(mww\)/);
    assert.match(facts, /Depth \(km\): 29\.0/);
    assert.match(facts, /USGS tsunami flag: 1/);
    assert.match(facts, /Time \(UTC\): 2026-10-31T12:00:00\.000Z/);
    assert.match(facts, /Japan Trench/);
});

test("missing fields are left out rather than printed as undefined", () => {
    const facts = buildQuakeFacts({ id: "nc1234", geometry: { coordinates: [-122, 37, 8] }, properties: { mag: 2.1, place: "Somewhere" } });
    assert.doesNotMatch(facts, /undefined|null/);
    assert.match(facts, /No USGS tectonic summary/);
});

test("paragraph cleanup drops markdown and blank lines", () => {
    assert.deepEqual(toParagraphs("## What happened\n**A** quake.\n\n\nWhy  here.\r\n\r\nPeople."), ["What happened A quake.", "Why here.", "People."]);
    assert.deepEqual(toParagraphs(""), []);
});

test("TNT equivalent follows Gutenberg-Richter", () => {
    assert.equal(tntEquivalent(6.2), "30,000 tonnes of TNT");
    assert.equal(tntEquivalent(9.0), "480 million tonnes of TNT");
    assert.equal(tntEquivalent(2.0), "15 kg of TNT");
    assert.equal(tntEquivalent("x"), null);
    assert.match(buildQuakeFacts(feature), /Approximate radiated energy: \d/);
});

test("origin allow-list is exact", () => {
    const list = "https://georgiafbi.github.io, http://localhost:3000";
    assert.ok(isAllowedOrigin("https://georgiafbi.github.io", list));
    assert.ok(isAllowedOrigin("http://localhost:3000", list));
    assert.ok(!isAllowedOrigin("https://georgiafbi.github.io.evil.com", list));
    assert.ok(!isAllowedOrigin(null, list));
});

test("same-origin pages are allowed even without an Origin header", () => {
    const self = "https://quakes.example.com";
    const list = "http://localhost:3000";
    assert.equal(classifyCaller({ origin: null, secFetchSite: "same-origin" }, self, list), "same");
    assert.equal(classifyCaller({ origin: self, secFetchSite: "same-origin" }, self, list), "same");
    assert.equal(classifyCaller({ origin: "http://localhost:3000", secFetchSite: "cross-site" }, self, list), "cross");
    assert.equal(classifyCaller({ origin: "https://hotlinker.example", secFetchSite: "cross-site" }, self, list), null);
    assert.equal(classifyCaller({ origin: null, secFetchSite: null }, self, list), null);
    assert.equal(classifyCaller({ origin: null, secFetchSite: "cross-site" }, self, list), null);
});
