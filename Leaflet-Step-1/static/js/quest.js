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
            pager: Boolean(p.pager),
            time: Number(p.time) || 0
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
            v: 1, on: true, mode: "cadet", xp: 0, introSeen: false,
            // the fleet: ships you own (fleet indices, in the order they joined), the one in use,
            // and how many promotion picks you have spent (one pick per rank above Cadet)
            ships: [], ship: null, picksUsed: 0, fleetIntroSeen: false,
            answers: {}, collected: {}, badges: {},
            stats: {
                predictions: 0, right: 0, streak: 0, bestStreak: 0, tutorAsks: 0, missionDays: 0, scientistPredictions: 0,
                // counters behind the ships' deeds
                missionsDone: 0, deepPredictions: 0, oceanPredictions: 0, boundaryRight: 0, faultPredictions: 0,
                bigPredictions: 0, freshPredictions: 0, scans: 0
            },
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
        // saves from before earnable ships had every ship by rank: they choose a starter and
        // keep one pick per rank they already hold
        if (!Array.isArray(s.ships)) { s.ships = []; s.ship = null; s.picksUsed = 0; }
        if (s.ships.indexOf(s.ship) === -1) s.ship = s.ships.length ? s.ships[0] : null;
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
        if (typeof scheduleCloudSave === "function") scheduleCloudSave();
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
        queueLog(c.id, state.answers[c.id]);

        // deed counters (what kinds of quakes you've predicted)
        if (c.depth >= 70) state.stats.deepPredictions++;
        if (c.region === "ocean") state.stats.oceanPredictions++;
        if (ok && q.kind === "boundary") state.stats.boundaryRight++;
        if (c.boundary.kind === "transform" || c.boundary.kind === "collision") state.stats.faultPredictions++;
        if (c.mag >= 5) state.stats.bigPredictions++;
        if (c.time && Date.now() - c.time <= 3600 * 1000) state.stats.freshPredictions++;

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
                state.stats.missionsDone++;
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
        awardShipsByDeed().forEach(function (ev) { events.push(ev); });
        var after = rankIndex(state.xp);
        if (after > before) {
            var canPick = picksAvailable() > 0;
            events.push({ icon: "🎖️", text: "Promoted to " + D.RANKS[after].title + "!" + (canPick ? " Choose a new airship in your Field Journal." : "") });
        }
        save();
        return { ok: ok, gained: gained, events: events, rankUp: after > before };
    }

    // ---- the fleet: a starter of your choice, one more per promotion, or earned early by deeds
    function fleetSize() { return typeof SATELLITE_FLEET !== "undefined" ? SATELLITE_FLEET.length : D.SHIPS.length; }
    function owns(i) { return state.ships.indexOf(i) !== -1; }
    function needsStarter() { return state.ships.length === 0; }
    function picksAvailable() {
        if (needsStarter()) return 0;
        var unowned = fleetSize() - state.ships.length;
        return Math.max(0, Math.min(unowned, rankIndex(state.xp) - state.picksUsed));
    }
    // how: "starter", "pick" (a promotion) or "deed"; returns false if not allowed
    function addShip(i, how) {
        if (i < 0 || i >= fleetSize() || owns(i)) return false;
        if (how === "starter" && !needsStarter()) return false;
        if (how === "pick" && picksAvailable() < 1) return false;
        if (how === "deed" && (needsStarter() || !D.SHIPS[i].deedTest(state))) return false;
        state.ships.push(i);
        if (how === "pick") state.picksUsed++;
        if (state.ship === null) state.ship = i;
        return true;
    }
    // deeds count only once you have a starter (the starter is always your own choice)
    function awardShipsByDeed() {
        var events = [];
        if (needsStarter()) return events;
        D.SHIPS.forEach(function (s, i) {
            if (owns(i) || !s.deedTest(state)) return;
            addShip(i, "deed");
            events.push({ icon: "🛸", text: shipName(i) + " joins your fleet for your deed: " + s.deed.toLowerCase() + "! Its " + s.instrument + " finds " + s.finds + "." });
        });
        return events;
    }
    function chooseShip(i, how) {
        if (!addShip(i, how)) return false;
        awardShipsByDeed().forEach(function (ev) { setTimeout(function () { toast(ev.icon, ev.text); }, 600); });
        save();
        renderScanButton();
        return true;
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

    // ================================================================ gamer tags (Emberkite accounts)
    // One tag for every Emberkite game: tags, PINs, recovery and transfer codes are handled
    // by Bhalo's Airship Dash's API (the shared player database); Quake Quest's own cloud
    // save, activity log and leaderboard are on this site's Worker (/api/quest/*).
    var ACCOUNT_KEY = "emberkite.player";
    var LOG_QUEUE_KEY = "quakeQuest.logQueue";
    var ON_LOCALHOST = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    var ID_API = (function () {
        var url = "https://airshipdash.emberkitegames.com/api";
        if (ON_LOCALHOST) { try { url = localStorage.getItem("emberkite.idApi") || url; } catch (e) { /* ignore */ } } // tests point it at a local emulator
        return url;
    }());
    var QUEST_API = location.port === "3000" && ON_LOCALHOST ? "http://localhost:8787/api/quest" : "/api/quest";
    var accountsAvailable = !/\.github\.io$/.test(location.hostname);

    function lsRead(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } }
    function lsWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } }
    var account = lsRead(ACCOUNT_KEY, null); // { id, tag, hasPin, token }
    function signedIn() { return Boolean(account && account.tag && account.token); }

    function post(url, body) {
        return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (data) {
                    return r.ok ? { ok: true, data: data } : { ok: false, status: r.status, error: data.error || "Something went wrong." };
                });
            })
            .catch(function () { return { ok: false, offline: true, error: "Can't reach the player service right now. Your progress stays on this device." }; });
    }

    // ---- merging this device's progress with the cloud's: nothing earned is ever lost
    function mergeStates(local, cloud) {
        var out = JSON.parse(JSON.stringify(local));
        if (!cloud || cloud.v !== 1) return out;
        out.xp = Math.max(local.xp || 0, cloud.xp || 0);
        Object.keys(cloud.stats || {}).forEach(function (k) { out.stats[k] = Math.max(out.stats[k] || 0, cloud.stats[k] || 0); });
        ["collected", "badges", "answers"].forEach(function (k) {
            Object.keys(cloud[k] || {}).forEach(function (key) { if (!out[k][key]) out[k][key] = cloud[k][key]; });
        });
        (cloud.ships || []).forEach(function (i) { if (out.ships.indexOf(i) === -1) out.ships.push(i); });
        out.picksUsed = Math.max(local.picksUsed || 0, cloud.picksUsed || 0);
        if (out.ships.indexOf(out.ship) === -1) out.ship = out.ships.length ? out.ships[0] : null;
        if (cloud.daily && (!local.daily || cloud.daily.date > local.daily.date
            || (cloud.daily.date === local.daily.date && (cloud.daily.predictedToday || 0) > (local.daily.predictedToday || 0)))) out.daily = cloud.daily;
        out.introSeen = true;
        out.fleetIntroSeen = local.fleetIntroSeen || cloud.fleetIntroSeen;
        return out;
    }

    var cloudTimer = null;
    var cloudStatus = ""; // shown in the Journal
    function scheduleCloudSave() {
        if (!signedIn() || !accountsAvailable) return;
        clearTimeout(cloudTimer);
        cloudTimer = setTimeout(cloudSave, 2500);
    }
    function cloudSave() {
        if (!signedIn()) return Promise.resolve(false);
        return post(QUEST_API + "/save", { token: account.token, data: state }).then(function (r) {
            cloudStatus = r.ok ? "Saved to the cloud " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : r.error;
            if (r.status === 401) signOut(true);
            return r.ok;
        });
    }
    function cloudSync() {
        if (!signedIn() || !accountsAvailable) return Promise.resolve(false);
        return post(QUEST_API + "/load", { token: account.token }).then(function (r) {
            if (!r.ok) { cloudStatus = r.error; if (r.status === 401) signOut(true); return false; }
            state = mergeStates(state, r.data.data);
            try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
            renderChip(); renderScanButton();
            return cloudSave().then(function () { flushLog(); return true; });
        });
    }

    // ---- the activity log: every prediction, queued here and sent when signed in
    function queueLog(id, rec) {
        if (!rec || rec.skip) return;
        var q = lsRead(LOG_QUEUE_KEY, []);
        q.push({ id: id, k: rec.k, g: rec.g, a: rec.a, t: rec.t });
        lsWrite(LOG_QUEUE_KEY, q.slice(-500));
        flushLog();
    }
    var flushing = false;
    function flushLog() {
        if (!signedIn() || flushing || !accountsAvailable) return;
        var q = lsRead(LOG_QUEUE_KEY, []);
        if (!q.length) return;
        flushing = true;
        var batch = q.slice(0, 25);
        post(QUEST_API + "/log", { token: account.token, entries: batch }).then(function (r) {
            flushing = false;
            if (!r.ok) return; // offline or refused: try again later
            lsWrite(LOG_QUEUE_KEY, lsRead(LOG_QUEUE_KEY, []).slice(batch.length));
            if (lsRead(LOG_QUEUE_KEY, []).length) flushLog();
        });
    }
    // first sign-in on a device: this device's past predictions go into the log too
    function backfillLog() {
        var q = lsRead(LOG_QUEUE_KEY, []);
        var queued = {};
        q.forEach(function (e) { queued[e.id] = true; });
        Object.keys(state.answers).forEach(function (id) {
            var rec = state.answers[id];
            if (!rec.skip && rec.k && !queued[id]) q.push({ id: id, k: rec.k, g: rec.g, a: rec.a, t: rec.t });
        });
        q.sort(function (a, b) { return a.t - b.t; });
        lsWrite(LOG_QUEUE_KEY, q.slice(-500));
    }

    function useAccount(data, how) {
        account = { id: data.id, tag: data.tag, hasPin: Boolean(data.hasPin), token: data.token };
        lsWrite(ACCOUNT_KEY, account);
        backfillLog();
        cloudStatus = "Syncing…";
        return cloudSync().then(function () {
            toast("☁️", (how === "claim" ? "Emberkite tag " + account.tag + " is yours" : "Signed in as " + account.tag) + ". Your Quake Quest progress is saved to the cloud.");
            renderJournal();
        });
    }
    function signOut(expired) {
        account = null;
        try { localStorage.removeItem(ACCOUNT_KEY); } catch (e) { /* ignore */ }
        cloudStatus = expired ? "This device was signed out. Sign in again to keep saving to the cloud." : "";
        renderJournal();
    }

    // ---- the leaderboard
    function loadBoard() {
        return post(QUEST_API + "/board", signedIn() ? { token: account.token } : {});
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

    // ================================================================ scanning (each ship's instrument)
    function shipColor(i) {
        var fleet = typeof SATELLITE_FLEET !== "undefined" ? SATELLITE_FLEET : null;
        return (fleet && fleet[i] && fleet[i].color) || "#fbbf24";
    }
    function scanContext() {
        var daily = ensureDaily();
        return {
            newKinds: function (c) { return categoriesFor(c).some(function (k) { return !state.collected[k]; }); },
            missionMatch: function (c) {
                return daily.missions.some(function (id) { var m = missionDef(id); return m.match && !daily.done[id] && m.match(c); });
            }
        };
    }
    // quakes on the map you haven't predicted that this ship's instrument picks up
    function scanMatches(i) {
        var s = D.SHIPS[i];
        var ctx = scanContext();
        var feats = (typeof currentGeojson !== "undefined" && currentGeojson && currentGeojson.features) || [];
        var hits = feats.filter(function (f) {
            var c = classifyQuake(f);
            return c && !state.answers[c.id] && s.match(c, ctx);
        });
        hits.sort(s.sort === "time"
            ? function (a, b) { return Number(b.properties.time) - Number(a.properties.time); }
            : function (a, b) { return Number(b.properties.mag) - Number(a.properties.mag); });
        return hits;
    }

    var scan = null; // { ship, hits, next }
    function getMap() {
        return window.earthquakeApp && typeof window.earthquakeApp.getMap === "function" ? window.earthquakeApp.getMap() : null;
    }
    // (map.isStyleLoaded() stays false while the airships animate, so just try, and retry
    // briefly if the map isn't ready for a new layer yet)
    function setScanRings(hits, color, tries) {
        var map = getMap();
        if (!map || !map.getSource) return;
        var data = { type: "FeatureCollection", features: hits.map(function (f) { return { type: "Feature", geometry: f.geometry, properties: {} }; }) };
        try {
            if (!map.getSource("quest-scan")) {
                if (!hits.length) return;
                map.addSource("quest-scan", { type: "geojson", data: data });
                map.addLayer({
                    id: "quest-scan-rings", type: "circle", source: "quest-scan",
                    paint: { "circle-radius": 15, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": color, "circle-stroke-opacity": 0.95 }
                });
            } else {
                map.getSource("quest-scan").setData(data);
                map.setPaintProperty("quest-scan-rings", "circle-stroke-color", color);
            }
        } catch (e) {
            if ((tries || 0) < 10) setTimeout(function () { setScanRings(hits, color, (tries || 0) + 1); }, 300);
        }
    }

    function startScan() {
        if (needsStarter()) { openJournal("fleet"); return; }
        var i = state.ship;
        scan = { ship: i, hits: scanMatches(i), next: 0 };
        state.stats.scans++;
        save();
        setScanRings(scan.hits, shipColor(i));
        renderScanPanel();
    }
    function endScan() {
        scan = null;
        setScanRings([], "#fbbf24");
        renderScanPanel();
    }
    function flyToNextHit() {
        if (!scan || !scan.hits.length) return;
        // skip any predicted since the scan started
        while (scan.next < scan.hits.length && state.answers[classifyQuake(scan.hits[scan.next]).id]) scan.next++;
        if (scan.next >= scan.hits.length) { scan.hits = scanMatches(scan.ship); scan.next = 0; setScanRings(scan.hits, shipColor(scan.ship)); }
        if (!scan.hits.length) { renderScanPanel(); return; }
        var target = scan.hits[scan.next];
        scan.next++;
        renderScanPanel();
        if (typeof flyToQuake === "function") flyToQuake(target);
    }

    function renderScanButton() {
        var btn = document.getElementById("quest-scan-btn");
        if (!btn) return;
        btn.hidden = !state.on;
        var dot = btn.querySelector(".quest-scan-dot");
        dot.style.background = needsStarter() ? "#94a3b8" : shipColor(state.ship);
        btn.setAttribute("aria-label", needsStarter() ? "Choose your first airship to start scanning for quakes"
            : "Scan with " + shipName(state.ship) + "'s " + D.SHIPS[state.ship].instrument);
    }
    function renderScanPanel() {
        var host = document.getElementById("map-id");
        var panel = document.getElementById("quest-scan-panel");
        if (!scan) { if (panel) panel.hidden = true; return; }
        if (!panel) {
            panel = el("div", "quest-scan-panel");
            panel.id = "quest-scan-panel";
            panel.setAttribute("role", "region");
            panel.setAttribute("aria-live", "polite");
            host.appendChild(panel);
        }
        panel.hidden = false;
        panel.replaceChildren();
        var s = D.SHIPS[scan.ship];
        var head = el("div", "quest-scan-head");
        var dot = el("span", "quest-scan-dot");
        dot.style.background = shipColor(scan.ship);
        head.appendChild(dot);
        head.appendChild(el("p", "quest-scan-title", s.icon + " " + shipName(scan.ship) + " · " + s.instrument));
        var x = el("button", "quest-scan-close", "✕");
        x.type = "button";
        x.setAttribute("aria-label", "Stop scanning");
        x.addEventListener("click", endScan);
        head.appendChild(x);
        panel.appendChild(head);
        var n = scan.hits.length;
        panel.appendChild(el("p", "quest-scan-text", n
            ? (n === 1 ? "1 quake found" : n + " quakes found") + " that you haven't predicted yet, ringed on the map"
              + (n > 1 ? (s.sort === "time" ? ", newest first." : ", biggest first.") : ".")
            : "Nothing new for this instrument on the map right now. Try another airship, or a longer time range."));
        var row = el("div", "quest-scan-actions");
        if (n) {
            var go = el("button", "quest-go", scan.next === 0 ? "Fly to the first" : "Fly to the next (" + Math.min(scan.next + 1, n) + " of " + n + ")");
            go.type = "button";
            go.addEventListener("click", flyToNextHit);
            row.appendChild(go);
        }
        if (state.ships.length > 1) {
            var sw = el("button", "quest-scan-switch", "Change airship");
            sw.type = "button";
            sw.addEventListener("click", function () { openJournal("fleet"); });
            row.appendChild(sw);
        }
        panel.appendChild(row);
    }
    function mountScanButton() {
        var host = document.getElementById("map-id");
        if (!host || document.getElementById("quest-scan-btn")) return;
        var btn = el("button", "quest-scan-btn");
        btn.id = "quest-scan-btn";
        btn.type = "button";
        btn.appendChild(el("span", "quest-scan-dot"));
        btn.appendChild(el("span", null, "📡 Scan"));
        btn.addEventListener("click", function () { if (scan) endScan(); else startScan(); });
        host.appendChild(btn);
        renderScanButton();
    }

    // ================================================================ header chip + journal
    function renderChip() {
        var chip = document.getElementById("quest-chip");
        if (!chip) return;
        var r = rankIndex(state.xp);
        chip.querySelector(".quest-chip-rank").textContent = D.RANKS[r].title;
        chip.querySelector(".quest-chip-xp").textContent = state.xp + " XP";
        // a dot when there's a ship to choose (the starter, or a promotion pick)
        chip.classList.toggle("has-pick", needsStarter() || picksAvailable() > 0);
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
        else if (needsStarter() || picksAvailable() > 0) journalTab = "fleet"; // a ship to choose comes first
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
        if (accountsAvailable) dlg.appendChild(renderAccount());

        // settings
        var set = el("div", "quest-settings");
        set.appendChild(segmented("Level", [["cadet", "🧒 Cadet"], ["scientist", "🥼 Scientist"]], state.mode, function (v) { state.mode = v; save(); renderJournal(); refreshPopup(); }));
        set.appendChild(segmented("Questions in popups", [["on", "On"], ["off", "Off"]], state.on ? "on" : "off", function (v) { state.on = v === "on"; save(); if (!state.on) endScan(); renderScanButton(); renderJournal(); refreshPopup(); }));
        dlg.appendChild(set);

        // tabs
        var tabs = el("div", "quest-tabs");
        tabs.setAttribute("role", "tablist");
        [["missions", "Missions"], ["guide", "Field Guide"], ["badges", "Badges"], ["fleet", "Fleet"]].concat(accountsAvailable ? [["leaders", "Leaders"]] : []).forEach(function (t) {
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
        ({ missions: renderMissions, guide: renderGuide, badges: renderBadges, fleet: renderFleet, leaders: renderLeaders })[journalTab](panel);
        dlg.appendChild(panel);
        ov.appendChild(dlg);
    }

    // ---- the account panel: claim a tag, sign in (tag + PIN, or a transfer code), or who you are
    var accountView = "idle";     // idle | claim | signin | code
    var accountMsg = "";
    var shownRecovery = null;     // a new recovery code, shown once
    var draftTag = "";            // kept when a form redraws (after an error)
    function field(label, attrs) {
        var wrap = el("label", "quest-field");
        wrap.appendChild(el("span", "quest-field-label", label));
        var input = el("input", "quest-input");
        Object.keys(attrs).forEach(function (k) { input.setAttribute(k, attrs[k]); });
        wrap.appendChild(input);
        return { wrap: wrap, input: input };
    }
    function renderAccount() {
        var box = el("div", "quest-account");
        if (shownRecovery) {
            box.appendChild(el("p", "quest-account-title", "🔑 Write this recovery code down"));
            box.appendChild(el("p", "quest-recovery", shownRecovery));
            box.appendChild(el("p", "quest-note", "If you ever forget your PIN, this code sets a new one. It's shown only now, and it works in Bhalo's Airship Dash too."));
            box.appendChild(button("I've written it down", "quest-go", function () { shownRecovery = null; renderJournal(); }));
            return box;
        }
        if (signedIn()) {
            box.appendChild(el("p", "quest-account-title", "🛡️ Playing as " + account.tag));
            box.appendChild(el("p", "quest-note", (cloudStatus || "Your progress is saved to the cloud.") + " The same tag works in Bhalo's Airship Dash."));
            var acts = el("div", "quest-account-actions");
            acts.appendChild(button("Leaderboard", "quest-go", function () { journalTab = "leaders"; renderJournal(); }));
            acts.appendChild(button("Sign out", "quest-go quest-go-quiet", function () { signOut(false); }));
            box.appendChild(acts);
            return box;
        }
        if (accountView === "idle") {
            box.appendChild(el("p", "quest-account-title", "Playing on this device only"));
            box.appendChild(el("p", "quest-note", "Claim an Emberkite tag (your gamer tag for every Emberkite game) to save your progress to the cloud, play on any device and join the leaderboard. Already have one from Bhalo's Airship Dash? Sign in with it."));
            var a = el("div", "quest-account-actions");
            a.appendChild(button("Claim an Emberkite tag", "quest-go", function () { accountView = "claim"; accountMsg = ""; renderJournal(); }));
            a.appendChild(button("Sign in", "quest-go quest-go-quiet", function () { accountView = "signin"; accountMsg = ""; renderJournal(); }));
            box.appendChild(a);
            return box;
        }
        var form = el("form", "quest-account-form");
        form.setAttribute("novalidate", "");
        var tag = null, pin = null, code = null;
        if (accountView === "claim") {
            box.appendChild(el("p", "quest-account-title", "Claim an Emberkite tag"));
            box.appendChild(el("p", "quest-note", "3 to 16 letters, numbers, _ or -. Don't use your real name. A 4-digit PIN lets you sign in on other devices."));
            tag = field("Emberkite tag", { autocomplete: "off", maxlength: "16", spellcheck: "false", autocapitalize: "off" });
            pin = field("PIN (optional, 4 digits)", { inputmode: "numeric", maxlength: "4", autocomplete: "off", pattern: "[0-9]*" });
            form.appendChild(tag.wrap); form.appendChild(pin.wrap);
            tag.input.value = draftTag; tag.input.addEventListener("input", function () { draftTag = tag.input.value; });
        } else if (accountView === "signin") {
            box.appendChild(el("p", "quest-account-title", "Sign in"));
            tag = field("Emberkite tag", { autocomplete: "username", maxlength: "16", spellcheck: "false", autocapitalize: "off" });
            pin = field("PIN", { inputmode: "numeric", maxlength: "4", autocomplete: "off", pattern: "[0-9]*" });
            form.appendChild(tag.wrap); form.appendChild(pin.wrap);
            tag.input.value = draftTag; tag.input.addEventListener("input", function () { draftTag = tag.input.value; });
        } else {
            box.appendChild(el("p", "quest-account-title", "Sign in with a transfer code"));
            box.appendChild(el("p", "quest-note", "On a device where you're signed in (here or in Bhalo's Airship Dash), ask for a transfer code and type it here within 10 minutes."));
            code = field("Transfer code", { autocomplete: "off", maxlength: "9", spellcheck: "false", autocapitalize: "characters" });
            form.appendChild(code.wrap);
        }
        if (accountMsg) form.appendChild(el("p", "quest-account-error", accountMsg));
        var row = el("div", "quest-account-actions");
        var submit = el("button", "quest-go", accountView === "claim" ? "Claim it" : "Sign in");
        submit.type = "submit";
        row.appendChild(submit);
        if (accountView === "signin") row.appendChild(button("Use a transfer code", "quest-go quest-go-quiet", function () { accountView = "code"; accountMsg = ""; renderJournal(); }));
        row.appendChild(button("Cancel", "quest-go quest-go-quiet", function () { accountView = "idle"; accountMsg = ""; renderJournal(); }));
        form.appendChild(row);
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            submit.disabled = true;
            var call;
            if (accountView === "claim") {
                var t = tag.input.value.trim(), p = pin.input.value.trim();
                if (!/^[A-Za-z0-9_-]{3,16}$/.test(t)) { accountMsg = "An Emberkite tag is 3 to 16 letters, numbers, _ or -."; renderJournal(); return; }
                if (p && !/^\d{4}$/.test(p)) { accountMsg = "A PIN is exactly 4 digits."; renderJournal(); return; }
                call = post(ID_API + "/player", p ? { tag: t, pin: p } : { tag: t }).then(function (r) {
                    if (r.ok && r.data.recovery) shownRecovery = r.data.recovery;
                    return r;
                });
            } else if (accountView === "signin") {
                call = post(ID_API + "/login", { tag: tag.input.value.trim(), pin: pin.input.value.trim() });
            } else {
                call = post(ID_API + "/redeem", { code: code.input.value.replace(/[^0-9A-Za-z]/g, "") });
            }
            call.then(function (r) {
                if (!r.ok || !r.data.token) { accountMsg = r.error || "That didn't work. Try again."; submit.disabled = false; renderJournal(); return; }
                var how = accountView === "claim" ? "claim" : "signin";
                accountView = "idle"; accountMsg = "";
                useAccount(r.data, how);
            });
        });
        box.appendChild(form);
        setTimeout(function () { var first = box.querySelector("input"); if (first) first.focus(); }, 0);
        return box;
    }

    function renderLeaders(panel) {
        panel.appendChild(el("p", "quest-note", "Top Quake Quest players by XP. XP on the board can't be higher than the predictions the server has logged for a player."));
        var list = el("div", "quest-board");
        list.appendChild(el("p", "quest-note", "Loading…"));
        panel.appendChild(list);
        loadBoard().then(function (r) {
            list.replaceChildren();
            if (!r.ok) { list.appendChild(el("p", "quest-account-error", r.error)); return; }
            if (!r.data.top.length) { list.appendChild(el("p", "quest-note", "No one is on the board yet. Claim an Emberkite tag and make a prediction to be first!")); return; }
            r.data.top.forEach(function (row) {
                var item = el("div", "quest-board-row" + (row.you ? " is-you" : ""));
                item.appendChild(el("span", "quest-board-rank", "#" + row.rank));
                item.appendChild(el("span", "quest-board-tag", row.tag + (row.you ? " (you)" : "")));
                item.appendChild(el("span", "quest-board-xp", row.xp.toLocaleString() + " XP"));
                item.appendChild(el("span", "quest-board-meta", row.predictions + " predictions" + (row.accuracy != null ? " · " + row.accuracy + "% right" : "")));
                list.appendChild(item);
            });
            if (r.data.you && r.data.you.rank > 20) {
                list.appendChild(el("p", "quest-note", "You: #" + r.data.you.rank + " of " + r.data.players + " with " + r.data.you.xp + " XP."));
            } else if (!signedIn()) {
                list.appendChild(el("p", "quest-note", "Claim an Emberkite tag to join the board."));
            }
        });
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

    function button(text, cls, onClick) {
        var b = el("button", cls || "quest-go", text);
        b.type = "button";
        b.addEventListener("click", onClick);
        return b;
    }
    function shipRow(i, extraClass) {
        var fleet = typeof SATELLITE_FLEET !== "undefined" ? SATELLITE_FLEET : [];
        var ship = fleet[i] || {};
        var s = D.SHIPS[i];
        var row = el("div", "quest-ship" + (extraClass ? " " + extraClass : ""));
        var dot = el("span", "quest-ship-dot");
        dot.style.background = ship.color || "#fbbf24";
        row.appendChild(dot);
        var body = el("div", "quest-ship-body");
        body.appendChild(el("p", "quest-ship-name", (ship.name || "Airship") + (state.ship === i && owns(i) ? " · in use" : "")));
        body.appendChild(el("p", "quest-ship-instrument", s.icon + " " + s.instrument + ": finds " + s.finds + "."));
        body.appendChild(el("p", "quest-ship-meta", s[state.mode === "scientist" ? "scientist" : "cadet"]));
        row.appendChild(body);
        return row;
    }

    function renderFleet(panel) {
        var n = fleetSize();
        if (needsStarter()) {
            panel.appendChild(el("p", "quest-note quest-note-strong", "Choose your first airship. Each one carries a different survey instrument that finds certain kinds of quake for you."));
            panel.appendChild(el("p", "quest-note", "You'll add another with every promotion, or sooner by completing a ship's deed."));
            for (var i = 0; i < n; i++) {
                (function (i) {
                    var row = shipRow(i);
                    row.appendChild(button("Choose", "quest-go", function () {
                        if (chooseShip(i, "starter")) {
                            toast("🛸", shipName(i) + " is yours! Tap 📡 Scan on the map to use her " + D.SHIPS[i].instrument + ".");
                            renderJournal();
                        }
                    }));
                    panel.appendChild(row);
                }(i));
            }
            return;
        }
        var picks = picksAvailable();
        panel.appendChild(el("p", "quest-note", "Your fleet: " + state.ships.length + " of " + n + " airships. Tap 📡 Scan on the map to use the one in use."));
        if (picks) {
            panel.appendChild(el("p", "quest-pick-banner", "🎖️ Promotion: you may choose " + (picks === 1 ? "a new airship" : picks + " new airships") + " from the hangar below."));
        }
        state.ships.forEach(function (i) {
            var row = shipRow(i, state.ship === i ? "is-flagship" : "");
            var acts = el("div", "quest-ship-actions");
            if (state.ship !== i) {
                acts.appendChild(button("Use", "quest-go", function () { state.ship = i; save(); renderScanButton(); if (scan) endScan(); renderJournal(); }));
            } else {
                acts.appendChild(button("📡 Scan", "quest-go", function () { closeJournal(); startScan(); }));
            }
            acts.appendChild(button("Fly with her", "quest-go quest-go-quiet", function () { closeJournal(); if (typeof showAirshipPopup === "function") showAirshipPopup(null, i); }));
            row.appendChild(acts);
            panel.appendChild(row);
        });
        var hangar = [];
        for (var j = 0; j < n; j++) if (!owns(j)) hangar.push(j);
        if (hangar.length) {
            panel.appendChild(el("h3", "quest-group", "In the hangar"));
            var r = rankIndex(state.xp);
            var nextRank = D.RANKS[r + 1];
            panel.appendChild(el("p", "quest-note", "Earn one by its deed, or choose one at your next promotion" + (nextRank ? " (" + nextRank.title + ", " + nextRank.xp + " XP)." : ".")));
            hangar.forEach(function (j) {
                var row = shipRow(j, picks ? "" : "is-locked");
                row.querySelector(".quest-ship-body").appendChild(el("p", "quest-ship-deed", "Deed: " + D.SHIPS[j].deed + "."));
                if (picks) {
                    row.appendChild(button("Choose", "quest-go", function () {
                        if (chooseShip(j, "pick")) { toast("🛸", shipName(j) + " joins your fleet!"); renderJournal(); }
                    }));
                }
                panel.appendChild(row);
            });
        }
    }

    function init() {
        mountChip();
        mountScanButton();
        if (signedIn()) cloudSync();                    // progress from your other devices
        window.addEventListener("online", function () { flushLog(); scheduleCloudSave(); });
        if (!state.introSeen) {
            state.introSeen = true;
            state.fleetIntroSeen = true;
            save();
            setTimeout(function () { toast("🧭", "New: Quake Quest! Choose your first airship in the Field Journal at the top, then tap a quake and predict before you peek."); }, 2500);
        } else if (!state.fleetIntroSeen) {
            state.fleetIntroSeen = true;
            save();
            setTimeout(function () { toast("🛸", "New: airships are earned now, and each one helps you find quakes. Choose your first in the Field Journal (🧭)."); }, 2500);
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
            recordAnswer: recordAnswer, rankIndex: rankIndex, ensureDaily: ensureDaily,
            needsStarter: needsStarter, picksAvailable: picksAvailable, chooseShip: chooseShip, owns: owns, scanMatches: scanMatches, awardShipsByDeed: awardShipsByDeed,
            loadState: loadState, mergeStates: mergeStates
        }
    };
}());
