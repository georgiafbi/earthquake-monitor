// Quake Quest: the teaching content (lessons, collection, badges, ranks,
// missions). Every lesson has a Cadet version (plain words, ages 8+) and a
// Scientist version (proper terms). Facts follow USGS/IRIS teaching material.
(function () {
    "use strict";

    var DEPTH = {
        shallow: {
            label: "Shallow (0-70 km)", short: "Shallow", icon: "🟢",
            cadet: "Shallow quakes start in the top 70 km of the Earth, close to us, so they usually shake the ground the hardest. Most earthquakes are shallow.",
            scientist: "Shallow-focus events (0-70 km) are brittle failures in the crust and uppermost mantle. They release most of Earth's seismic energy and produce the strongest surface shaking for a given magnitude, because the waves travel only a short way to the surface."
        },
        intermediate: {
            label: "Intermediate (70-300 km)", short: "Intermediate", icon: "🟠",
            cadet: "Intermediate quakes happen 70 to 300 km down. Almost all of them are inside a slab of ocean plate that is sinking into the mantle at a subduction zone.",
            scientist: "Intermediate-depth events (70-300 km) occur inside subducting slabs, in the Wadati-Benioff zone. A leading explanation is dehydration embrittlement: water-bearing minerals break down and the released fluid weakens the rock."
        },
        deep: {
            label: "Deep (300-700 km)", short: "Deep", icon: "🔴",
            cadet: "Deep quakes start 300 to 700 km down, where rock is so hot and squeezed it shouldn't snap at all! They only happen in cold, fast-sinking slabs, like under Tonga, Fiji and South America.",
            scientist: "Deep-focus events (300-700 km) occur only in cold, fast slabs, where ordinary brittle failure is not expected. Proposed mechanisms include transformational faulting of metastable olivine and thermal runaway. They have few aftershocks and are felt over very wide areas."
        }
    };

    var KINDS = {
        subduction: {
            label: "Subduction zone", icon: "🌋", color: "#fb7185",
            cadet: "At a subduction zone one plate dives under another. The scraping and bending make the biggest earthquakes on Earth, plus deep ocean trenches and chains of volcanoes: the Ring of Fire.",
            scientist: "Subduction zones host megathrust events on the plate interface (every M9 on record), intermediate and deep events inside the sinking slab, and faulting in the upper plate. They are marked by trenches and volcanic arcs."
        },
        collision: {
            label: "Collision zone", icon: "⛰️", color: "#c084fc",
            cadet: "Where two continents crash together, neither one sinks easily, so the land crumples up into mountains like the Himalaya and breaks in shallow quakes over a wide area.",
            scientist: "In continental collision, buoyant crust resists subduction, so shortening is taken up by thrust faulting across broad zones (Himalaya, Zagros, Alps). Seismicity is diffuse and mostly shallow."
        },
        divergent: {
            label: "Spreading ridge or rift", icon: "🫧", color: "#7dd3fc",
            cadet: "At a spreading ridge the plates pull apart and hot rock rises to make new sea floor. Quakes here are usually small and shallow, because the rock underneath is hot and the cold, breakable layer is thin.",
            scientist: "Divergent boundaries (mid-ocean ridges and continental rifts) show normal faulting. Events are shallow because the brittle layer is thin above hot upwelling mantle, and they rarely exceed about M6."
        },
        transform: {
            label: "Transform fault", icon: "↔️", color: "#fbbf24",
            cadet: "At a transform fault two plates slide sideways past each other. The rocks stick, bend, then suddenly slip. California's San Andreas Fault is a famous one.",
            scientist: "Transform boundaries show strike-slip faulting with shallow events. Oceanic transforms offset ridge segments; continental transforms (San Andreas, North Anatolian, Alpine Fault) can produce M7-8 earthquakes."
        },
        intraplate: {
            label: "Inside a plate", icon: "🧩", color: "#94a3b8",
            cadet: "Not every quake happens at a plate edge! Some happen in the middle of a plate on old cracks, under hotspot volcanoes like Hawaii, or because of people (mining, blasting or pumping fluids underground).",
            scientist: "Intraplate seismicity comes from reactivated ancient faults under far-field stress (for example New Madrid), volcanic and hotspot processes (Hawaii), or human activity such as fluid injection and mining."
        }
    };

    // Gutenberg-Richter radiated energy, as tonnes of TNT (same formula as the explainer Worker):
    // log10 E = 1.5 M + 4.8 (joules), one tonne of TNT = 4.184e9 J
    var TNT = {
        tonnes: function (mag) { return Math.pow(10, 1.5 * Number(mag) + 4.8) / 4.184e9; },
        format: function (tonnes) {
            if (tonnes >= 1e6) return Number((tonnes / 1e6).toPrecision(2)).toLocaleString("en-US") + " million tonnes of TNT";
            if (tonnes >= 1) return Number(tonnes.toPrecision(2)).toLocaleString("en-US") + " tonnes of TNT";
            return Number((tonnes * 1000).toPrecision(2)).toLocaleString("en-US") + " kg of TNT";
        }
    };

    var ENERGY = {
        cadet: "The magnitude scale goes up in giant jumps: each whole number up means about 32 times more energy. So an M6 releases about 1,000 times more energy than an M4!",
        scientist: "Radiated energy follows log10 E ≈ 1.5 M + 4.8 (joules): about ×32 per magnitude unit and ×1,000 per two units, while wave amplitude grows ×10 per unit."
    };

    var MAGNITUDE = {
        minor: { label: "Minor (below M4)", min: -9, max: 4, icon: "·", cadet: "Minor quakes happen many times a day. Most are too small to feel, but sensitive instruments record them all.", scientist: "Below M4: millions per year worldwide, detected mainly by dense local networks; useful for mapping active faults." },
        light: { label: "Light (M4-4.9)", min: 4, max: 5, icon: "•", cadet: "Light quakes rattle windows and dishes nearby but rarely cause damage.", scientist: "M4-4.9: roughly 13,000 per year; widely felt near the epicentre, damage is rare." },
        moderate: { label: "Moderate (M5-5.9)", min: 5, max: 6, icon: "●", cadet: "Moderate quakes can crack walls and damage weak buildings near where they start.", scientist: "M5-5.9: about 1,300 per year; can damage poorly built structures close to the epicentre." },
        strong: { label: "Strong (M6-6.9)", min: 6, max: 7, icon: "⬤", cadet: "Strong quakes can be destructive in towns near the epicentre. There are about 130 a year.", scientist: "M6-6.9: about 130 per year; destructive in populated areas within roughly 100 km." },
        major: { label: "Major (M7-7.9)", min: 7, max: 8, icon: "💥", cadet: "Major quakes are rare, about 15 a year, and can cause serious damage over large areas.", scientist: "M7-7.9: about 15 per year; serious damage over large areas, rupture lengths of tens to hundreds of km." },
        great: { label: "Great (M8+)", min: 8, max: 99, icon: "🌐", cadet: "Great quakes come about once a year. They can change coastlines and send tsunamis across whole oceans.", scientist: "M8+: about one per year; ruptures of hundreds of km, often on subduction megathrusts, capable of ocean-wide tsunamis." }
    };

    var REGIONS = {
        africa: { label: "Africa", icon: "🌍", m49: ["002"] },
        europe: { label: "Europe", icon: "🏰", m49: ["150"] },
        asia: { label: "Asia", icon: "🏯", m49: ["142"] },
        oceania: { label: "Oceania", icon: "🏝️", m49: ["009"] },
        north_america: { label: "North & Central America", icon: "🌎", m49: ["021", "013", "029"] },
        south_america: { label: "South America", icon: "🦙", m49: ["005"] },
        antarctica: { label: "Antarctica", icon: "🐧", m49: ["AQ"] },
        ocean: { label: "Open ocean", icon: "🌊", m49: [] }
    };

    var SPECIAL = {
        tsunami: { label: "Tsunami-capable", icon: "🌊", cadet: "Big quakes under the sea can lift the sea floor and push the water above into a tsunami. USGS flags quakes that are big enough and in the right place; official warnings come from tsunami centres.", scientist: "The USGS tsunami flag marks large oceanic events (roughly M6.5+) whose source could generate a tsunami. It is informational; warnings come from the Tsunami Warning Centers." },
        induced: { label: "Human-made", icon: "⛏️", cadet: "Some shaking is caused by people: quarry blasts, mining, or pumping water deep underground, which can wake up old faults.", scientist: "Anthropogenic seismicity includes explosions (quarry and mining blasts) and induced earthquakes from wastewater injection, hydraulic fracturing, reservoirs and mining." },
        felt100: { label: "Felt by 100+ people", icon: "🙋", cadet: "When people feel a quake they can tell USGS on the 'Did You Feel It?' page. Reports from 100 or more people help scientists map the shaking.", scientist: "'Did You Feel It?' crowdsources intensity reports; with enough responses USGS maps community intensity (CDI) and checks ShakeMap estimates." },
        pager: { label: "PAGER alert", icon: "🚨", cadet: "For big quakes USGS quickly estimates how many people might be hurt and how much damage there could be. Green means little, red means a lot.", scientist: "PAGER (Prompt Assessment of Global Earthquakes for Response) estimates fatalities and losses from ShakeMap and population exposure, alerting green, yellow, orange or red." }
    };

    // ---- collection: every category a quake can belong to
    var CATEGORIES = [];
    Object.keys(DEPTH).forEach(function (k) { CATEGORIES.push({ key: "depth:" + k, group: "Depth", label: DEPTH[k].label, icon: DEPTH[k].icon, lesson: DEPTH[k] }); });
    Object.keys(MAGNITUDE).forEach(function (k) { CATEGORIES.push({ key: "mag:" + k, group: "Size", label: MAGNITUDE[k].label, icon: MAGNITUDE[k].icon, lesson: MAGNITUDE[k] }); });
    Object.keys(KINDS).forEach(function (k) { CATEGORIES.push({ key: "kind:" + k, group: "Boundary", label: KINDS[k].label, icon: KINDS[k].icon, lesson: KINDS[k] }); });
    Object.keys(REGIONS).forEach(function (k) {
        CATEGORIES.push({ key: "region:" + k, group: "Region", label: REGIONS[k].label, icon: REGIONS[k].icon,
            lesson: { cadet: "You logged a quake in " + REGIONS[k].label + ".", scientist: "Logged an event in " + REGIONS[k].label + "." } });
    });
    Object.keys(SPECIAL).forEach(function (k) { CATEGORIES.push({ key: "special:" + k, group: "Special", label: SPECIAL[k].label, icon: SPECIAL[k].icon, lesson: SPECIAL[k] }); });

    // ---- ranks: one airship of the fleet joins your command at each rank
    var RANKS = [
        { xp: 0, title: "Cadet" },
        { xp: 60, title: "Deck Observer" },
        { xp: 160, title: "Field Observer" },
        { xp: 320, title: "Survey Pilot" },
        { xp: 540, title: "Seismograph Officer" },
        { xp: 840, title: "Seismologist" },
        { xp: 1250, title: "Senior Seismologist" },
        { xp: 1800, title: "Chief Seismologist" },
        { xp: 2600, title: "Admiral of the Survey Fleet" }
    ];

    var XP = { right: 20, wrong: 5, streakBonus: 5, newCategory: 15, mission: 40, badge: 25 };

    // ---- badges: test(state, summary) -> true when earned
    function has(state, key) { return Boolean(state.collected[key]); }
    function countGroup(state, prefix) { return Object.keys(state.collected).filter(function (k) { return k.indexOf(prefix) === 0; }).length; }
    var BADGES = [
        { id: "first", icon: "🔭", label: "First Reading", desc: "Make your first prediction.", test: function (s) { return s.stats.predictions >= 1; } },
        { id: "streak5", icon: "📈", label: "Steady Needle", desc: "Get 5 predictions right in a row.", test: function (s) { return s.stats.bestStreak >= 5; } },
        { id: "streak10", icon: "🧠", label: "Seismic Sense", desc: "Get 10 predictions right in a row.", test: function (s) { return s.stats.bestStreak >= 10; } },
        { id: "layers", icon: "🪨", label: "Down Through the Layers", desc: "Log a shallow, an intermediate and a deep quake.", test: function (s) { return countGroup(s, "depth:") >= 3; } },
        { id: "deep", icon: "🤿", label: "Deep Diver", desc: "Log a deep quake (300+ km).", test: function (s) { return has(s, "depth:deep"); } },
        { id: "ridge", icon: "🫧", label: "Ridge Rider", desc: "Log a quake on a spreading ridge or rift.", test: function (s) { return has(s, "kind:divergent"); } },
        { id: "plates", icon: "🧭", label: "Plate Patrol", desc: "Log all four kinds of boundary plus a quake inside a plate.", test: function (s) { return countGroup(s, "kind:") >= 5; } },
        { id: "globe", icon: "🗺️", label: "Globe Trotter", desc: "Log quakes in 5 different regions.", test: function (s) { return countGroup(s, "region:") >= 5; } },
        { id: "bigone", icon: "💥", label: "Big One Watcher", desc: "Log a major (M7+) quake.", test: function (s) { return has(s, "mag:major") || has(s, "mag:great"); } },
        { id: "wave", icon: "🌊", label: "Wave Watch", desc: "Log a tsunami-capable quake.", test: function (s) { return has(s, "special:tsunami"); } },
        { id: "human", icon: "⛏️", label: "Human Footprint", desc: "Log a human-made quake or blast.", test: function (s) { return has(s, "special:induced"); } },
        { id: "curious", icon: "🤖", label: "Curious Mind", desc: "Ask the tutor why, 5 times.", test: function (s) { return s.stats.tutorAsks >= 5; } },
        { id: "fieldweek", icon: "📅", label: "Field Week", desc: "Finish the daily missions on 7 different days.", test: function (s) { return s.stats.missionDays >= 7; } },
        { id: "labcoat", icon: "🥼", label: "Lab Coat", desc: "Make 10 predictions in Scientist mode.", test: function (s) { return s.stats.scientistPredictions >= 10; } }
    ];

    // ---- daily missions: data missions need a matching quake on the map; skill missions count answers
    var MISSIONS = [
        { id: "deep", icon: "🤿", text: "Make a prediction on a deep quake (300+ km down).", match: function (c) { return c.depthClass === "deep"; } },
        { id: "intermediate", icon: "🟠", text: "Make a prediction on an intermediate-depth quake (70-300 km).", match: function (c) { return c.depthClass === "intermediate"; } },
        { id: "ridge", icon: "🫧", text: "Find a quake on a spreading ridge or rift and predict it.", match: function (c) { return c.boundary.kind === "divergent"; } },
        { id: "subduction", icon: "🌋", text: "Find a quake at a subduction zone and predict it.", match: function (c) { return c.boundary.kind === "subduction"; } },
        { id: "transform", icon: "↔️", text: "Find a quake on a transform fault and predict it.", match: function (c) { return c.boundary.kind === "transform"; } },
        { id: "collision", icon: "⛰️", text: "Find a quake where continents collide and predict it.", match: function (c) { return c.boundary.kind === "collision"; } },
        { id: "intraplate", icon: "🧩", text: "Find a quake far from any plate boundary and predict it.", match: function (c) { return c.boundary.kind === "intraplate"; } },
        { id: "moderate", icon: "●", text: "Predict a quake of magnitude 5 or more.", match: function (c) { return c.mag >= 5; } },
        { id: "felt", icon: "🙋", text: "Predict a quake that at least 10 people reported feeling.", match: function (c) { return c.felt >= 10; } },
        { id: "tsunami", icon: "🌊", text: "Predict a tsunami-capable quake.", match: function (c) { return c.tsunami; } },
        { id: "induced", icon: "⛏️", text: "Predict a human-made quake or blast.", match: function (c) { return c.induced; } },
        { id: "ocean", icon: "🐋", text: "Predict a quake out in the open ocean.", match: function (c) { return c.region === "ocean"; } }
    ];
    var SKILL_MISSIONS = [
        { id: "right3", icon: "🎯", text: "Get 3 predictions right today.", goal: 3, stat: "rightToday" },
        { id: "predict5", icon: "📝", text: "Make 5 predictions today.", goal: 5, stat: "predictedToday" },
        { id: "streak3", icon: "🔥", text: "Get 3 right in a row.", goal: 3, stat: "streakToday" }
    ];

    // ---- the survey fleet: one instrument per airship (same order as SATELLITE_FLEET in logic.js).
    // A ship joins you when you choose it (at the start, and once per promotion) or by its deed.
    // match(c, ctx): does this unpredicted quake show up on the instrument? ctx has the
    // player's collected categories and today's open missions. sort: "mag" or "time".
    function loggedCount(s) { return Object.keys(s.collected).length; }
    var SHIPS = [
        { icon: "🧭", instrument: "Field Guide Compass", finds: "quakes of a kind you haven't logged yet",
          cadet: "Points you to quakes that would add something new to your Field Guide.",
          scientist: "Filters for events in categories absent from your collection: the fastest way to complete it.",
          deed: "Log 8 kinds of quake in your Field Guide", deedTest: function (s) { return loggedCount(s) >= 8; },
          match: function (c, ctx) { return ctx.newKinds(c); }, sort: "mag" },
        { icon: "🎯", instrument: "Mission Beacon", finds: "quakes that would complete one of today's missions",
          cadet: "Lights up quakes that finish one of today's missions.",
          scientist: "Flags events that satisfy an open daily mission.",
          deed: "Finish 3 daily missions", deedTest: function (s) { return s.stats.missionsDone >= 3; },
          match: function (c, ctx) { return ctx.missionMatch(c); }, sort: "mag" },
        { icon: "🤿", instrument: "Deep Sounder", finds: "quakes deeper than 70 km",
          cadet: "Hears quakes that start deep underground, inside sinking plates.",
          scientist: "Selects intermediate and deep-focus events (70+ km), the slab seismicity of subduction zones.",
          deed: "Predict 3 quakes deeper than 70 km", deedTest: function (s) { return s.stats.deepPredictions >= 3; },
          match: function (c) { return c.depth >= 70; }, sort: "mag" },
        { icon: "🫧", instrument: "Ridge Lantern", finds: "quakes on spreading ridges and rifts",
          cadet: "Glows over places where plates pull apart and new sea floor is made.",
          scientist: "Selects events on divergent boundaries: mid-ocean ridges and continental rifts.",
          deed: "Predict 3 quakes out in the open ocean", deedTest: function (s) { return s.stats.oceanPredictions >= 3; },
          match: function (c) { return c.boundary.kind === "divergent"; }, sort: "mag" },
        { icon: "🌋", instrument: "Trench Sonar", finds: "subduction-zone quakes",
          cadet: "Pings quakes where one plate dives under another, along the Ring of Fire.",
          scientist: "Selects events attributed to subduction zones: interface, intraslab and upper-plate.",
          deed: "Get 3 'what kind of place?' questions right", deedTest: function (s) { return s.stats.boundaryRight >= 3; },
          match: function (c) { return c.boundary.kind === "subduction"; }, sort: "mag" },
        { icon: "↔️", instrument: "Fault Tracer", finds: "transform-fault and collision quakes",
          cadet: "Traces faults where plates slide past or crash into each other.",
          scientist: "Selects strike-slip (transform) and continental-collision events.",
          deed: "Predict 2 quakes on transform faults or collision zones", deedTest: function (s) { return s.stats.faultPredictions >= 2; },
          match: function (c) { return c.boundary.kind === "transform" || c.boundary.kind === "collision"; }, sort: "mag" },
        { icon: "🌊", instrument: "Wave Watch", finds: "tsunami-capable and magnitude 5+ quakes",
          cadet: "Watches for the big ones, and the ones big enough under the sea to make a tsunami.",
          scientist: "Selects M5+ events and those carrying the USGS tsunami flag.",
          deed: "Predict a magnitude 5+ quake", deedTest: function (s) { return s.stats.bigPredictions >= 1; },
          match: function (c) { return c.mag >= 5 || c.tsunami; }, sort: "mag" },
        { icon: "🧩", instrument: "Odd-One-Out Finder", finds: "quakes inside plates and human-made ones",
          cadet: "Finds quakes that happen far from plate edges, and shaking caused by people.",
          scientist: "Selects intraplate events and anthropogenic events (explosions, induced seismicity).",
          deed: "Log a quake inside a plate or a human-made one", deedTest: function (s) { return Boolean(s.collected["kind:intraplate"] || s.collected["special:induced"]); },
          match: function (c) { return c.boundary.kind === "intraplate" || c.induced; }, sort: "mag" },
        { icon: "🖋️", instrument: "Fresh Ink", finds: "the newest quakes you haven't predicted",
          cadet: "Takes you straight to the quakes that just happened.",
          scientist: "Orders unpredicted events by origin time, newest first.",
          deed: "Predict 3 quakes within an hour of when they happened", deedTest: function (s) { return s.stats.freshPredictions >= 3; },
          match: function () { return true; }, sort: "time" }
    ];

    window.QUEST_DATA = {
        DEPTH: DEPTH, KINDS: KINDS, ENERGY: ENERGY, TNT: TNT, MAGNITUDE: MAGNITUDE, REGIONS: REGIONS, SPECIAL: SPECIAL,
        CATEGORIES: CATEGORIES, RANKS: RANKS, XP: XP, BADGES: BADGES, MISSIONS: MISSIONS, SKILL_MISSIONS: SKILL_MISSIONS,
        SHIPS: SHIPS
    };
}());
