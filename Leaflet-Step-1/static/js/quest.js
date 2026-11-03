// Quake Quest: the Earthquake Monitor's geology game.
// Predict-then-reveal questions in every quake popup, a collection (field guide),
// badges, daily missions from the live feed, and ranks that put the airship fleet
// under your command. Progress is kept in this browser (localStorage).
// Science helpers are pure functions (exported for tests on window.quakeQuest.science).
(function () {
    "use strict";

    var D = window.QUEST_DATA;
    var STORE_KEY = "quakeQuest.v1";
    var MAX_ANSWERS = 400;

    // ================================================================ science
    function depthClass(km) {
        var d = Number(km);
        if (!Number.isFinite(d) || d < 70) return "shallow";
        return d < 300 ? "intermediate" : "deep";
    }

    function magnitudeClass(mag) {
        var m = Number(mag);
        var keys = Object.keys(D.MAGNITUDE);
        for (var i = 0; i < keys.length; i++) {
            var c = D.MAGNITUDE[keys[i]];
            if (m >= c.min && m < c.max) return keys[i];
        }
        return "minor";
    }

    // Gutenberg-Richter radiated energy, as tonnes of TNT (same formula as the explainer Worker)
    function tntTonnes(mag) {
        return Math.pow(10, 1.5 * Number(mag) + 4.8) / 4.184e9;
    }

    function formatTnt(tonnes) {
        if (tonnes >= 1e6) return Number((tonnes / 1e6).toPrecision(2)).toLocaleString("en-US") + " million tonnes of TNT";
        if (tonnes >= 1) return Number(tonnes.toPrecision(2)).toLocaleString("en-US") + " tonnes of TNT";
        return Number((tonnes * 1000).toPrecision(2)).toLocaleString("en-US") + " kg of TNT";
    }

    // plate boundaries flattened into segments, grouped by kind of motion
    var KIND_OF_CLASS = { SUB: "subduction", OCB: "collision", CCB: "collision", OSR: "divergent", CRB: "divergent", OTF: "transform", CTF: "transform" };
    var boundaryIndex = null;
    function buildBoundaryIndex(fc) {
        var segs = [];
        ((fc && fc.features) || []).forEach(function (f) {
            var kind = KIND_OF_CLASS[f.properties && f.properties.cls];
            if (!kind) return;
            var c = f.geometry.coordinates;
            for (var i = 1; i < c.length; i++) {
                segs.push({ a: c[i - 1], b: c[i], kind: kind, props: f.properties });
            }
        });
        return segs;
    }

    // km from a point to a short great-circle segment, in a local flat projection (fine below ~1,000 km)
    function segmentDistanceKm(lon, lat, a, b) {
        var k = Math.cos(lat * Math.PI / 180) * 111.32;
        function x(l) { var d = l - lon; if (d > 180) d -= 360; if (d < -180) d += 360; return d * k; }
        var ax = x(a[0]), ay = (a[1] - lat) * 110.57, bx = x(b[0]), by = (b[1] - lat) * 110.57;
        var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        var px = ax + t * dx, py = ay + t * dy;
        return Math.sqrt(px * px + py * py);
    }

    // Wide deforming regions that the PB2002 lines draw as a single thin boundary (or
    // not at all), where "inside a plate" would be wrong: no boundary question there.
    var DIFFUSE_ZONES = [
        { name: "East African Rift", w: 28, e: 42, s: -16, n: 16 },
        { name: "Central Asian collision (Tibet, Tien Shan, Mongolia)", w: 65, e: 120, s: 25, n: 52 },
        { name: "Basin and Range (western USA)", w: -122, e: -104, s: 30, n: 50 }
    ];
    function inDiffuseZone(lon, lat) {
        return DIFFUSE_ZONES.some(function (z) { return lon >= z.w && lon <= z.e && lat >= z.s && lat <= z.n; });
    }

    // Which kind of boundary made this quake? Asked only when clear-cut (confident).
    function classifyBoundary(lon, lat, depthKm, segs) {
        var best = {};
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (Math.abs(s.a[1] - lat) > 9 && Math.abs(s.b[1] - lat) > 9) continue; // > ~1,000 km away
            var d = segmentDistanceKm(lon, lat, s.a, s.b);
            if (!best[s.kind] || d < best[s.kind].km) best[s.kind] = { km: d, props: s.props };
        }
        var kinds = Object.keys(best).sort(function (p, q) { return best[p].km - best[q].km; });
        var nearest = kinds[0] || null;
        var nearestKm = nearest ? best[nearest].km : Infinity;
        var result = { kind: null, nearest: nearest, distanceKm: Math.round(nearestKm), boundary: nearest ? best[nearest].props : null };
        // quakes inside a sinking slab sit far from the trench line: deep + near a subduction zone = subduction
        if (depthKm >= 70 && best.subduction && best.subduction.km <= 900) {
            result.kind = "subduction"; result.boundary = best.subduction.props; result.distanceKm = Math.round(best.subduction.km);
            return result;
        }
        // shallow quakes on a megathrust or in the upper plate lie landward of the trench line
        if (nearest === "subduction" && nearestKm <= 250) { result.kind = "subduction"; return result; }
        if (nearestKm > 400) {
            if (!inDiffuseZone(lon, lat)) result.kind = "intraplate";
            return result;
        }
        if (nearestKm <= 120) {
            var runnerUp = kinds[1] ? best[kinds[1]].km : Infinity;
            if (runnerUp - nearestKm >= 40) result.kind = nearest; // a ridge-transform corner is not clear-cut
        }
        return result;
    }

    function regionFor(countryCode, lon, lat) {
        var cc = window.countryCoder;
        if (countryCode && cc && typeof cc.isIn === "function") {
            var keys = Object.keys(D.REGIONS);
            for (var i = 0; i < keys.length; i++) {
                var groups = D.REGIONS[keys[i]].m49;
                for (var g = 0; g < groups.length; g++) {
                    try { if (cc.isIn(countryCode, groups[g])) return keys[i]; } catch (e) { /* unknown code */ }
                }
            }
        }
        return "ocean";
    }

    var classCache = new Map();
    function classifyQuake(feature) {
        if (!feature || !feature.properties) return null;
        var p = feature.properties;
        var id = String(p.eventId || feature.id || "");
        if (id && classCache.has(id)) return classCache.get(id);
        if (!boundaryIndex) boundaryIndex = buildBoundaryIndex(window.tectonicPlatesGeoJSON);
        var coords = feature.geometry && feature.geometry.coordinates || [];
        var lon = Number(coords[0]), lat = Number(coords[1]);
        var depth = Number(p.depth != null ? p.depth : coords[2]);
        var c = {
            id: id,
            lon: lon, lat: lat,
            depth: depth,
            depthClass: depthClass(depth),
            mag: Number(p.mag),
            magClass: magnitudeClass(p.mag),
            boundary: classifyBoundary(lon, lat, depth, boundaryIndex),
            region: regionFor(p.countryCode, lon, lat),
            tsunami: p.hasTsunami === true || Number(p.tsunami) === 1,
            induced: Boolean(p.origin && p.origin.isInduced),
            felt: Number(p.felt) || 0,
            pager: Boolean(p.pager)
        };
        if (c.induced) c.boundary.kind = "intraplate"; // blasts and induced quakes aren't plate-boundary events
        if (id) classCache.set(id, c);
        return c;
    }

    function categoriesFor(c) {
        var keys = ["depth:" + c.depthClass, "mag:" + c.magClass, "region:" + c.region];
        if (c.boundary.kind) keys.push("kind:" + c.boundary.kind);
        if (c.tsunami) keys.push("special:tsunami");
        if (c.induced) keys.push("special:induced");
        if (c.felt >= 100) keys.push("special:felt100");
        if (c.pager) keys.push("special:pager");
        return keys;
    }

    function hashString(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    // ================================================================ questions
    function questionKinds(c) {
        var kinds = ["depth"];
        if (c.boundary.kind && !c.induced) kinds.push("boundary");
        if (c.mag >= 1) kinds.push("energy"); // small quakes too: "about 2 kg of TNT" teaches the scale just as well
        return kinds;
    }

    function buildQuestion(c, mode) {
        var kinds = questionKinds(c);
        var kind = kinds[hashString(c.id) % kinds.length];
        var cadet = mode !== "scientist";
        if (kind === "depth") {
            return {
                kind: "depth",
                prompt: cadet ? "How deep underground did this quake start?" : "Estimate the focal depth class of this event.",
                hint: cadet ? "Clue: the marker colour on the map shows depth, and the legend explains the colours." : "Consider the tectonic setting: slab events can be far below the surface.",
                options: Object.keys(D.DEPTH).map(function (k) { return { key: k, label: D.DEPTH[k].icon + " " + D.DEPTH[k].label }; }),
                answer: c.depthClass
            };
        }
        if (kind === "boundary") {
            return {
                kind: "boundary",
                prompt: cadet ? "What kind of place made this quake?" : "Which tectonic setting produced this event?",
                hint: cadet ? "Clue: turn on Tectonic Plates. Red = subduction, purple = collision, blue = spreading, yellow = sliding past." : "Use the boundary layer and the depth: intermediate and deep events belong to slabs.",
                options: Object.keys(D.KINDS).map(function (k) { return { key: k, label: D.KINDS[k].icon + " " + D.KINDS[k].label }; }),
                answer: c.boundary.kind
            };
        }
        // energy: the magnitude scale is logarithmic (x32 per step)
        var steps = [["x1/32", 1 / 32], ["x1", 1], ["x32", 32], ["x1000", 1000]];
        var t = tntTonnes(c.mag);
        var order = steps.slice().sort(function (p, q) { return hashString(c.id + p[0]) - hashString(c.id + q[0]); });
        return {
            kind: "energy",
            prompt: (cadet ? "This quake was magnitude " : "This M") + c.mag.toFixed(1) + (cadet ? ". About how much energy did it release?" : " event radiated roughly how much energy?"),
            hint: cadet ? "Clue: a magnitude 6 releases about 15,000 tonnes of TNT (about one Hiroshima bomb), and each step down the scale is about 32 times less." : "log10 E = 1.5 M + 4.8 (J); one tonne of TNT = 4.184 GJ.",
            options: order.map(function (s) { return { key: s[0], label: "About " + formatTnt(t * s[1]) }; }),
            answer: "x1"
        };
    }

    function answerLabel(q, key) {
        for (var i = 0; i < q.options.length; i++) if (q.options[i].key === key) return q.options[i].label;
        return key;
    }

    function lessonFor(q, c, mode) {
        var m = mode === "scientist" ? "scientist" : "cadet";
        if (q.kind === "depth") return D.DEPTH[q.answer][m];
        if (q.kind === "boundary") return D.KINDS[q.answer][m];
        return D.ENERGY[m];
    }

    // ================================================================ state
    function today() {
        var d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function defaultState() {
        return {
            v: 1, on: true, mode: "cadet", xp: 0, ship: 0, introSeen: false,
            answers: {}, collected: {}, badges: {},
            stats: { predictions: 0, right: 0, streak: 0, bestStreak: 0, tutorAsks: 0, missionDays: 0, scientistPredictions: 0 },
            daily: null
        };
    }

    function loadState() {
        var s = null;
        try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
        var d = defaultState();
        if (!s || s.v !== 1) return d;
        Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
        Object.keys(d.stats).forEach(function (k) { if (s.stats[k] === undefined) s.stats[k] = 0; });
        return s;
    }

    var state = loadState();
    function save() {
        var ids = Object.keys(state.answers);
        if (ids.length > MAX_ANSWERS) {
            ids.sort(function (a, b) { return state.answers[a].t - state.answers[b].t; })
                .slice(0, ids.length - MAX_ANSWERS).forEach(function (id) { delete state.answers[id]; });
        }
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: play without saving */ }
        renderChip();
    }

    function rankIndex(xp) {
        var idx = 0;
        D.RANKS.forEach(function (r, i) { if (xp >= r.xp) idx = i; });
        return idx;
    }

    // ---- daily missions, picked from what is on the map today
    function loadedClassifications() {
        var feats = (typeof currentGeojson !== "undefined" && currentGeojson && currentGeojson.features) || [];
        return feats.map(classifyQuake).filter(Boolean);
    }

    function ensureDaily() {
        var date = today();
        var list = loadedClassifications();
        var d = state.daily;
        // keep today's missions, unless they were picked before any quakes had loaded
        // (only skill missions then) and nothing has been done yet
        if (d && d.date === date && (d.dataReady || !list.length || d.predictedToday > 0)) return d;
        var seed = hashString("missions" + date);
        var data = D.MISSIONS.filter(function (m) { return list.some(m.match); })
            .sort(function (a, b) { return hashString(date + a.id) - hashString(date + b.id); });
        var picks = data.slice(0, 2).map(function (m) { return m.id; });
        var skills = D.SKILL_MISSIONS.slice();
        picks.push(skills[seed % skills.length].id);
        for (var i = 1; picks.length < 3; i++) picks.push(skills[(seed + i) % skills.length].id);
        state.daily = { date: date, missions: picks, done: {}, rightToday: 0, predictedToday: 0, streakToday: 0, completed: false, dataReady: list.length > 0 };
        save();
        return state.daily;
    }

    function missionDef(id) {
        return D.MISSIONS.find(function (m) { return m.id === id; }) || D.SKILL_MISSIONS.find(function (m) { return m.id === id; });
    }

    // ---- an answer: XP, streaks, collection, missions, badges, rank
    function recordAnswer(c, q, guess) {
        var ok = guess === q.answer;
        var before = rankIndex(state.xp);
        var events = [];
        var gained = ok ? D.XP.right : D.XP.wrong;
        state.stats.predictions++;
        if (state.mode === "scientist") state.stats.scientistPredictions++;
        var daily = ensureDaily();
        daily.predictedToday++;
        if (ok) {
            state.stats.right++; state.stats.streak++; daily.rightToday++; daily.streakToday++;
            state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
            if (state.stats.streak >= 3) { gained += D.XP.streakBonus; events.push({ icon: "🔥", text: state.stats.streak + " in a row! +" + D.XP.streakBonus + " XP" }); }
        } else {
            state.stats.streak = 0; daily.streakToday = 0;
        }
        state.answers[c.id] = { k: q.kind, g: guess, a: q.answer, ok: ok, t: Date.now() };

        var logged = [];
        categoriesFor(c).forEach(function (key) {
            if (state.collected[key]) return;
            state.collected[key] = { id: c.id, t: Date.now() };
            gained += D.XP.newCategory;
            var cat = D.CATEGORIES.find(function (x) { return x.key === key; });
            if (cat) logged.push(cat.label.replace(/\s*\(.*\)$/, ""));
        });
        if (logged.length) {
            events.push({ icon: "📖", text: "Field Guide: " + logged.join(", ") + " (+" + logged.length * D.XP.newCategory + " XP)" });
        }

        daily.missions.forEach(function (id) {
            if (daily.done[id]) return;
            var m = missionDef(id);
            var met = m.match ? m.match(c) : daily[m.stat] >= m.goal;
            if (met) {
                daily.done[id] = true;
                gained += D.XP.mission;
                events.push({ icon: m.icon, text: "Mission done: " + m.text + " +" + D.XP.mission + " XP" });
            }
        });
        if (!daily.completed && daily.missions.every(function (id) { return daily.done[id]; })) {
            daily.completed = true;
            state.stats.missionDays++;
            events.push({ icon: "🏁", text: "All of today's missions done!" });
        }

        state.xp += gained;
        awardBadges().forEach(function (ev) { gained += D.XP.badge; events.push(ev); });
        var after = rankIndex(state.xp);
        if (after > before) {
            var ship = shipName(after);
            events.push({ icon: "🎖️", text: "Promoted to " + D.RANKS[after].title + "!" + (ship ? " " + ship + " joins your fleet." : "") });
        }
        save();
        return { ok: ok, gained: gained, events: events, rankUp: after > before };
    }

    // newly earned badges: recorded, XP added, returned as toast events
    function awardBadges() {
        var events = [];
        D.BADGES.forEach(function (b) {
            if (state.badges[b.id] || !b.test(state)) return;
            state.badges[b.id] = Date.now();
            state.xp += D.XP.badge;
            events.push({ icon: b.icon, text: "Badge: " + b.label + " +" + D.XP.badge + " XP" });
        });
        return events;
    }

    function skip(c) {
        state.answers[c.id] = { skip: true, t: Date.now() };
        save();
    }

    function shipName(i) {
        var fleet = typeof SATELLITE_FLEET !== "undefined" ? SATELLITE_FLEET : null;
        return fleet && fleet[i] ? fleet[i].name : null;
    }

    // ================================================================ UI helpers
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function toast(icon, text) {
        var box = document.getElementById("quest-toasts");
        if (!box) {
            box = el("div", "quest-toasts");
            box.id = "quest-toasts";
            box.setAttribute("aria-live", "polite");
            document.body.appendChild(box);
        }
        var t = el("div", "quest-toast");
        t.appendChild(el("span", "quest-toast-icon", icon));
        t.appendChild(el("span", null, text));
        box.appendChild(t);
        setTimeout(function () { t.classList.add("is-leaving"); }, 3600);
        setTimeout(function () { t.remove(); }, 4100);
    }

    function findFeature(id) {
        var feats = (typeof currentGeojson !== "undefined" && currentGeojson && currentGeojson.features) || [];
        return feats.find(function (f) { return String(f.properties && f.properties.eventId) === String(id); }) || null;
    }

    function refreshPopup() {
        if (window.earthquakeApp && typeof window.earthquakeApp.refreshQuakePopup === "function") window.earthquakeApp.refreshQuakePopup();
    }

    // ---- the popup gate: a question first, the facts after
    // returns "question" (facts stay hidden), "answered" or "off"
    function renderPopupGate(content, props) {
        if (!state.on || !props || !props.eventId) return "off";
        var feature = findFeature(props.eventId);
        var c = feature && classifyQuake(feature);
        if (!c) return "off";
        var rec = state.answers[c.id];
        var q = buildQuestion(c, state.mode);
        var box = el("div", "quest-box");
        if (!rec) {
            box.appendChild(el("p", "quest-kicker", "🎯 Field question · predict before you peek"));
            box.appendChild(el("p", "quest-prompt", q.prompt));
            var opts = el("div", "quest-options");
            opts.setAttribute("role", "group");
            opts.setAttribute("aria-label", "Answers");
            q.options.forEach(function (o) {
                var b = el("button", "quest-option", o.label);
                b.type = "button";
                b.addEventListener("click", function () {
                    var r = recordAnswer(c, q, o.key);
                    toast(r.ok ? "✅" : "📘", (r.ok ? "Right! " : "Good try! ") + "+" + r.gained + " XP" + (r.events.length ? " in all" : ""));
                    r.events.forEach(function (ev, i) { setTimeout(function () { toast(ev.icon, ev.text); }, 500 * (i + 1)); });
                    refreshPopup();
                });
                opts.appendChild(b);
            });
            box.appendChild(opts);
            var hint = el("details", "quest-hint");
            hint.appendChild(el("summary", null, "Need a clue?"));
            hint.appendChild(el("p", null, q.hint));
            box.appendChild(hint);
            var skipBtn = el("button", "quest-skip", "Skip: just show me the facts");
            skipBtn.type = "button";
            skipBtn.addEventListener("click", function () { skip(c); refreshPopup(); });
            box.appendChild(skipBtn);
            content.appendChild(box);
            return "question";
        }
        if (rec.skip) return "answered";
        // the question as it was asked (mode may have changed since: rebuild with the stored kind)
        var asked = q.kind === rec.k ? q : Object.assign({}, q, { kind: rec.k, answer: rec.a });
        var correctLabel = q.kind === rec.k ? answerLabel(q, rec.a) : rec.a;
        box.classList.add(rec.ok ? "is-right" : "is-wrong");
        box.appendChild(el("p", "quest-result", rec.ok ? "✅ You got it: " + correctLabel : "📘 It was " + correctLabel + (q.kind === rec.k ? " (you said " + answerLabel(q, rec.g).replace(/^About /, "about ") + ")" : "")));
        box.appendChild(el("p", "quest-lesson", lessonFor(asked, c, state.mode)));
        if (!rec.ok) box.appendChild(tutorBlock(c, rec));
        content.appendChild(box);
        return "answered";
    }

    // ---- Claude as tutor, only after a wrong guess (answers are cached and shared by the Worker)
    var tutorCache = new Map();
    function tutorUrl() {
        var base = typeof getExplainApiUrl === "function" ? getExplainApiUrl() : null;
        return base ? base.replace(/explain$/, "tutor") : null;
    }
    function tutorBlock(c, rec) {
        var wrap = el("div", "quest-tutor");
        var key = [c.id, rec.k, rec.g, rec.a, state.mode].join("|");
        var url = tutorUrl();
        if (!url) return wrap;
        function render() {
            wrap.replaceChildren();
            var entry = tutorCache.get(key);
            if (entry && entry.state === "done") {
                wrap.appendChild(el("p", "quest-tutor-head", "🤖 Tutor"));
                entry.paragraphs.forEach(function (p) { wrap.appendChild(el("p", "quest-tutor-text", p)); });
                return;
            }
            if (entry && entry.state === "loading") {
                wrap.appendChild(el("p", "quest-tutor-head", "🤖 The tutor is thinking…"));
                return;
            }
            if (entry && entry.state === "error") wrap.appendChild(el("p", "quest-tutor-error", entry.error));
            var b = el("button", "quest-tutor-btn", "🤖 Ask the tutor why");
            b.type = "button";
            b.addEventListener("click", function () {
                tutorCache.set(key, { state: "loading" });
                state.stats.tutorAsks++;
                awardBadges().forEach(function (ev) { toast(ev.icon, ev.text); });
                save();
                render();
                var qs = "?id=" + encodeURIComponent(c.id) + "&q=" + rec.k + "&guess=" + encodeURIComponent(rec.g) + "&answer=" + encodeURIComponent(rec.a) + "&mode=" + state.mode;
                fetch(url + qs).then(function (r) {
                    return r.json().catch(function () { return {}; }).then(function (body) {
                        if (!r.ok || !Array.isArray(body.paragraphs)) throw new Error(body.error || "The tutor is unavailable right now.");
                        tutorCache.set(key, { state: "done", paragraphs: body.paragraphs });
                    });
                }).catch(function (e) {
                    tutorCache.set(key, { state: "error", error: e && e.message && !/fetch/i.test(e.message) ? e.message : "Couldn't reach the tutor. Try again." });
                }).then(function () { if (wrap.isConnected) { render(); refreshPopupSize(); } });
            });
            wrap.appendChild(b);
        }
        render();
        return wrap;
    }
    function refreshPopupSize() { if (typeof keepQuakePopupInView === "function") requestAnimationFrame(keepQuakePopupInView); }

    // ================================================================ header chip + journal
    function renderChip() {
        var chip = document.getElementById("quest-chip");
        if (!chip) return;
        var r = rankIndex(state.xp);
        chip.querySelector(".quest-chip-rank").textContent = D.RANKS[r].title;
        chip.querySelector(".quest-chip-xp").textContent = state.xp + " XP";
    }

    function mountChip() {
        if (document.getElementById("quest-chip")) return;
        var help = document.getElementById("open-guide-modal");
        if (!help) return;
        var chip = el("button", "quest-chip");
        chip.id = "quest-chip";
        chip.type = "button";
        chip.setAttribute("aria-haspopup", "dialog");
        chip.setAttribute("aria-label", "Open your Field Journal: missions, field guide, badges and fleet");
        chip.appendChild(el("span", "quest-chip-icon", "🧭"));
        var txt = el("span", "quest-chip-text");
        txt.appendChild(el("span", "quest-chip-rank"));
        txt.appendChild(el("span", "quest-chip-xp"));
        chip.appendChild(txt);
        chip.addEventListener("click", function () { openJournal(); });
        help.parentNode.insertBefore(chip, help);
        renderChip();
    }

    var journalTab = "missions";
    var lastFocus = null;
    function openJournal(tab) {
        if (tab) journalTab = tab;
        ensureDaily();
        var ov = document.getElementById("quest-journal");
        if (!ov) {
            ov = el("div", "quest-overlay");
            ov.id = "quest-journal";
            ov.addEventListener("click", function (e) { if (e.target === ov) closeJournal(); });
            ov.addEventListener("keydown", function (e) { if (e.key === "Escape") closeJournal(); });
            document.body.appendChild(ov);
        }
        lastFocus = document.activeElement;
        ov.hidden = false;
        renderJournal();
        var first = ov.querySelector(".quest-tab.is-active");
        if (first) first.focus();
    }
    function closeJournal() {
        var ov = document.getElementById("quest-journal");
        if (ov) ov.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function renderJournal() {
        var ov = document.getElementById("quest-journal");
        if (!ov) return;
        ov.replaceChildren();
        var dlg = el("div", "quest-dialog");
        dlg.setAttribute("role", "dialog");
        dlg.setAttribute("aria-modal", "true");
        dlg.setAttribute("aria-labelledby", "quest-title");
        var head = el("div", "quest-head");
        var r = rankIndex(state.xp);
        var title = el("h2", "quest-title", "🧭 Field Journal");
        title.id = "quest-title";
        head.appendChild(title);
        var close = el("button", "quest-close", "✕");
        close.type = "button";
        close.setAttribute("aria-label", "Close the Field Journal");
        close.addEventListener("click", closeJournal);
        head.appendChild(close);
        dlg.appendChild(head);

        // rank bar
        var next = D.RANKS[r + 1];
        var bar = el("div", "quest-rankbar");
        bar.appendChild(el("p", "quest-rank-title", D.RANKS[r].title + " · " + state.xp + " XP"));
        var track = el("div", "quest-track");
        var fill = el("div", "quest-fill");
        var pct = next ? Math.round((state.xp - D.RANKS[r].xp) / (next.xp - D.RANKS[r].xp) * 100) : 100;
        fill.style.width = pct + "%";
        track.appendChild(fill);
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-valuenow", String(pct));
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-label", next ? "Progress to " + next.title : "Top rank reached");
        bar.appendChild(track);
        bar.appendChild(el("p", "quest-rank-next", next ? (next.xp - state.xp) + " XP to " + next.title : "You command the whole survey fleet!"));
        dlg.appendChild(bar);

        // settings
        var set = el("div", "quest-settings");
        set.appendChild(segmented("Level", [["cadet", "🧒 Cadet"], ["scientist", "🥼 Scientist"]], state.mode, function (v) { state.mode = v; save(); renderJournal(); refreshPopup(); }));
        set.appendChild(segmented("Questions in popups", [["on", "On"], ["off", "Off"]], state.on ? "on" : "off", function (v) { state.on = v === "on"; save(); renderJournal(); refreshPopup(); }));
        dlg.appendChild(set);

        // tabs
        var tabs = el("div", "quest-tabs");
        tabs.setAttribute("role", "tablist");
        [["missions", "Missions"], ["guide", "Field Guide"], ["badges", "Badges"], ["fleet", "Fleet"]].forEach(function (t) {
            var b = el("button", "quest-tab" + (journalTab === t[0] ? " is-active" : ""), t[1]);
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", String(journalTab === t[0]));
            b.addEventListener("click", function () { journalTab = t[0]; renderJournal(); var a = document.querySelector(".quest-tab.is-active"); if (a) a.focus(); });
            tabs.appendChild(b);
        });
        dlg.appendChild(tabs);
        var panel = el("div", "quest-panel");
        panel.setAttribute("role", "tabpanel");
        ({ missions: renderMissions, guide: renderGuide, badges: renderBadges, fleet: renderFleet })[journalTab](panel);
        dlg.appendChild(panel);
        ov.appendChild(dlg);
    }

    function segmented(label, options, value, onChange) {
        var wrap = el("div", "quest-seg");
        wrap.appendChild(el("span", "quest-seg-label", label));
        var group = el("div", "quest-seg-group");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", label);
        options.forEach(function (o) {
            var b = el("button", "quest-seg-btn" + (o[0] === value ? " is-active" : ""), o[1]);
            b.type = "button";
            b.setAttribute("aria-pressed", String(o[0] === value));
            b.addEventListener("click", function () { onChange(o[0]); });
            group.appendChild(b);
        });
        wrap.appendChild(group);
        return wrap;
    }

    function renderMissions(panel) {
        var daily = ensureDaily();
        panel.appendChild(el("p", "quest-note", "Three missions a day, picked from the quakes on the map right now. New ones tomorrow."));
        daily.missions.forEach(function (id) {
            var m = missionDef(id);
            var row = el("div", "quest-mission" + (daily.done[id] ? " is-done" : ""));
            row.appendChild(el("span", "quest-mission-icon", daily.done[id] ? "✅" : m.icon));
            var body = el("div", "quest-mission-body");
            body.appendChild(el("p", "quest-mission-text", m.text));
            if (m.goal) body.appendChild(el("p", "quest-mission-progress", Math.min(daily[m.stat], m.goal) + " / " + m.goal));
            row.appendChild(body);
            if (m.match && !daily.done[id]) {
                var target = findMissionQuake(m);
                if (target) {
                    var go = el("button", "quest-go", "Show me one");
                    go.type = "button";
                    go.addEventListener("click", function () { closeJournal(); if (typeof flyToQuake === "function") flyToQuake(target); });
                    row.appendChild(go);
                }
            }
            panel.appendChild(row);
        });
        var s = state.stats;
        panel.appendChild(el("p", "quest-note", "All time: " + s.predictions + " predictions, " + s.right + " right, best streak " + s.bestStreak + "."));
    }

    function findMissionQuake(m) {
        var feats = (typeof currentGeojson !== "undefined" && currentGeojson && currentGeojson.features) || [];
        for (var i = 0; i < feats.length; i++) {
            var c = classifyQuake(feats[i]);
            if (c && m.match(c) && !state.answers[c.id]) return feats[i];
        }
        return null;
    }

    function renderGuide(panel) {
        var total = D.CATEGORIES.length, have = Object.keys(state.collected).filter(function (k) { return D.CATEGORIES.some(function (c) { return c.key === k; }); }).length;
        panel.appendChild(el("p", "quest-note", "Your field guide: " + have + " of " + total + " kinds of quake logged. Predict a quake to log every kind it belongs to. Tap one you've logged to read about it."));
        var groups = {};
        D.CATEGORIES.forEach(function (cat) { (groups[cat.group] = groups[cat.group] || []).push(cat); });
        Object.keys(groups).forEach(function (g) {
            panel.appendChild(el("h3", "quest-group", g));
            var grid = el("div", "quest-grid");
            groups[g].forEach(function (cat) {
                var got = Boolean(state.collected[cat.key]);
                var card = el("button", "quest-card" + (got ? " is-got" : ""));
                card.type = "button";
                card.appendChild(el("span", "quest-card-icon", got ? cat.icon : "?"));
                card.appendChild(el("span", "quest-card-label", cat.label));
                card.setAttribute("aria-label", cat.label + (got ? ", logged" : ", not logged yet"));
                card.addEventListener("click", function () {
                    var lesson = panel.querySelector(".quest-lesson-card");
                    if (lesson) lesson.remove();
                    var box = el("div", "quest-lesson-card");
                    box.appendChild(el("p", "quest-lesson-title", cat.icon + " " + cat.label));
                    box.appendChild(el("p", null, got ? cat.lesson[state.mode === "scientist" ? "scientist" : "cadet"] : "Not logged yet. Find a quake like this on the map and make a prediction on it."));
                    grid.after(box);
                });
                grid.appendChild(card);
            });
            panel.appendChild(grid);
        });
    }

    function renderBadges(panel) {
        panel.appendChild(el("p", "quest-note", Object.keys(state.badges).length + " of " + D.BADGES.length + " badges earned."));
        var grid = el("div", "quest-grid quest-badges");
        D.BADGES.forEach(function (b) {
            var got = Boolean(state.badges[b.id]);
            var card = el("div", "quest-card" + (got ? " is-got" : ""));
            card.appendChild(el("span", "quest-card-icon", got ? b.icon : "🔒"));
            card.appendChild(el("span", "quest-card-label", b.label));
            card.appendChild(el("span", "quest-card-desc", b.desc));
            grid.appendChild(card);
        });
        panel.appendChild(grid);
    }

    function renderFleet(panel) {
        var fleet = typeof SATELLITE_FLEET !== "undefined" ? SATELLITE_FLEET : [];
        var r = rankIndex(state.xp);
        panel.appendChild(el("p", "quest-note", "Each rank puts another survey airship under your command. Pick your flagship and fly with it."));
        fleet.forEach(function (ship, i) {
            var unlocked = i <= r;
            var row = el("div", "quest-ship" + (unlocked ? "" : " is-locked") + (state.ship === i ? " is-flagship" : ""));
            var dot = el("span", "quest-ship-dot");
            dot.style.background = ship.color || "#fbbf24";
            row.appendChild(dot);
            var body = el("div", "quest-ship-body");
            body.appendChild(el("p", "quest-ship-name", ship.name + (state.ship === i ? " · flagship" : "")));
            body.appendChild(el("p", "quest-ship-meta", unlocked ? ship.tier : "Unlocks at " + D.RANKS[i].title + " (" + D.RANKS[i].xp + " XP)"));
            row.appendChild(body);
            if (unlocked) {
                if (state.ship !== i) {
                    var pick = el("button", "quest-go", "Make flagship");
                    pick.type = "button";
                    pick.addEventListener("click", function () { state.ship = i; save(); renderJournal(); });
                    row.appendChild(pick);
                } else {
                    var fly = el("button", "quest-go", "Fly with her");
                    fly.type = "button";
                    fly.addEventListener("click", function () { closeJournal(); if (typeof showAirshipPopup === "function") showAirshipPopup(null, i); });
                    row.appendChild(fly);
                }
            }
            panel.appendChild(row);
        });
    }

    function init() {
        mountChip();
        if (!state.introSeen) {
            state.introSeen = true;
            save();
            setTimeout(function () { toast("🧭", "New: Quake Quest! Tap a quake and predict before you peek. Your Field Journal is at the top."); }, 2500);
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.quakeQuest = {
        renderPopupGate: renderPopupGate,
        openJournal: openJournal,
        getState: function () { return state; },
        resetForTests: function () { state = defaultState(); classCache.clear(); },
        science: {
            depthClass: depthClass, magnitudeClass: magnitudeClass, tntTonnes: tntTonnes, formatTnt: formatTnt,
            segmentDistanceKm: segmentDistanceKm, buildBoundaryIndex: buildBoundaryIndex, classifyBoundary: classifyBoundary,
            classifyQuake: classifyQuake, categoriesFor: categoriesFor, buildQuestion: buildQuestion, questionKinds: questionKinds,
            recordAnswer: recordAnswer, rankIndex: rankIndex, ensureDaily: ensureDaily
        }
    };
}());
