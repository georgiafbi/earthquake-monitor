// Converts Peter Bird's PB2002_steps.dat (5,819 digitization steps, 7 boundary
// classes) into the app's plates-data.js GeoJSON, keeping plate names from the
// existing file. Usage: node build-plates.js <steps.dat.txt> <old plates-data.js> <out plates-data.js>
"use strict";
const fs = require("fs");
const [stepsPath, oldPath, outPath] = process.argv.slice(2);

// ---- plate code -> name, from the current file's "(AF-AN)" names
const sandbox = { window: {} };
require("vm").runInNewContext(fs.readFileSync(oldPath, "utf8"), sandbox);
const oldJson = sandbox.window.tectonicPlatesGeoJSON;
const plateNames = {};
for (const f of oldJson.features) {
    const p = f.properties;
    const m = /\(([A-Z]{2})[-/\\]([A-Z]{2})\)/.exec(p.name || "");
    if (m && p.plateA && p.plateB) { plateNames[m[1]] = p.plateA; plateNames[m[2]] = p.plateB; }
}

// ---- the 7 PB2002 classes (Bird 2003, G3 4(3) 1027)
const CLASSES = {
    SUB: { kind: "convergent", type: "Convergent (Subduction / Trench)", label: "Subduction zone" },
    OCB: { kind: "convergent", type: "Convergent (Collision)", label: "Oceanic convergent boundary" },
    CCB: { kind: "convergent", type: "Convergent (Collision)", label: "Continental collision boundary" },
    OSR: { kind: "divergent", type: "Divergent (Spreading Ridge / Rift)", label: "Oceanic spreading ridge" },
    CRB: { kind: "divergent", type: "Divergent (Spreading Ridge / Rift)", label: "Continental rift" },
    OTF: { kind: "transform", type: "Transform / Strike-slip Fault", label: "Oceanic transform fault" },
    CTF: { kind: "transform", type: "Transform / Strike-slip Fault", label: "Continental transform fault" }
};

// ---- parse steps
const steps = [];
for (const line of fs.readFileSync(stepsPath, "utf8").split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 15) continue;
    const boundary = t[1].replace(/^:/, "");
    const cls = t[t.length - 1].replace(/^:/, "");
    const code = cls.replace("*", "");
    if (!CLASSES[code]) throw new Error("Unknown class " + cls + " in: " + line);
    steps.push({
        boundary,
        code,
        orogen: cls.endsWith("*"),
        a: [+t[2], +t[3]],
        b: [+t[4], +t[5]],
        km: +t[6],
        rate: +t[8] // relative plate velocity, mm/a
    });
}

// ---- group consecutive connected steps of one boundary and class into lines
const r3 = n => Math.round(n * 1000) / 1000;
const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
const runs = [];
let cur = null;
for (const s of steps) {
    const crossesDateLine = Math.abs(s.a[0] - s.b[0]) > 180;
    const joins = cur && cur.boundary === s.boundary && cur.code === s.code && cur.orogen === s.orogen
        && same(cur.coords[cur.coords.length - 1], s.a) && !crossesDateLine;
    if (!joins) {
        cur = { boundary: s.boundary, code: s.code, orogen: s.orogen, coords: [s.a], km: 0, rateKm: 0 };
        runs.push(cur);
    }
    if (crossesDateLine) {
        // split at the antimeridian so the line doesn't wrap the whole globe
        const lonB = s.b[0] + (s.a[0] > 0 ? 360 : -360);
        const f = (Math.sign(s.a[0]) * 180 - s.a[0]) / (lonB - s.a[0]);
        const latX = s.a[1] + f * (s.b[1] - s.a[1]);
        cur.coords.push([Math.sign(s.a[0]) * 180, latX]);
        cur.km += s.km * f; cur.rateKm += s.rate * s.km * f;
        cur = { boundary: s.boundary, code: s.code, orogen: s.orogen, coords: [[-Math.sign(s.a[0]) * 180, latX]], km: 0, rateKm: 0 };
        runs.push(cur);
        cur.coords.push(s.b); cur.km += s.km * (1 - f); cur.rateKm += s.rate * s.km * (1 - f);
        continue;
    }
    cur.coords.push(s.b);
    cur.km += s.km; cur.rateKm += s.rate * s.km;
}

// ---- features
const features = runs.filter(r => r.coords.length >= 2).map(r => {
    const m = /^([A-Z]{2})([-/\\])([A-Z]{2})$/.exec(r.boundary);
    if (!m) throw new Error("Bad boundary code " + r.boundary);
    const [, a, sep, b] = m;
    const nameA = plateNames[a] || a + " Plate", nameB = plateNames[b] || b + " Plate";
    const c = CLASSES[r.code];
    // kept small (1,700 lines): the label, kind and colours come from cls in logic.js
    const props = {
        name: nameA + " - " + nameB + " (" + a + "-" + b + ")",
        plateA: nameA,
        plateB: nameB,
        type: c.type,
        cls: r.code,
        rate: Math.round(r.rateKm / Math.max(r.km, 1) * 10) / 10
    };
    // "/" or "\" marks which plate sinks: in A/B the B plate subducts under A, in A\B A sinks under B
    if (sep === "/") props.sinks = nameB;
    if (sep === "\\") props.sinks = nameA;
    if (r.orogen) props.orogen = true;
    return { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: r.coords.map(p => [r3(p[0]), r3(p[1])]) } };
});

const fc = { type: "FeatureCollection", features };
const out = "(function () {\n    \"use strict\";\n\n"
    + "    // PB2002 Global Tectonic Plate Boundaries (Peter Bird, 2003, Geochem. Geophys. Geosyst. 4(3), 1027),\n"
    + "    // built from PB2002_steps.dat: every digitization step with its class (SUB, OCB, CCB, OSR, CRB, OTF, CTF),\n"
    + "    // consecutive steps of one boundary and class joined into lines. rate = relative plate speed, mm/yr.\n"
    + "    window.tectonicPlatesGeoJSON = " + JSON.stringify(fc) + ";\n}());\n";
fs.writeFileSync(outPath, out);

const tally = {};
for (const f of features) tally[f.properties.cls] = (tally[f.properties.cls] || 0) + 1;
console.log("steps", steps.length, "features", features.length, "bytes", out.length);
console.log("features per class", tally);
console.log("plate codes without a name:", [...new Set(steps.flatMap(s => s.boundary.split(/[-/\\]/)))].filter(c => !plateNames[c]).join(" ") || "none");
