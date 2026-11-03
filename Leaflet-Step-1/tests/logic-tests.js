(function () {
    "use strict";

    var helpers = window.earthquakeApp.test;
    var results = [];

    function assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }

    function assertEqual(actual, expected, message) {
        assert(actual === expected, message + " (expected " + expected + ", received " + actual + ")");
    }

    function test(name, callback) {
        try {
            callback();
            results.push({ name: name, passed: true });
        } catch (error) {
            results.push({ name: name, passed: false, message: error.message });
        }
    }

    test("classifies depth boundaries", function () {
        assertEqual(helpers.getDepthRangeKey(10), "0-10", "10 km boundary");
        assertEqual(helpers.getDepthRangeKey(10.1), "10-30", "value above 10 km");
        assertEqual(helpers.getDepthRangeKey(30), "10-30", "30 km boundary");
        assertEqual(helpers.getDepthRangeKey(90.1), "90+", "value above 90 km");
        assertEqual(helpers.getDepthRangeKey("invalid"), "0-10", "invalid depth fallback");
    });

    test("builds ping colors from the depth palette", function () {
        var fill = helpers.getDepthColorExpression(0);
        var stroke = helpers.getDepthColorExpression(0.62);
        assertEqual(fill[0], "match", "depth color expression type");
        assertEqual(fill[3], "#7ae582", "shallow ping fill");
        assertEqual(fill[13], "#8b0000", "deep ping fill");
        assert(stroke[3] !== fill[3], "ping stroke should lighten the depth color");
        assert(stroke[13] !== fill[13], "deep ping stroke should remain visible");
    });

    test("uses spheres for regular markers at every magnitude", function () {
        assertEqual(helpers.getMagnitudeShapeKey(-0.4), "sphere", "negative magnitude");
        assertEqual(helpers.getMagnitudeShapeKey(2), "sphere", "small magnitude");
        assertEqual(helpers.getMagnitudeShapeKey(5), "sphere", "medium magnitude");
        assertEqual(helpers.getMagnitudeShapeKey(8), "sphere", "large magnitude");
        assertEqual(helpers.getMagnitudeShapeKey("invalid"), "sphere", "invalid magnitude fallback");
    });

    test("uses cubes for human-induced earthquakes across magnitudes", function () {
        assertEqual(helpers.getMagnitudeShapeKey(2.5, true), "cube", "small induced quake uses cube marker");
        assertEqual(helpers.getMagnitudeShapeKey(4.0, { isInduced: true }), "cube", "object with isInduced uses cube marker");
        assertEqual(helpers.getMagnitudeShapeKey(6.0, false), "sphere", "explicit false returns sphere marker");
    });

    test("creates centered faceted cube artwork for induced earthquakes", function () {
        var cube = helpers.createCubeImage("#f59e0b");
        assertEqual(cube.width, 72, "cube canvas width");
        assertEqual(cube.height, 66, "cube canvas height");
        assert(cube.data.length === 72 * 66 * 4, "cube raw pixel buffer size");
        var centerAlpha = cube.data[((36 * cube.width + 36) * 4) + 3];
        assert(centerAlpha > 0, "cube center is painted");
    });

    test("creates centered ringed epicenter artwork for champions", function () {
        var image = helpers.createEpicenterImage("#4dabf7");
        var selection = helpers.createChampionSelectionRingImage();
        assertEqual(image.width, 104, "epicenter canvas width");
        assertEqual(image.height, 104, "epicenter canvas height");
        assert(image.data[((52 * image.width + 52) * 4) + 3] > 0, "epicenter core should occupy the canvas center");
        assertEqual(image.data[3], 0, "epicenter artwork should not clip into the top-left corner");
        assertEqual(selection.width, 128, "champion selection canvas width");
        assertEqual(selection.data[((64 * selection.width + 64) * 4) + 3], 0, "champion selection center should remain transparent");
        assert(selection.data[((6 * selection.width + 64) * 4) + 3] > 0, "champion selection ring should surround the epicenter");
    });

    test("expands and fades staggered champion ping waves", function () {
        var start = helpers.getChampionPingFrame(0, 0);
        var midway = helpers.getChampionPingFrame(1100, 0);
        var staggered = helpers.getChampionPingFrame(0, 0.5);
        var reset = helpers.getChampionPingFrame(2200, 0);
        assertEqual(start.phase, 0, "first wave starts at the epicenter");
        assert(midway.expansion > start.expansion, "ping radius should expand over time");
        assert(midway.opacity < start.opacity, "ping should fade as it expands");
        assertEqual(staggered.phase, midway.phase, "second wave should be half a cycle ahead");
        assertEqual(reset.phase, 0, "ping should restart after one cycle");
    });

    test("honors champion ping motion lifecycle conditions", function () {
        var active = { hasMap: true, hasLayerA: true, hasLayerB: true, quakesVisible: true, hasCandidates: true, documentHidden: false, reducedMotion: false };
        assertEqual(helpers.getChampionPingMotionMode(active), "animated", "visible champion pings should animate");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { reducedMotion: true })), "static", "reduced motion should use stable rings");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { documentHidden: true })), "off", "hidden tabs should stop pings");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { quakesVisible: false })), "off", "hidden earthquakes should stop pings");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { hasLayerA: false })), "off", "missing first ping layer should stop animation");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { hasLayerB: false })), "off", "missing second ping layer should stop animation");
        assertEqual(helpers.getChampionPingMotionMode(Object.assign({}, active, { hasCandidates: false })), "off", "no visible ping candidates should stop animation");

        var reducedState = helpers.handleReducedMotionChange({ matches: true });
        assertEqual(reducedState.reducedMotion, true, "preference handler should detect reduced motion");
        assertEqual(reducedState.autoRotate, false, "enabling reduced motion should stop globe rotation");
        var restoredState = helpers.handleReducedMotionChange({ matches: false });
        assertEqual(restoredState.autoRotate, false, "disabling reduced motion should not restart rotation automatically");
    });

    test("detects ping candidates that survive depth filters", function () {
        var features = [
            { properties: { depthKey: "0-10", isChampion: true, isSummaryHighlight: false } },
            { properties: { depthKey: "90+", isChampion: false, isSummaryHighlight: true } },
            { properties: { depthKey: "10-30", isChampion: false, isSummaryHighlight: false } }
        ];
        assertEqual(helpers.hasVisiblePingCandidates(features, new Set(["0-10"])), true, "visible champion should activate pings");
        assertEqual(helpers.hasVisiblePingCandidates(features, new Set(["90+"])), true, "visible summary highlight should activate pings");
        assertEqual(helpers.hasVisiblePingCandidates(features, new Set(["10-30"])), false, "ordinary visible earthquakes should not keep ping animation running");
        assertEqual(helpers.hasVisiblePingCandidates(features, new Set()), false, "fully filtered candidates should stop pings");
        assertEqual(helpers.hasVisiblePingCandidates([], new Set(["0-10"])), false, "empty feeds should stop pings");
    });

    test("schedules exactly one champion ping frame through lifecycle changes", function () {
        var nextId = 0;
        var pending = new Set();
        var staticPaints = 0;
        function requestFrame() {
            var id = ++nextId;
            pending.add(id);
            return id;
        }
        function cancelFrame(id) {
            pending.delete(id);
        }
        function transition(animationId, mode) {
            return helpers.transitionChampionPingMotion({
                animationId: animationId,
                mode: mode,
                requestFrame: requestFrame,
                cancelFrame: cancelFrame,
                renderFrame: function () {},
                applyStaticFrames: function () { staticPaints += 1; }
            });
        }

        var animationId = transition(null, "animated");
        assertEqual(pending.size, 1, "animation should request one frame");
        animationId = transition(animationId, "animated");
        assertEqual(pending.size, 1, "repeated synchronization should replace rather than duplicate frames");
        animationId = transition(animationId, "static");
        assertEqual(pending.size, 0, "reduced motion should cancel animation");
        assertEqual(staticPaints, 1, "reduced motion should paint stable rings once");
        animationId = transition(animationId, "animated");
        assertEqual(pending.size, 1, "leaving reduced motion should restart the ping frame");
        animationId = transition(animationId, "off");
        assertEqual(pending.size, 0, "hidden tabs or earthquakes should cancel pending frames");
        animationId = transition(animationId, "animated");
        assertEqual(pending.size, 1, "restoring visibility should restart one frame");
        transition(animationId, "off");
        assertEqual(pending.size, 0, "final shutdown should leave no pending frame");
    });

    test("formats embedded marker magnitudes", function () {
        assertEqual(helpers.formatMagnitudeLabel(5), "5.0", "whole magnitude");
        assertEqual(helpers.formatMagnitudeLabel(2.46), "2.5", "rounded magnitude");
        assertEqual(helpers.formatMagnitudeLabel(-0.4), "-0.4", "negative magnitude");
        assertEqual(helpers.formatMagnitudeLabel(-0.04), "0.0", "rounded negative zero");
        assertEqual(helpers.formatMagnitudeLabel(null), "—", "missing magnitude fallback");
        assertEqual(helpers.formatMagnitudeLabel("invalid"), "—", "invalid magnitude fallback");
    });

    test("normalizes magnitudes without treating missing values as zero", function () {
        assertEqual(helpers.getNumericMagnitude(0), 0, "real zero magnitude");
        assertEqual(helpers.getNumericMagnitude(-0.5), -0.5, "negative magnitude");
        assertEqual(helpers.getNumericMagnitude("2.4"), 2.4, "numeric string magnitude");
        assertEqual(helpers.getNumericMagnitude(null), null, "missing magnitude");
        assertEqual(helpers.getNumericMagnitude("invalid"), null, "invalid magnitude");
    });

    test("normalizes valid USGS features and rejects malformed records", function () {
        var normalized = helpers.normalizeEarthquakeFeature({
            id: "test-event",
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.7, 35.7, 12.34] },
            properties: { mag: "-0.4", time: "1767225600000", place: "Test event" }
        });
        assert(normalized, "valid feature should be retained");
        assertEqual(normalized.properties.mag, -0.4, "magnitude normalization");
        assertEqual(normalized.properties.depth, "12.3", "depth formatting");
        assertEqual(normalized.properties.eventId, "test-event", "event identity");
        assertEqual(normalized.properties.magnitudeLabel, "-0.4", "marker label");
        assertEqual(helpers.normalizeEarthquakeFeature({ properties: {} }), null, "missing geometry");
        assertEqual(helpers.normalizeEarthquakeFeature({ type: "Feature", geometry: { type: "Point", coordinates: [200, 0, 10] }, properties: { time: 1 } }), null, "invalid longitude");
        assertEqual(helpers.normalizeEarthquakeFeature({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0, 10] }, properties: { time: "invalid" } }), null, "invalid timestamp");
        assertEqual(helpers.normalizeEarthquakeFeature({ type: "Feature", geometry: { type: "Point", coordinates: [null, 0, 10] }, properties: { time: 1 } }), null, "null longitude");
        assertEqual(helpers.normalizeEarthquakeFeature({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0, 10] }, properties: { time: "" } }), null, "empty timestamp");
        assertEqual(helpers.normalizeEarthquakeFeature({ type: "NotAFeature", geometry: { type: "Point", coordinates: [0, 0, 10] }, properties: { time: 1 } }), null, "invalid GeoJSON type");
    });

    test("detects and normalizes tsunami warning status", function () {
        assertEqual(helpers.hasTsunamiWarning({ properties: { tsunami: 1 } }), true, "tsunami value 1 should indicate active warning");
        assertEqual(helpers.hasTsunamiWarning({ properties: { tsunami: "1" } }), true, "tsunami string '1' should indicate active warning");
        assertEqual(helpers.hasTsunamiWarning({ properties: { tsunami: true } }), true, "tsunami boolean true should indicate active warning");
        assertEqual(helpers.hasTsunamiWarning({ properties: { tsunami: 0 } }), false, "tsunami value 0 should indicate no warning");
        assertEqual(helpers.hasTsunamiWarning({ properties: { tsunami: null } }), false, "tsunami null should indicate no warning");
        assertEqual(helpers.hasTsunamiWarning({ properties: {} }), false, "missing tsunami property should indicate no warning");
        assertEqual(helpers.hasTsunamiWarning(null), false, "null feature should indicate no warning");

        var normalizedWithTsunami = helpers.normalizeEarthquakeFeature({
            id: "tsunami-event",
            type: "Feature",
            geometry: { type: "Point", coordinates: [142.5, 38.3, 20.0] },
            properties: { mag: 8.9, time: 1767225600000, place: "Near east coast of Honshu, Japan", tsunami: 1 }
        });
        assert(normalizedWithTsunami, "feature with tsunami should normalize successfully");
        assertEqual(normalizedWithTsunami.properties.hasTsunami, true, "normalized feature hasTsunami flag should be true");

        var normalizedWithoutTsunami = helpers.normalizeEarthquakeFeature({
            id: "regular-event",
            type: "Feature",
            geometry: { type: "Point", coordinates: [-122.4, 37.8, 8.5] },
            properties: { mag: 3.2, time: 1767225600000, place: "San Francisco Bay area, California", tsunami: 0 }
        });
        assert(normalizedWithoutTsunami, "regular feature should normalize successfully");
        assertEqual(normalizedWithoutTsunami.properties.hasTsunami, false, "normalized feature hasTsunami flag should be false");
    });

    test("calculates active tsunami warning summaries and identifies strongest tsunami event", function () {
        var emptySummary = helpers.getTsunamiSummary([]);
        assertEqual(emptySummary.count, 0, "empty feed has 0 tsunami quakes");
        assertEqual(emptySummary.strongestTsunami, null, "empty feed has no strongest tsunami quake");

        var mixedQuakes = [
            { id: "q1", properties: { mag: 5.5, hasTsunami: false, place: "Nevada" }, geometry: { coordinates: [-117.1, 38.5, 10] } },
            { id: "q2", properties: { mag: 7.2, hasTsunami: true, place: "Offshore Maule, Chile" }, geometry: { coordinates: [-73.5, -35.8, 22] } },
            { id: "q3", properties: { mag: 8.1, hasTsunami: true, place: "Kurile Islands" }, geometry: { coordinates: [154.2, 46.5, 30] } },
            { id: "q4", properties: { mag: 6.8, hasTsunami: false, place: "Tonga" }, geometry: { coordinates: [-175.2, -21.1, 15] } }
        ];

        var summary = helpers.getTsunamiSummary(mixedQuakes);
        assertEqual(summary.count, 2, "identifies exactly 2 tsunami events");
        assertEqual(summary.strongestTsunami.id, "q3", "identifies M8.1 Kurile Islands as strongest tsunami quake");
        assertEqual(summary.features.length, 2, "summary includes array of matching tsunami features");
    });

    test("filters features strictly by active tsunami warning status", function () {
        var quakes = [
            { properties: { mag: 7.0, depthKey: "10-30", hasTsunami: true, place: "Fiji" } },
            { properties: { mag: 6.5, depthKey: "10-30", hasTsunami: false, place: "Vanuatu" } },
            { properties: { mag: 8.0, depthKey: "0-10", hasTsunami: true, place: "Alaska" } }
        ];

        var filteredAll = helpers.getFilteredFeatures(quakes, {
            activeDepthRanges: new Set(["0-10", "10-30"]),
            minMagnitude: 0,
            searchQuery: "",
            tsunamiOnly: false
        });
        assertEqual(filteredAll.length, 3, "regular filter returns all quakes");

        var filteredTsunami = helpers.getFilteredFeatures(quakes, {
            activeDepthRanges: new Set(["0-10", "10-30"]),
            minMagnitude: 0,
            searchQuery: "",
            tsunamiOnly: true
        });
        assertEqual(filteredTsunami.length, 2, "tsunamiOnly filter isolates only tsunami quakes");
        assert(filteredTsunami.every(function (q) { return q.properties.hasTsunami; }), "all filtered results have hasTsunami true");
    });

    test("updates tsunami alert banner DOM state and action controls", function () {
        var banner = document.getElementById("tsunami-alert-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "tsunami-alert-banner";
            banner.hidden = true;
            document.body.appendChild(banner);
        }
        var titleEl = document.getElementById("tsunami-alert-title");
        if (!titleEl) {
            titleEl = document.createElement("strong");
            titleEl.id = "tsunami-alert-title";
            banner.appendChild(titleEl);
        }
        var descEl = document.getElementById("tsunami-alert-desc");
        if (!descEl) {
            descEl = document.createElement("span");
            descEl.id = "tsunami-alert-desc";
            banner.appendChild(descEl);
        }

        // Active tsunami summary
        helpers.updateTsunamiAlertBanner({
            count: 2,
            strongestTsunami: { properties: { mag: 7.8, place: "Offshore Honshu, Japan" } }
        });
        assertEqual(banner.hidden, false, "banner is unhidden when tsunami warnings exist");
        assert(titleEl.textContent.indexOf("TSUNAMI") !== -1, "title mentions TSUNAMI");
        assert(!/WARNING/i.test(titleEl.textContent), "the USGS flag is not a warning; the title must not claim one");
        assert(/not a warning/i.test(descEl.textContent), "description says the flag is not a warning");
        assert(descEl.textContent.indexOf("2") !== -1, "description displays event count");
        assert(descEl.textContent.indexOf("Honshu, Japan") !== -1, "description displays strongest location");

        // Zero tsunami summary
        helpers.updateTsunamiAlertBanner({ count: 0, strongestTsunami: null });
        assertEqual(banner.hidden, true, "banner is hidden when no tsunami warnings exist");
    });

    test("renders tsunami warning badge in earthquake popup content", function () {
        var popupWithTsunami = helpers.buildPopupContent({
            place: "Near Coast of Northern Chile",
            mag: 8.2,
            depth: "25.0",
            time: 1767225600000,
            hasTsunami: true
        });
        var tsunamiBadge = popupWithTsunami.querySelector(".tsunami-popup-badge");
        assert(tsunamiBadge !== null, "popup has tsunami warning badge element");
        assert(tsunamiBadge.textContent.indexOf("Tsunami") !== -1, "badge text mentions Tsunami");
        assert(/not a warning/i.test(tsunamiBadge.textContent), "badge says the flag is not a warning");
        var officialLink = tsunamiBadge.querySelector("a");
        assert(officialLink && officialLink.href === "https://www.tsunami.gov/", "badge links to official tsunami alerts");
        assertEqual(officialLink.rel, "noopener noreferrer", "external link is opened safely");

        var popupWithoutTsunami = helpers.buildPopupContent({
            place: "San Jose, California",
            mag: 3.5,
            depth: "8.0",
            time: 1767225600000,
            hasTsunami: false
        });
        var noTsunamiBadge = popupWithoutTsunami.querySelector(".tsunami-popup-badge");
        assertEqual(noTsunamiBadge, null, "regular popup does not render tsunami badge");
    });

    test("computes acoustic frequency, duration, and gain profiles for seismic sonification", function () {
        var shallowMicro = helpers.getSeismicAudioProfile(1.5, 5, false);
        assert(shallowMicro.duration <= 0.25, "micro quake has brief duration");
        assert(shallowMicro.frequency >= 200, "shallow micro quake has higher crisp frequency");
        assert(shallowMicro.gain <= 0.20, "micro quake has gentle volume");
        assertEqual(shallowMicro.hasTsunamiHarmonic, false, "no tsunami harmonic on regular quake");

        var deepMantle = helpers.getSeismicAudioProfile(6.0, 580, false);
        assert(deepMantle.frequency < 100, "deep mantle quake produces subterranean sub-bass frequency");
        assert(deepMantle.filterCutoff < 300, "deep quake has heavy low-pass filter cutoff");

        var monsterTsunami = helpers.getSeismicAudioProfile(8.8, 18, true);
        assert(monsterTsunami.duration >= 1.0, "major quake has extended reverberant duration");
        assert(monsterTsunami.gain >= 0.35, "major quake has strong tactile gain");
        assertEqual(monsterTsunami.hasTsunamiHarmonic, true, "tsunami quake includes oceanic overtone harmonic");

        var fallback = helpers.getSeismicAudioProfile(null, "invalid", false);
        assert(fallback && typeof fallback.frequency === "number", "fallback profile provides valid numeric frequency");
    });

    test("toggles seismic audio enabled state and synchronizes DOM controls", function () {
        var button = document.getElementById("toggle-seismic-audio");
        if (!button) {
            button = document.createElement("button");
            button.id = "toggle-seismic-audio";
            var label = document.createElement("span");
            label.id = "seismic-audio-label";
            button.appendChild(label);
            document.body.appendChild(button);
        }

        var enabled = helpers.setSeismicAudioEnabled(true);
        assertEqual(enabled, true, "audio enabled state set to true");
        assertEqual(button.getAttribute("aria-pressed"), "true", "button aria-pressed is true");
        assert(button.classList.contains("is-active"), "button has is-active class");

        var disabled = helpers.setSeismicAudioEnabled(false);
        assertEqual(disabled, false, "audio enabled state set to false");
        assertEqual(button.getAttribute("aria-pressed"), "false", "button aria-pressed is false");
        assert(!button.classList.contains("is-active"), "button does not have is-active class");

        // Restore active state
        helpers.setSeismicAudioEnabled(true);
    });

    test("calculates seismic energy in Joules, TNT equivalent, and energy weight based on Gutenberg-Richter formula", function () {
        var m2 = helpers.calculateSeismicEnergy(2.0);
        assert(m2.joules > 6e7 && m2.joules < 7e7, "M2.0 energy is ~6.3x10^7 Joules");
        assert(m2.label.indexOf("kg TNT") !== -1, "M2.0 label formatted in kg TNT");
        assert(m2.energyWeight > 0 && m2.energyWeight <= 3, "M2.0 has small energy weight");

        var m5 = helpers.calculateSeismicEnergy(5.0);
        assert(m5.joules > 1.9e12 && m5.joules < 2.1e12, "M5.0 energy is ~2.0x10^12 Joules");
        assert(m5.label.indexOf("tons TNT") !== -1, "M5.0 label formatted in tons TNT");

        var m75 = helpers.calculateSeismicEnergy(7.5);
        assert(m75.joules > 1.0e16 && m75.joules < 1.3e16, "M7.5 energy is ~1.1x10^16 Joules");
        assert(m75.label.indexOf("Mt TNT") !== -1, "M7.5 label formatted in Megatons TNT");
        assert(m75.energyWeight >= 8.0, "M7.5 has high energy weight");

        var fallback = helpers.calculateSeismicEnergy(null);
        assertEqual(fallback.joules, 0, "fallback Joules is 0");
        assertEqual(fallback.energyWeight, 0, "fallback energy weight is 0");
    });

    test("toggles seismic energy heatmap layer visibility and DOM control", function () {
        var input = document.getElementById("heatmap-visibility");
        if (!input) {
            input = document.createElement("input");
            input.type = "checkbox";
            input.id = "heatmap-visibility";
            document.body.appendChild(input);
        }

        var visible = helpers.setHeatmapVisibility(true);
        assertEqual(visible, true, "heatmap visibility enabled");
        assertEqual(input.checked, true, "DOM checkbox checked");

        var hidden = helpers.setHeatmapVisibility(false);
        assertEqual(hidden, false, "heatmap visibility disabled");
        assertEqual(input.checked, false, "DOM checkbox unchecked");

        // Restore
        helpers.setHeatmapVisibility(false);
    });

    test("normalizes earthquake features with physical energy properties", function () {
        var feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-122.4, 37.7, 10.5] },
            properties: { place: "San Francisco, CA", mag: 6.8, time: 1767225600000 }
        };
        var normalized = helpers.normalizeEarthquakeFeature(feature);
        assert(normalized !== null, "feature normalizes successfully");
        assert(typeof normalized.properties.energyJoules === "number" && normalized.properties.energyJoules > 1e14, "energyJoules computed on normalized feature");
        assert(typeof normalized.properties.energyWeight === "number" && normalized.properties.energyWeight > 7, "energyWeight computed on normalized feature");
        assert(typeof normalized.properties.energyLabel === "string" && normalized.properties.energyLabel.indexOf("TNT") !== -1, "energyLabel string generated on normalized feature");
    });

    test("selects range presets and fallback", function () {
        assertEqual(helpers.getRangePresetByKey("7d").hours, 168, "7-day preset");
        assertEqual(helpers.getRangePresetByKey("30d").hours, 720, "30-day quick preset");
        assertEqual(helpers.getRangePresetByKey("missing").key, "24h", "unknown preset fallback");
    });

    test("reveals zoom jokes once at upward thresholds", function () {
        var seen = new Set();
        var first = helpers.getZoomEasterEgg(1.6, 3.5, seen);
        assertEqual(first.key, "closer", "first zoom threshold");
        seen.add(first.key);
        assertEqual(helpers.getZoomEasterEgg(3.5, 2, seen), null, "zooming out should not reveal a joke");
        assertEqual(helpers.getZoomEasterEgg(2, 3.5, seen), null, "a seen joke should not repeat");
        assertEqual(helpers.getZoomEasterEgg(3.5, 10, seen).key, "neighborhood", "a large jump should show the closest crossed threshold");
        assertEqual(helpers.getZoomEasterEgg(NaN, 10, seen), null, "invalid zoom should be ignored");
    });

    test("uses stable earthquake identities for selection", function () {
        assertEqual(helpers.getQuakeIdentity({ id: "us7000test", properties: {} }), "us7000test", "GeoJSON feature ID");
        assertEqual(helpers.getQuakeIdentity({ properties: { eventId: "event-42" } }), "event-42", "stored event ID");
        assertEqual(helpers.getQuakeIdentity({ properties: { code: "fallback-code" } }), "fallback-code", "USGS code fallback");
        assertEqual(helpers.getQuakeIdentity(null), null, "missing feature");
    });

    test("synchronizes collapsible map panel state", function () {
        var panel = document.createElement("div");
        var button = document.createElement("button");
        var content = document.createElement("div");
        helpers.setMapPanelExpanded(panel, button, content, true);
        assert(panel.classList.contains("is-expanded"), "expanded class should be applied");
        assertEqual(button.getAttribute("aria-expanded"), "true", "expanded accessibility state");
        assertEqual(content.hidden, false, "expanded content visibility");

        helpers.setMapPanelExpanded(panel, button, content, false);
        assert(!panel.classList.contains("is-expanded"), "expanded class should be removed");
        assertEqual(button.getAttribute("aria-expanded"), "false", "collapsed accessibility state");
        assertEqual(content.hidden, true, "collapsed content visibility");
    });

    test("keeps only one earthquake popup active", function () {
        function createPopupDouble() {
            return {
                removeCount: 0,
                closeHandler: null,
                remove: function () {
                    this.removeCount += 1;
                    if (this.closeHandler) this.closeHandler();
                },
                on: function (eventName, handler) {
                    if (eventName === "close") this.closeHandler = handler;
                }
            };
        }

        var first = createPopupDouble();
        var second = createPopupDouble();
        helpers.setActiveQuakePopup(first);
        helpers.setActiveQuakePopup(second);
        assertEqual(first.removeCount, 1, "opening another popup should remove the previous popup");
        assertEqual(second.removeCount, 0, "the new popup should remain open");

        first.closeHandler();
        helpers.setActiveQuakePopup(null);
        assertEqual(second.removeCount, 1, "a stale close event must not clear the newer popup");

        var manuallyClosed = createPopupDouble();
        helpers.setActiveQuakePopup(manuallyClosed);
        manuallyClosed.closeHandler();
        helpers.setActiveQuakePopup(null);
        assertEqual(manuallyClosed.removeCount, 0, "a manually closed popup should not be removed twice");
    });

    test("builds paginated USGS URLs", function () {
        var start = new Date("2026-01-01T00:00:00.000Z");
        var end = new Date("2026-01-02T00:00:00.000Z");
        var url = new URL(helpers.buildRangeUrl(start, end, 20001));
        assertEqual(url.searchParams.get("limit"), "20000", "page size");
        assertEqual(url.searchParams.get("offset"), "20001", "page offset");
        assertEqual(url.searchParams.get("starttime"), start.toISOString(), "start time");
        assertEqual(url.searchParams.get("endtime"), end.toISOString(), "end time");
    });

    test("renders external popup values as text", function () {
        var malicious = '<img src=x onerror="window.popupInjected=true">';
        var popup = helpers.buildPopupContent({
            place: malicious,
            mag: 4.2,
            depth: "12.0",
            displayRegion: "Test area",
            championGroup: "Test group",
            type: "<script>window.popupInjected=true</script>",
            time: Date.now(),
            isChampion: true
        });
        assert(popup.textContent.includes(malicious), "place text should be preserved");
        assertEqual(popup.querySelectorAll("img, script").length, 0, "markup must not become elements");
        assertEqual(popup.querySelectorAll(".popup-fact").length, 5, "compact fact count");
        assertEqual(popup.querySelectorAll(".popup-fact--wide").length, 1, "timestamp should span the popup");
        assert(window.popupInjected !== true, "popup payload must not execute");
    });

    test("extracts authoritative fault and plate context", function () {
        var detail = {
            properties: {
                products: {
                    "general-text": [{
                        preferredWeight: 1,
                        updateTime: 10,
                        contents: {
                            "": {
                                bytes: "<h2>Tectonic Summary</h2><p>The earthquake occurred near a triple-junction between the Anatolia, Arabia, and Africa plates.</p><p>The mechanism is consistent with rupture on either the East Anatolia fault zone or the Dead Sea transform fault zone relative to the Eurasia plate.</p>"
                            }
                        }
                    }]
                }
            }
        };
        var metadata = helpers.extractTectonicMetadata(detail);
        assertEqual(metadata.faults.join(" | "), "East Anatolia fault zone | Dead Sea transform fault zone", "named faults");
        assertEqual(metadata.plates.join(" | "), "Anatolia | Arabia | Africa | Eurasia", "plate names");
        assert(metadata.tectonicContext.includes("triple-junction"), "tectonic excerpt should retain plate context");
    });

    test("omits scientific context when USGS does not provide it", function () {
        var metadata = helpers.extractTectonicMetadata({ properties: { products: { origin: [] } } });
        assertEqual(Object.keys(metadata).length, 0, "missing summary should produce no inferred metadata");
    });

    test("renders scientific popup details as text", function () {
        var malicious = '<img src=x onerror="window.popupInjected=true">';
        var popup = helpers.buildPopupContent({
            place: "Test event",
            mag: 7.8,
            depth: "10.0",
            displayRegion: "Test area",
            type: "earthquake",
            time: Date.now(),
            faults: [malicious],
            plates: ["Anatolia", "Arabia"],
            tectonicContext: malicious
        });
        assertEqual(popup.querySelectorAll("img, script").length, 0, "scientific markup must not become elements");
        assertEqual(popup.querySelectorAll(".popup-fact").length, 8, "optional scientific fact count");
        assertEqual(popup.querySelectorAll(".popup-fact--wide").length, 4, "scientific rows should span the popup");
        assert(popup.textContent.includes(malicious), "scientific text should be preserved");
        assert(window.popupInjected !== true, "scientific payload must not execute");
    });

    test("classifies representative champion groups", function () {
        assertEqual(helpers.getChampionGroup(-74, 40), "North America", "North America");
        assertEqual(helpers.getChampionGroup(-75, -10), "South America", "South America");
        assertEqual(helpers.getChampionGroup(2, 46), "Europe", "Europe");
        assertEqual(helpers.getChampionGroup(37, -1), "Africa", "Africa");
        assertEqual(helpers.getChampionGroup(138, 36), "Asia", "Asia");
        assertEqual(helpers.getChampionGroup(151, -33), "Oceania", "Oceania");
    });

    test("uses country names on land", function () {
        var japan = helpers.classifyGeography(139.6917, 35.6895);
        assertEqual(japan.country, "Japan", "Tokyo country lookup");
        assertEqual(japan.countryCode, "JP", "Tokyo country code");
        assertEqual(japan.displayRegion, "Japan", "country display label");
        assertEqual(japan.championGroup, "Asia", "country champion group");
    });

    test("uses named areas for offshore coordinates", function () {
        var atlantic = helpers.classifyGeography(-30, 35);
        assertEqual(atlantic.country, null, "ocean point has no country");
        assertEqual(atlantic.displayRegion, "North Atlantic Ocean", "offshore display label");
        assertEqual(atlantic.championGroup, "North America", "offshore champion group remains broad");
        assertEqual(helpers.getOffshoreArea(20, 38), "Mediterranean Sea", "named sea fallback");
    });

    test("falls back safely when country lookup is unavailable", function () {
        var savedCountryCoder = window.countryCoder;
        try {
            window.countryCoder = null;
            var fallback = helpers.classifyGeography(139.6917, 35.6895);
            assertEqual(fallback.country, null, "country should be absent without the lookup");
            assertEqual(fallback.displayRegion, "Asia region", "broad fallback label");
            assertEqual(fallback.championGroup, "Asia", "champion grouping remains available");
        } finally {
            window.countryCoder = savedCountryCoder;
        }
    });

    test("marks one strongest quake per broad group", function () {
        var features = [
            { properties: { mag: 3 }, geometry: { coordinates: [139.7, 35.7, 10] } },
            { properties: { mag: 5 }, geometry: { coordinates: [100, 30, 10] } },
            { properties: { mag: 4 }, geometry: { coordinates: [-74, 40, 10] } }
        ];
        helpers.markRegionalChampions(features);
        assertEqual(features[0].properties.isChampion, false, "weaker Asian quake");
        assertEqual(features[1].properties.isChampion, true, "strongest Asian quake");
        assertEqual(features[2].properties.isChampion, true, "North American champion");
        assert(features[0].properties.displayRegion, "classification should add a display label");
    });

    test("does not promote unknown magnitudes over negative earthquakes", function () {
        var features = [
            { properties: { mag: null }, geometry: { coordinates: [100, 30, 10] } },
            { properties: { mag: -0.5 }, geometry: { coordinates: [101, 31, 10] } }
        ];
        helpers.markRegionalChampions(features);
        assertEqual(features[0].properties.isChampion, false, "unknown magnitude should not be champion");
        assertEqual(features[1].properties.isChampion, true, "known negative magnitude should be champion");
    });

    test("calculates earthquake summary values", function () {
        var now = Date.now();
        var features = [
            { properties: { mag: 2.5, time: now - 120000 }, geometry: { coordinates: [0, 0, 8] } },
            { properties: { mag: 6.1, time: now - 60000 }, geometry: { coordinates: [1, 1, 450] } }
        ];
        helpers.updateSummary({ features: features });
        assertEqual(document.getElementById("total-events").textContent, "2", "event count");
        assertEqual(document.getElementById("strongest-magnitude").textContent, "6.1 M", "strongest magnitude");
        assertEqual(document.getElementById("deepest-depth").textContent, "450 km", "deepest event");
        assert(document.getElementById("feed-announcement").textContent.includes("2 earthquakes loaded"), "summary should be announced");
        assertEqual(features[0].properties.isStrongest, false, "weaker event should not be strongest");
        assertEqual(features[0].properties.isDeepest, false, "shallower event should not be deepest");
        assertEqual(features[0].properties.isLatest, false, "older event should not be latest");
        assertEqual(features[1].properties.isStrongest, true, "strongest event should be flagged for pinging");
        assertEqual(features[1].properties.isDeepest, true, "deepest event should be flagged for pinging");
        assertEqual(features[1].properties.isLatest, true, "latest event should be flagged for pinging");
        assertEqual(features[1].properties.isSummaryHighlight, true, "one event with several roles should receive one ping feature");
    });

    test("excludes unknown magnitudes from strongest summary", function () {
        var now = Date.now();
        helpers.updateSummary({ features: [
            { properties: { mag: null, time: now }, geometry: { coordinates: [0, 0, 8] } },
            { properties: { mag: -0.6, time: now - 1 }, geometry: { coordinates: [1, 1, 9] } }
        ] });
        assertEqual(document.getElementById("strongest-magnitude").textContent, "-0.6 M", "known negative magnitude should win");
    });

    test("matches search queries by location, region, and type", function () {
        var event = {
            properties: {
                place: "70 km SSW of Tokyo, Japan",
                country: "Japan",
                countryCode: "JP",
                displayRegion: "Japan",
                championGroup: "Asia",
                type: "earthquake",
                mag: 5.2,
                depth: 25,
                searchIndex: "70 km ssw of tokyo, japan tokyo japan jp asia earthquake shallow m5.2 mag 5.2 japanese"
            }
        };
        assertEqual(helpers.matchesSearchQuery(event, ""), true, "empty query matches all");
        assertEqual(helpers.matchesSearchQuery(event, "tokyo"), true, "city match");
        assertEqual(helpers.matchesSearchQuery(event, "JAPAN"), true, "case-insensitive country match");
        assertEqual(helpers.matchesSearchQuery(event, "japanese"), true, "country alias match");
        assertEqual(helpers.matchesSearchQuery(event, "asia"), true, "champion group match");
        assertEqual(helpers.matchesSearchQuery(event, "california"), false, "non-matching query");
        assertEqual(helpers.matchesSearchQuery(event, "Japan 5+"), true, "multi-token magnitude match");
        assertEqual(helpers.matchesSearchQuery(event, "Japan 6+"), false, "magnitude above event mag fails");
        assertEqual(helpers.matchesSearchQuery(event, "Tokyo shallow"), true, "depth category query matches");
        assertEqual(helpers.matchesSearchQuery(event, "Tokyo deep"), false, "depth category query mismatch fails");
    });

    test("resolves state abbreviations and country aliases for robust searching", function () {
        var usEvent = helpers.normalizeEarthquakeFeature({
            type: "Feature",
            geometry: { type: "Point", coordinates: [-117.6, 35.7, 8.2] },
            properties: { place: "14 km ENE of Ridgecrest, CA", mag: 4.2, time: 1600000000000 }
        });
        assertEqual(usEvent.properties.state, "California", "resolved state name");
        assertEqual(usEvent.properties.stateCode, "CA", "resolved state code");
        assertEqual(usEvent.properties.country, "United States", "resolved country");
        assert(usEvent.properties.locationAliases.includes("usa"), "aliases include usa");
        assert(usEvent.properties.locationAliases.includes("california"), "aliases include california");

        helpers.markRegionalChampions([usEvent]);
        assertEqual(helpers.matchesSearchQuery(usEvent, "california"), true, "matches full state name");
        assertEqual(helpers.matchesSearchQuery(usEvent, "CA"), true, "matches state code");
        assertEqual(helpers.matchesSearchQuery(usEvent, "USA"), true, "matches country alias USA");
        assertEqual(helpers.matchesSearchQuery(usEvent, "United States"), true, "matches country name");
        assertEqual(helpers.matchesSearchQuery(usEvent, "Ridgecrest M4+"), true, "matches city and magnitude expression");
    });

    test("filters features by minimum magnitude threshold", function () {
        assertEqual(helpers.matchesMagnitudeFilter(5.2, 0), true, "all magnitudes pass min 0");
        assertEqual(helpers.matchesMagnitudeFilter(4.5, 4.5), true, "exact match threshold");
        assertEqual(helpers.matchesMagnitudeFilter(2.4, 2.5), false, "below threshold");
        assertEqual(helpers.matchesMagnitudeFilter(null, 4.5), false, "null magnitude fails positive threshold");
        assertEqual(helpers.matchesMagnitudeFilter(null, 0), true, "null magnitude passes when filter is All");
    });

    test("filters features across combined depth, magnitude, and search criteria", function () {
        var features = [
            { properties: { depthKey: "0-10", mag: 5.5, depth: 8, place: "Fukushima, Japan", country: "Japan", searchIndex: "fukushima japan jp shallow m5.5 mag 5.5", time: 100 } },
            { properties: { depthKey: "10-30", mag: 2.1, depth: 15, place: "Los Angeles, CA", state: "California", stateCode: "CA", country: "United States", searchIndex: "los angeles ca california usa united states shallow m2.1 mag 2.1", time: 200 } },
            { properties: { depthKey: "90+", mag: 6.8, depth: 120, place: "Santiago, Chile", country: "Chile", searchIndex: "santiago chile cl deep m6.8 mag 6.8", time: 300 } }
        ];
        var filtered = helpers.getFilteredFeatures(features, {
            activeDepthRanges: new Set(["0-10", "90+"]),
            minMagnitude: 5.0,
            searchQuery: "chile"
        });
        assertEqual(filtered.length, 1, "only Chile event should match all 3 criteria");
        assertEqual(filtered[0].properties.place, "Santiago, Chile", "correct matched feature");
    });

    test("verifies PB2002 tectonic plate boundaries GeoJSON dataset structure", function () {
        assert(window.tectonicPlatesGeoJSON, "plate boundaries dataset exists");
        assertEqual(window.tectonicPlatesGeoJSON.type, "FeatureCollection", "feature collection type");
        assert(window.tectonicPlatesGeoJSON.features.length >= 200, "comprehensive PB2002 plate boundaries present");
        var firstFeature = window.tectonicPlatesGeoJSON.features[0];
        assertEqual(firstFeature.type, "Feature", "feature type");
        assertEqual(firstFeature.geometry.type, "LineString", "linestring geometry");
        assert(Array.isArray(firstFeature.geometry.coordinates) && firstFeature.geometry.coordinates.length > 2, "coordinate array");
        assert(firstFeature.properties.name, "boundary name property exists");
        assert(firstFeature.properties.type, "boundary type property exists");
        assert(firstFeature.properties.plateA && firstFeature.properties.plateB, "plate pairings exist");
    });

    test("keeps all seven PB2002 boundary classes, spreading ridges included", function () {
        var counts = {};
        window.tectonicPlatesGeoJSON.features.forEach(function (feature) {
            counts[feature.properties.cls] = (counts[feature.properties.cls] || 0) + 1;
        });
        ["SUB", "OCB", "CCB", "OSR", "CRB", "OTF", "CTF"].forEach(function (code) {
            assert(counts[code] > 0, code + " boundaries present (" + (counts[code] || 0) + ")");
            assert(helpers.PLATE_CLASSES[code], code + " has a label and a kind");
        });
        assert(counts.OSR > 300, "mid-ocean ridges are the most common boundary, not missing");
        var nazca = window.tectonicPlatesGeoJSON.features.find(function (f) { return f.properties.cls === "SUB" && /\(NZ-SA\)/.test(f.properties.name); });
        assert(nazca && nazca.properties.sinks === "Nazca Plate", "the Nazca plate is the one sinking under South America");
        var colors = helpers.plateClassColorExpression("line");
        assertEqual(colors[colors.indexOf("OSR") + 1], "#7dd3fc", "ridges are drawn blue");
        assertEqual(colors[colors.indexOf("SUB") + 1], "#fb7185", "subduction zones are drawn red");
        assert(/fingernails/.test(helpers.describePlateRate(40)), "plate speed gets an everyday comparison");
    });

    test("toggles feed drawer open and closed with synchronized accessibility attributes", function () {
        var drawer = document.getElementById("feed-drawer");
        if (!drawer) {
            drawer = document.createElement("aside");
            drawer.id = "feed-drawer";
            drawer.setAttribute("hidden", "");
            document.body.appendChild(drawer);
        }
        var button = document.getElementById("toggle-feed-drawer");
        if (!button) {
            button = document.createElement("button");
            button.id = "toggle-feed-drawer";
            document.body.appendChild(button);
        }

        helpers.toggleFeedDrawer(true);
        assertEqual(drawer.hidden, false, "drawer should be unhidden when opened");
        assertEqual(drawer.hasAttribute("hidden"), false, "hidden attribute removed");
        assertEqual(button.getAttribute("aria-expanded"), "true", "button aria-expanded true");

        helpers.toggleFeedDrawer(false);
        assertEqual(drawer.hidden, true, "drawer should be hidden when closed");
        assertEqual(drawer.hasAttribute("hidden"), true, "hidden attribute present");
        assertEqual(button.getAttribute("aria-expanded"), "false", "button aria-expanded false");
    });

    test("verifies Victorian airship orbital flight dynamics and waypoints", function () {
        assert(Array.isArray(helpers.airshipWaypoints) && helpers.airshipWaypoints.length >= 15, "has full global waypoint route");
        var pos0 = helpers.getAirshipPosition(0.0);
        assert(Number.isFinite(pos0.lon), "pos0 valid lon");
        assert(Number.isFinite(pos0.lat), "pos0 valid lat");
        assert(Number.isFinite(pos0.bearing), "pos0 valid bearing");
        assert(Number.isFinite(pos0.iconHeading), "pos0 valid iconHeading");
        assert(pos0.altitude && pos0.altitude.includes("3,850"), "pos0 altitude");
        assert(pos0.speed && pos0.speed.includes("48 knots"), "pos0 cruise speed");
        assert(pos0.currentWaypoint, "pos0 currentWaypoint exists");
        assert(pos0.note, "pos0 captain dispatch note exists");

        var posMid = helpers.getAirshipPosition(0.5);
        assert(Number.isFinite(posMid.lon) && Number.isFinite(posMid.lat), "posMid coordinates valid");

        var imgData = helpers.createAirshipImage();
        assert(imgData && imgData.width === 240 && imgData.height === 120, "airship canvas returns 240x120 high-DPI image");
    });

    test("verifies Three.js 3D Victorian dirigible model construction", function () {
        if (window.THREE) {
            var model = helpers.build3DAirshipMesh(window.THREE);
            assert(model && model.group, "3D airship group generated");
            assert(model.group.children.length >= 8, "has hull, nose cap, fins, ribs, gondola, and engines");
            assert(Array.isArray(model.props) && model.props.length >= 2, "has 3D propellers (stern and outriggers)");
            assert(Array.isArray(model.exhaustParticles) && model.exhaustParticles.length >= 4, "has steam exhaust particles");
            assert(model.lanternGroup, "has signature hanging glowing lantern");
        }
    });

    test("keeps live 3D airships on compact viewports when Three.js is available", function () {
        assertEqual(helpers.shouldUseLive3DAirshipMarkers(true, {}), true, "mobile should retain live 3D markers");
        assertEqual(helpers.shouldUseLive3DAirshipMarkers(false, {}), true, "desktop should retain live 3D markers");
        assertEqual(helpers.shouldUseLive3DAirshipMarkers(false, null), false, "missing Three.js should use sprite fallback");
    });

    test("verifies distinct steam whistle audio profiles for all three airships", function () {
        var profiles = helpers.AIRSHIP_WHISTLE_PROFILES;
        assert(Array.isArray(profiles) && profiles.length === 3, "has 3 distinct whistle profiles");

        var aetheria = profiles[0];
        assertEqual(aetheria.name, "HMS Aetheria", "Aetheria profile name");
        assertEqual(aetheria.oscType, "sawtooth", "Aetheria sawtooth waveform");
        assert(Array.isArray(aetheria.frequencies) && aetheria.frequencies.length === 3, "Aetheria 3-chime chord");

        var equinox = profiles[1];
        assertEqual(equinox.name, "HMS Equinox", "Equinox profile name");
        assertEqual(equinox.oscType, "triangle", "Equinox triangle fluted waveform");
        assert(Array.isArray(equinox.frequencies) && equinox.frequencies.length === 4, "Equinox clarion chime chord");

        var australis = profiles[2];
        assertEqual(australis.name, "HMS Australis", "Australis profile name");
        assertEqual(australis.oscType, "sawtooth", "Australis sawtooth waveform");
        assert(Array.isArray(australis.frequencies) && australis.frequencies[0] < 200, "Australis deep sub-200Hz bass foghorn");
    });

    test("maps latitudes to correct airship orbital zones and triggers depth pings", function () {
        assertEqual(helpers.getAirshipVesselForLatitude(45.0), 0, "45°N mapped to HMS Aetheria (Northern)");
        assertEqual(helpers.getAirshipVesselForLatitude(15.0), 0, "15°N mapped to HMS Aetheria (Northern)");
        assertEqual(helpers.getAirshipVesselForLatitude(0.0), 1, "0° mapped to HMS Equinox (Equatorial)");
        assertEqual(helpers.getAirshipVesselForLatitude(-10.0), 1, "-10° mapped to HMS Equinox (Equatorial)");
        assertEqual(helpers.getAirshipVesselForLatitude(-25.0), 2, "-25° mapped to HMS Australis (Southern)");
        assertEqual(helpers.getAirshipVesselForLatitude(-75.0), 2, "-75° mapped to HMS Australis (Southern)");

        var testQuake = {
            properties: { eventId: "test-eq-1", depthKey: "70-90", time: Date.now() },
            geometry: { coordinates: [139.69, 35.68, 82.5] }
        };
        // Should execute cleanly without throwing
        helpers.triggerAirshipDetectionPing(0, testQuake, false);
        assert(typeof helpers.triggerAirshipDetectionPing === "function", "triggerAirshipDetectionPing is a helper function");
    });

    test("organizes the airship fleet into three squadrons of flagship plus escorts", function () {
        var fleet = helpers.SATELLITE_FLEET;
        assert(Array.isArray(fleet) && fleet.length === 9, "fleet has nine ships");

        // Flagships hold positions 0-2 and match their squadron theme index.
        [0, 1, 2].forEach(function (idx) {
            assertEqual(fleet[idx].vesselIdx, idx, "flagship " + idx + " leads its own squadron");
            assertEqual(helpers.getFleetThemeIndex(idx), idx, "flagship theme index matches position");
        });

        // Each squadron fields exactly three ships, escorts are smaller.
        [0, 1, 2].forEach(function (squadron) {
            var ships = fleet.filter(function (v) { return v.vesselIdx === squadron; });
            assertEqual(ships.length, 3, "squadron " + squadron + " has three ships");
        });
        fleet.forEach(function (vessel, idx) {
            if (idx > 2) {
                assert(vessel.scale < fleet[vessel.vesselIdx].scale, vessel.name + " escort is smaller than its flagship");
                assertEqual(helpers.getFleetThemeIndex(idx), vessel.vesselIdx, vessel.name + " resolves its squadron theme");
                // Escorts must patrol inside their squadron's detection zone even
                // at maximum latitude wander.
                var minLat = vessel.baseLat - vessel.latAmplitude;
                var maxLat = vessel.baseLat + vessel.latAmplitude;
                assertEqual(helpers.getAirshipVesselForLatitude(minLat), vessel.vesselIdx, vessel.name + " southern edge stays in zone");
                assertEqual(helpers.getAirshipVesselForLatitude(maxLat), vessel.vesselIdx, vessel.name + " northern edge stays in zone");
            }
        });

        // Every ship reports a valid moving position.
        fleet.forEach(function (vessel, idx) {
            var pos = helpers.getAirshipPosition(0.37, idx);
            assertEqual(pos.name, vessel.name, "position " + idx + " reports " + vessel.name);
            assert(Number.isFinite(pos.lon) && Number.isFinite(pos.lat), vessel.name + " has valid coordinates");
            assertEqual(pos.themeIdx, vessel.vesselIdx, vessel.name + " carries its squadron theme");
        });
    });

    test("toggles quick guide modal open and closed with accessibility attributes", function () {
        var backdrop = document.getElementById("guide-modal-backdrop");
        if (!backdrop) {
            backdrop = document.createElement("div");
            backdrop.id = "guide-modal-backdrop";
            backdrop.setAttribute("hidden", "");
            document.body.appendChild(backdrop);
        }
        var modal = document.getElementById("guide-modal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "guide-modal";
            modal.tabIndex = -1;
            backdrop.appendChild(modal);
        }
        var button = document.getElementById("open-guide-modal");
        if (!button) {
            button = document.createElement("button");
            button.id = "open-guide-modal";
            document.body.appendChild(button);
        }

        helpers.openGuideModal();
        assertEqual(backdrop.hidden, false, "guide backdrop unhidden when opened");
        assertEqual(backdrop.hasAttribute("hidden"), false, "guide hidden attribute removed");
        assertEqual(button.getAttribute("aria-expanded"), "true", "guide button aria-expanded true");

        helpers.closeGuideModal();
        assertEqual(backdrop.hidden, true, "guide backdrop hidden when closed");
        assertEqual(backdrop.hasAttribute("hidden"), true, "guide hidden attribute set");
        assertEqual(button.getAttribute("aria-expanded"), "false", "guide button aria-expanded false");
    });

    test("normalizes and formats PAGER emergency alert levels", function () {
        var green = helpers.formatPagerAlert("green");
        assertEqual(green.level, "green", "green level");
        assertEqual(green.label, "PAGER: GREEN", "green label");
        assertEqual(green.description, "Low risk of fatalities and economic losses", "green description");

        var yellow = helpers.formatPagerAlert("YELLOW");
        assertEqual(yellow.level, "yellow", "yellow case insensitive");
        assertEqual(yellow.label, "PAGER: YELLOW", "yellow label");

        var orange = helpers.formatPagerAlert("orange");
        assertEqual(orange.level, "orange", "orange level");

        var red = helpers.formatPagerAlert(" red ");
        assertEqual(red.level, "red", "red trimmed");

        assertEqual(helpers.formatPagerAlert("blue"), null, "unknown alert returns null");
        assertEqual(helpers.formatPagerAlert(null), null, "null alert returns null");
    });

    test("formats Mercalli intensity with Roman numerals and shaking descriptions", function () {
        assertEqual(helpers.formatMercalliIntensity(0.5), null, "sub-threshold MMI returns null");
        assertEqual(helpers.formatMercalliIntensity(null), null, "null MMI returns null");

        var weak = helpers.formatMercalliIntensity(2.4);
        assertEqual(weak.roman, "II", "MMI 2.4 Roman numeral");
        assert(weak.shaking.indexOf("Weak") !== -1, "MMI 2.4 shaking description");

        var moderate = helpers.formatMercalliIntensity(5.2);
        assertEqual(moderate.roman, "V", "MMI 5.2 Roman numeral");
        assertEqual(moderate.label, "MMI V (Moderate (Felt by all, slight damage))", "MMI 5.2 formatted label");

        var violent = helpers.formatMercalliIntensity(9.1);
        assertEqual(violent.roman, "IX", "MMI 9.1 Roman numeral");

        var extreme = helpers.formatMercalliIntensity(10.5);
        assertEqual(extreme.roman, "X+", "MMI 10.5+ Roman numeral");
        assert(extreme.shaking.indexOf("Extreme") !== -1, "MMI 10.5+ shaking description");
    });

    test("normalizes earthquake features with alert, felt, intensity, and sig properties", function () {
        var rawFeature = {
            type: "Feature",
            id: "us7000test",
            geometry: {
                type: "Point",
                coordinates: [-122.4194, 37.7749, 8.5]
            },
            properties: {
                mag: 6.8,
                place: "San Francisco, California",
                time: 1726000000000,
                alert: "orange",
                felt: 1420,
                mmi: 6.7,
                sig: 750
            }
        };

        var normalized = helpers.normalizeEarthquakeFeature(rawFeature);
        assert(normalized !== null, "feature should be normalized");
        assertEqual(normalized.properties.alert, "orange", "alert level normalized");
        assert(normalized.properties.pager !== null, "pager object populated");
        assertEqual(normalized.properties.pager.level, "orange", "pager level matches");
        assertEqual(normalized.properties.felt, 1420, "felt report count preserved");
        assertEqual(normalized.properties.mmi, 6.7, "mmi preserved");
        assert(normalized.properties.intensity !== null, "intensity object populated");
        assertEqual(normalized.properties.intensity.roman, "VII", "intensity roman VII");
        assertEqual(normalized.properties.sig, 750, "significance preserved");
    });

    test("exports active earthquake features to valid CSV and GeoJSON datasets", function () {
        var features = [
            {
                id: "us7000demo1",
                geometry: { coordinates: [139.6917, 35.6895, 15.2] },
                properties: {
                    place: "Near Tokyo, Japan",
                    mag: 6.1,
                    time: 1726000000000,
                    alert: "yellow",
                    felt: 85,
                    mmi: 5.4,
                    hasTsunami: true,
                    energyJoules: 1.2e14,
                    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000demo1"
                }
            },
            {
                id: "us7000demo2",
                geometry: { coordinates: [-118.2437, 34.0522, 9.1] },
                properties: {
                    place: "Los Angeles, CA",
                    mag: 4.2,
                    time: 1726001000000,
                    alert: "green",
                    felt: 340,
                    mmi: 4.1,
                    hasTsunami: false,
                    energyJoules: 8.5e10,
                    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000demo2"
                }
            }
        ];

        var csv = helpers.exportActiveFeaturesToCsv(features);
        assert(csv.length > 0, "CSV export should not be empty");
        assert(csv.indexOf("id,timestamp_utc,place,magnitude,depth_km") === 0, "CSV contains correct header row");
        assert(csv.indexOf("event_type,event_origin,is_induced") !== -1, "CSV contains origin and type columns");
        assert(csv.indexOf("us7000demo1") !== -1, "CSV contains first feature ID");
        assert(csv.indexOf("Near Tokyo, Japan") !== -1, "CSV contains Tokyo location");
        assert(csv.indexOf("yellow") !== -1, "CSV contains alert yellow");

        var geojsonStr = helpers.exportActiveFeaturesToGeoJson(features);
        var parsed = JSON.parse(geojsonStr);
        assertEqual(parsed.type, "FeatureCollection", "GeoJSON type is FeatureCollection");
        assertEqual(parsed.features.length, 2, "GeoJSON feature count matches");
        assertEqual(parsed.features[0].id, "us7000demo1", "GeoJSON feature ID preserved");
        assertEqual(parsed.metadata.count, 2, "GeoJSON metadata count matches");
    });

    test("classifies human-induced and natural earthquake event types accurately", function () {
        var quarry = helpers.classifyEventOrigin("quarry blast");
        assertEqual(quarry.isInduced, true, "quarry blast is human-induced");
        assertEqual(quarry.eventOrigin, "induced", "quarry blast origin is induced");
        assertEqual(quarry.category, "Quarry Blast", "quarry blast category name");
        assert(quarry.icon === "⛏️", "quarry blast icon");

        var mining = helpers.classifyEventOrigin("mining explosion");
        assertEqual(mining.isInduced, true, "mining explosion is human-induced");
        assertEqual(mining.category, "Mining Explosion", "mining explosion category");

        var rockburst = helpers.classifyEventOrigin("rock burst");
        assertEqual(rockburst.isInduced, true, "rock burst is human-induced");

        var nuke = helpers.classifyEventOrigin("nuclear explosion");
        assertEqual(nuke.isInduced, true, "nuclear explosion is human-induced");

        var natural = helpers.classifyEventOrigin("earthquake");
        assertEqual(natural.isInduced, false, "earthquake is natural");
        assertEqual(natural.eventOrigin, "natural", "earthquake origin is natural");
        assertEqual(natural.category, "Natural Earthquake", "natural category");

        var fallback = helpers.classifyEventOrigin(null);
        assertEqual(fallback.isInduced, false, "null falls back to natural");

        var placeDetected = helpers.classifyEventOrigin("earthquake", "4km W of Granite Quarry, CA");
        assertEqual(placeDetected.isInduced, true, "place containing quarry is detected as induced");
        assertEqual(placeDetected.category, "Quarry Blast", "place quarry detected as Quarry Blast");
    });

    test("normalizes earthquake features with origin, isInduced, and eventTypeName", function () {
        var rawQuarry = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-117.1, 34.2, 1.5] },
            properties: {
                mag: 2.1,
                place: "5km SSW of Quarry, California",
                time: 1726000000000,
                type: "quarry blast"
            }
        };

        var normalized = helpers.normalizeEarthquakeFeature(rawQuarry);
        assert(normalized !== null, "feature normalized");
        assertEqual(normalized.properties.isInduced, true, "isInduced is true");
        assertEqual(normalized.properties.eventOrigin, "induced", "eventOrigin is induced");
        assertEqual(normalized.properties.eventTypeName, "Quarry Blast", "eventTypeName matches");
        assertEqual(normalized.properties.shapeKey, "cube", "shapeKey for induced event is cube");
        assert(normalized.properties.origin !== null, "origin object exists");

        var rawNatural = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-118.2, 34.1, 10.0] },
            properties: {
                mag: 3.5,
                place: "Los Angeles, CA",
                time: 1726000000000,
                type: "earthquake"
            }
        };
        var normalizedNatural = helpers.normalizeEarthquakeFeature(rawNatural);
        assertEqual(normalizedNatural.properties.isInduced, false, "natural event isInduced is false");
        assertEqual(normalizedNatural.properties.shapeKey, "sphere", "shapeKey for natural event is sphere");

        helpers.markRegionalChampions([normalized]);
        assert(normalized.properties.searchIndex.indexOf("quarry") !== -1, "searchIndex includes quarry");
        assert(normalized.properties.searchIndex.indexOf("induced") !== -1, "searchIndex includes induced");
    });

    test("filters features by event origin (all, natural, induced)", function () {
        var features = [
            { properties: { depthKey: "0-10", mag: 4.0, place: "Quarry Site", type: "quarry blast", isInduced: true, searchIndex: "quarry blast" } },
            { properties: { depthKey: "0-10", mag: 5.0, place: "Fault Zone", type: "earthquake", isInduced: false, searchIndex: "earthquake" } },
            { properties: { depthKey: "10-30", mag: 6.0, place: "Subduction Trench", type: "earthquake", isInduced: false, searchIndex: "earthquake" } }
        ];

        var depthSet = new Set(["0-10", "10-30"]);
        var allFeatures = helpers.getFilteredFeatures(features, { activeDepthRanges: depthSet, originFilter: "all" });
        assertEqual(allFeatures.length, 3, "all features count");

        var naturalOnly = helpers.getFilteredFeatures(features, { activeDepthRanges: depthSet, originFilter: "natural" });
        assertEqual(naturalOnly.length, 2, "natural features count");
        assert(naturalOnly.every(function (f) { return !f.properties.isInduced; }), "only natural quakes retained");

        var inducedOnly = helpers.getFilteredFeatures(features, { activeDepthRanges: depthSet, originFilter: "induced" });
        assertEqual(inducedOnly.length, 1, "induced features count");
        assertEqual(inducedOnly[0].properties.place, "Quarry Site", "correct induced feature retained");
    });

    test("hides the Claude explainer when no Worker URL is configured", function () {
        var popup = helpers.buildPopupContent({ place: "Test", mag: 4, depth: 10, time: 0, eventId: "us0001" });
        assert(!popup.querySelector(".quake-explain"), "no explain section without EXPLAIN_API_URL");
    });

    test("renders each Claude explainer state from the per-event cache", function () {
        window.EXPLAIN_API_URL = "http://localhost:8787/explain";
        try {
            var base = { place: "Test", mag: 4, depth: 10, time: 0 };
            var fresh = helpers.buildPopupContent(Object.assign({ eventId: "us0002" }, base));
            var button = fresh.querySelector(".quake-explain-btn");
            assert(button, "explain button shown for an event id");
            assertEqual(button.textContent, "✨ Explain this quake", "button label");

            assert(!helpers.buildPopupContent(base).querySelector(".quake-explain"), "no section without an event id");

            helpers.quakeExplanations.set("us0003", { state: "loading", promise: new Promise(function () {}) });
            var loading = helpers.buildPopupContent(Object.assign({ eventId: "us0003" }, base)).querySelector(".quake-explain");
            assertEqual(loading.getAttribute("aria-busy"), "true", "loading marks the section busy");
            assert(!loading.querySelector("button"), "no button while loading");

            helpers.quakeExplanations.set("us0004", { state: "done", paragraphs: ["One <b>.", "Two."], promise: Promise.resolve() });
            var done = helpers.buildPopupContent(Object.assign({ eventId: "us0004" }, base)).querySelector(".quake-explain");
            var paras = done.querySelectorAll(".quake-explain-body p");
            assertEqual(paras.length, 2, "one element per paragraph");
            assertEqual(paras[0].textContent, "One <b>.", "model text is inserted as text, never HTML");
            assert(done.querySelector(".quake-explain-note"), "AI disclosure note shown");

            helpers.quakeExplanations.set("us0005", { state: "error", error: "Too many new explanations right now.", promise: Promise.resolve() });
            var failed = helpers.buildPopupContent(Object.assign({ eventId: "us0005" }, base)).querySelector(".quake-explain");
            assertEqual(failed.querySelector(".quake-explain-error").textContent, "Too many new explanations right now.", "server error shown");
            assertEqual(failed.querySelector("button").textContent, "Try again", "retry button after an error");
        } finally {
            delete window.EXPLAIN_API_URL;
            ["us0003", "us0004", "us0005"].forEach(function (id) { helpers.quakeExplanations.delete(id); });
        }
    });

    test("produces explosive audio profile for human-induced events", function () {
        var naturalProfile = helpers.getSeismicAudioProfile(3.0, 5, false, false);
        var inducedProfile = helpers.getSeismicAudioProfile(3.0, 5, false, true);

        assertEqual(naturalProfile.isInduced, false, "natural audio profile flag");
        assertEqual(naturalProfile.oscillatorType, "sine", "natural uses sine wave");

        assertEqual(inducedProfile.isInduced, true, "induced audio profile flag");
        assertEqual(inducedProfile.oscillatorType, "sawtooth", "induced uses sawtooth transient wave");
        assert(inducedProfile.frequency > naturalProfile.frequency, "induced fundamental pitch is higher for surface blast");
        assert(inducedProfile.duration <= naturalProfile.duration, "induced duration is snappier");
    });

    // ---------------------------------------------------------------- Quake Quest
    var Q = window.quakeQuest;
    var QS = Q.science;
    var qIndex = QS.buildBoundaryIndex(window.tectonicPlatesGeoJSON);

    test("Quake Quest: depth and magnitude classes follow the textbook cut-offs", function () {
        assertEqual(QS.depthClass(10), "shallow", "10 km");
        assertEqual(QS.depthClass(69.9), "shallow", "just above 70 km");
        assertEqual(QS.depthClass(70), "intermediate", "70 km");
        assertEqual(QS.depthClass(299), "intermediate", "299 km");
        assertEqual(QS.depthClass(300), "deep", "300 km");
        assertEqual(QS.magnitudeClass(3.9), "minor", "M3.9");
        assertEqual(QS.magnitudeClass(4.0), "light", "M4.0");
        assertEqual(QS.magnitudeClass(6.5), "strong", "M6.5");
        assertEqual(QS.magnitudeClass(9.1), "great", "M9.1");
        assertEqual(QS.formatTnt(QS.tntTonnes(6.0)), "15,000 tonnes of TNT", "M6 energy (about one Hiroshima bomb)");
        // the Field Guide page (quest-guide.html) reads the same functions from QUEST_DATA
        assertEqual(QS.tntTonnes, window.QUEST_DATA.TNT.tonnes, "the game and the Field Guide share one energy formula");
        assertEqual(QS.formatTnt, window.QUEST_DATA.TNT.format, "and one way of wording it");
        assertEqual(window.QUEST_DATA.TNT.format(window.QUEST_DATA.TNT.tonnes(2)), "15 kg of TNT", "M2 energy");
        assertEqual(window.QUEST_DATA.TNT.format(window.QUEST_DATA.TNT.tonnes(9)), "480 million tonnes of TNT", "M9 energy");
    });

    test("Quake Quest: boundary answers match real places, and unclear ones are not asked", function () {
        var expect = [
            ["Tonga deep slab", -178.2, -18, 560, "subduction"],
            ["Chile megathrust", -72, -35, 25, "subduction"],
            ["Hawaii hotspot", -155.3, 19.4, 5, "intraplate"],
            ["San Andreas Fault", -120.5, 36, 8, "transform"],
            ["Nepal Himalaya", 84.7, 28.2, 15, "collision"],
            ["East Pacific Rise", -112.5, -20, 10, "divergent"],
            ["Iceland", -18.5, 64.6, 10, "divergent"],
            ["Oklahoma", -97.5, 36, 5, "intraplate"],
            ["East African Rift (diffuse: not asked)", 36.5, -3, 10, null],
            ["Tien Shan (diffuse: not asked)", 78, 42, 15, null]
        ];
        expect.forEach(function (e) {
            assertEqual(QS.classifyBoundary(e[1], e[2], e[3], qIndex).kind, e[4], e[0]);
        });
    });

    test("Quake Quest: questions always contain their answer; boundary is asked only when clear", function () {
        var clear = { id: "t1", depth: 10, depthClass: "shallow", mag: 5.1, boundary: { kind: "transform" }, induced: false };
        var unclear = { id: "t2", depth: 10, depthClass: "shallow", mag: 5.1, boundary: { kind: null }, induced: false };
        assert(QS.questionKinds(clear).indexOf("boundary") !== -1, "clear boundary can be asked");
        assertEqual(QS.questionKinds(unclear).indexOf("boundary"), -1, "unclear boundary is never asked");
        ["t1", "t3", "t4", "t5", "t6"].forEach(function (id) {
            var q = QS.buildQuestion(Object.assign({}, clear, { id: id }), "cadet");
            assert(q.options.some(function (o) { return o.key === q.answer; }), id + " " + q.kind + " offers the right answer");
        });
        var energy = ["e1", "e2", "e3", "e4", "e5", "e6"].map(function (id) { return QS.buildQuestion(Object.assign({}, unclear, { id: id }), "scientist"); })
            .find(function (q) { return q.kind === "energy"; });
        assert(energy, "an energy question comes up");
        assertEqual(energy.options.length, 4, "four energy options, 32x apart");
        assert(/670 tonnes/.test(energy.options.find(function (o) { return o.key === "x1"; }).label), "M5.1 is about 670 tonnes of TNT");
    });

    test("Quake Quest: popup asks first, then reveals the facts and scores the answer", function () {
        var savedGeojson = currentGeojson;
        var savedState = JSON.stringify(Q.getState());
        Q.resetForTests();
        try {
            currentGeojson = { type: "FeatureCollection", features: [{
                type: "Feature", id: "qq-test-1",
                geometry: { type: "Point", coordinates: [-178.2, -18, 560] },
                properties: { eventId: "qq-test-1", place: "Fiji region", mag: 5.5, depth: 560, time: 0 }
            }] };
            var props = currentGeojson.features[0].properties;
            var before = helpers.buildPopupContent(props);
            assert(before.querySelector(".quest-box"), "question shown");
            assertEqual(before.querySelectorAll(".popup-fact").length, 0, "facts hidden until answered");
            var c = QS.classifyQuake(currentGeojson.features[0]);
            var q = QS.buildQuestion(c, "cadet");
            var right = Array.prototype.find.call(before.querySelectorAll(".quest-option"), function (b) {
                return b.textContent === q.options.find(function (o) { return o.key === q.answer; }).label;
            });
            assert(right, "the right answer is a button");
            right.click();
            var st = Q.getState();
            assert(st.answers["qq-test-1"] && st.answers["qq-test-1"].ok, "answer recorded as right");
            assert(st.xp >= 20, "XP awarded (" + st.xp + ")");
            assert(st.collected["depth:deep"] && st.collected["kind:subduction"], "deep subduction quake logged in the field guide");
            assert(st.badges.first && st.badges.deep, "First Reading and Deep Diver badges");
            var after = helpers.buildPopupContent(props);
            assert(after.querySelector(".quest-box.is-right"), "result shown");
            assert(after.querySelectorAll(".popup-fact").length > 0, "facts revealed after answering");
        } finally {
            currentGeojson = savedGeojson;
            Q.resetForTests();
            try { localStorage.setItem("quakeQuest.v1", savedState); } catch (e) { /* ignore */ }
        }
    });

    test("Quake Quest: ranks climb with XP and each rank brings an airship", function () {
        assertEqual(QS.rankIndex(0), 0, "Cadet at 0 XP");
        assertEqual(QS.rankIndex(59), 0, "still Cadet at 59");
        assertEqual(QS.rankIndex(60), 1, "Deck Observer at 60");
        assertEqual(QS.rankIndex(99999), 8, "Admiral at the top");
        assertEqual(window.QUEST_DATA.RANKS.length, SATELLITE_FLEET.length, "one airship per rank");
    });

    // run fn with a clean Quake Quest state and a given quake list, then restore everything
    function withQuest(features, fn) {
        var savedGeojson = currentGeojson;
        var saved = null;
        try { saved = localStorage.getItem("quakeQuest.v1"); } catch (e) { /* ignore */ }
        Q.resetForTests();
        try {
            currentGeojson = { type: "FeatureCollection", features: features };
            fn(Q.getState());
        } finally {
            currentGeojson = savedGeojson;
            Q.resetForTests();
            try { if (saved === null) localStorage.removeItem("quakeQuest.v1"); else localStorage.setItem("quakeQuest.v1", saved); } catch (e) { /* ignore */ }
        }
    }
    function quake(id, lon, lat, depth, mag, extra) {
        return { type: "Feature", id: id, geometry: { type: "Point", coordinates: [lon, lat, depth] },
            properties: Object.assign({ eventId: id, place: id, mag: mag, depth: depth, time: Date.now() - 7200 * 1000 }, extra || {}) };
    }

    test("Quake Quest fleet: everyone starts with one airship of their choice", function () {
        withQuest([], function (st) {
            assert(QS.needsStarter(), "a new player has no airship yet");
            assertEqual(QS.picksAvailable(), 0, "no promotion picks before a starter");
            assert(QS.chooseShip(4, "starter"), "the starter can be any ship (HMS Cirrus)");
            assertEqual(st.ship, 4, "the starter is in use");
            assert(!QS.chooseShip(0, "starter"), "only one starter");
            assert(!QS.chooseShip(0, "pick"), "no free picks as a Cadet");
            assert(!QS.chooseShip(1, "deed"), "a ship can't be claimed without its deed");
        });
    });

    test("Quake Quest fleet: each promotion lets you choose another airship", function () {
        withQuest([], function (st) {
            QS.chooseShip(2, "starter");
            st.xp = 160; // Field Observer: two promotions
            assertEqual(QS.picksAvailable(), 2, "two picks at the third rank");
            assert(QS.chooseShip(7, "pick") && QS.chooseShip(0, "pick"), "two ships chosen");
            assertEqual(QS.picksAvailable(), 0, "picks used up");
            assert(!QS.chooseShip(5, "pick"), "no third pick");
            assertEqual(st.ships.join(","), "2,7,0", "the fleet in the order it joined");
            st.xp = 99999;
            assertEqual(QS.picksAvailable(), 6, "picks never exceed the ships left in the hangar");
        });
    });

    test("Quake Quest fleet: deeds earn airships early, but only after the starter", function () {
        withQuest([], function (st) {
            st.stats.deepPredictions = 3;
            assertEqual(QS.awardShipsByDeed().length, 0, "no deed ships before choosing a starter");
            QS.chooseShip(4, "starter"); // choosing triggers the deed check: Deep Sounder (HMS Australis) joins
            assert(QS.owns(2), "the Deep Sounder ship joined for predicting 3 deep quakes");
            assertEqual(st.picksUsed, 0, "a deed ship doesn't use a promotion pick");
            st.stats.bigPredictions = 1;
            var ev = QS.awardShipsByDeed();
            assert(QS.owns(6) && ev.length === 1 && /HMS Monsoon/.test(ev[0].text), "Wave Watch joins for an M5+ prediction");
        });
    });

    test("Quake Quest fleet: each instrument finds its own kind of unpredicted quake", function () {
        var feats = [
            quake("deep-tonga", -178.2, -18, 560, 5.5),
            quake("ridge-epr", -112.5, -20, 10, 4.8),
            quake("hawaii", -155.3, 19.4, 5, 3.1),
            quake("newest", -120.5, 36, 8, 2.1, { time: Date.now() - 60 * 1000 })
        ];
        withQuest(feats, function (st) {
            QS.chooseShip(0, "starter");
            var ids = function (i) { return QS.scanMatches(i).map(function (f) { return f.properties.eventId; }).join(","); };
            assertEqual(ids(2), "deep-tonga", "Deep Sounder: the 560 km quake only");
            assertEqual(ids(3), "ridge-epr", "Ridge Lantern: the East Pacific Rise quake");
            assertEqual(ids(4), "deep-tonga", "Trench Sonar: the Tonga slab quake");
            assertEqual(ids(7), "hawaii", "Odd-One-Out Finder: Hawaii, inside the Pacific plate");
            assertEqual(ids(5), "newest", "Fault Tracer: the San Andreas quake");
            assertEqual(ids(8).split(",")[0], "newest", "Fresh Ink: newest first");
            assertEqual(ids(0).split(",")[0], "deep-tonga", "Field Guide Compass: everything is new at first, biggest first");
            st.answers["deep-tonga"] = { k: "depth", g: "deep", a: "deep", ok: true, t: Date.now() };
            assertEqual(ids(2), "", "a quake you've predicted no longer shows up");
        });
    });

    test("Quake Quest accounts: merging a device with the cloud never loses anything earned", function () {
        var base = function () { return { v: 1, on: true, mode: "cadet", xp: 0, ships: [], ship: null, picksUsed: 0, answers: {}, collected: {}, badges: {}, stats: { predictions: 0, deepPredictions: 0 }, daily: null }; };
        var phone = base(), cloud = base();
        phone.xp = 120; phone.ships = [4]; phone.ship = 4; phone.collected["depth:deep"] = { id: "a", t: 1 }; phone.answers.a = { k: "depth", g: "deep", a: "deep", ok: true, t: 1 };
        phone.stats.predictions = 3; phone.daily = { date: "2026-11-03", predictedToday: 3, missions: [], done: {} };
        cloud.xp = 300; cloud.ships = [2, 4]; cloud.ship = 2; cloud.picksUsed = 1; cloud.badges.first = 1; cloud.collected["kind:subduction"] = { id: "b", t: 2 };
        cloud.answers.b = { k: "boundary", g: "subduction", a: "subduction", ok: true, t: 2 }; cloud.stats.predictions = 9; cloud.stats.deepPredictions = 2;
        cloud.daily = { date: "2026-11-02", predictedToday: 9, missions: [], done: {} };
        var m = QS.mergeStates(phone, cloud);
        assertEqual(m.xp, 300, "higher XP kept");
        assertEqual(m.ships.join(","), "4,2", "ships from both, this device's first");
        assertEqual(m.ship, 4, "this device's ship stays in use");
        assertEqual(m.picksUsed, 1, "picks used kept");
        assert(m.collected["depth:deep"] && m.collected["kind:subduction"], "field guide entries from both");
        assert(m.badges.first, "badges from the cloud");
        assert(m.answers.a && m.answers.b, "predictions from both");
        assertEqual(m.stats.predictions, 9, "counters take the larger");
        assertEqual(m.stats.deepPredictions, 2, "deed counters too");
        assertEqual(m.daily.date, "2026-11-03", "today's missions win over yesterday's");
        assertEqual(QS.mergeStates(phone, null).xp, 120, "no cloud save: this device as it is");
    });

    test("Quake Quest fleet: older saves keep their XP, choose a starter, and get a pick per rank", function () {
        var saved = null;
        try { saved = localStorage.getItem("quakeQuest.v1"); } catch (e) { /* ignore */ }
        try {
            localStorage.setItem("quakeQuest.v1", JSON.stringify({ v: 1, on: true, mode: "cadet", xp: 330, ship: 0, answers: {}, collected: {}, badges: {}, stats: { predictions: 9 }, daily: null }));
            var st = QS.loadState();
            assertEqual(st.xp, 330, "XP kept");
            assertEqual(st.ships.length, 0, "no ships yet: the old save had every ship by rank");
            assertEqual(st.ship, null, "no ship in use until one is chosen");
            assertEqual(st.stats.deepPredictions, 0, "new counters start at 0");
            assertEqual(QS.rankIndex(st.xp), 3, "Survey Pilot: three picks waiting after the starter");
        } finally {
            try { if (saved === null) localStorage.removeItem("quakeQuest.v1"); else localStorage.setItem("quakeQuest.v1", saved); } catch (e) { /* ignore */ }
        }
    });

    var failed = results.filter(function (result) { return !result.passed; });
    var list = document.getElementById("results");
    results.forEach(function (result) {
        var item = document.createElement("li");
        item.className = result.passed ? "pass" : "fail";
        item.textContent = (result.passed ? "PASS — " : "FAIL — ") + result.name + (result.message ? ": " + result.message : "");
        list.appendChild(item);
    });

    document.body.dataset.failed = String(failed.length);
    document.getElementById("summary").textContent = (results.length - failed.length) + "/" + results.length + " tests passed";
    document.title = failed.length ? "FAILED — Earthquake Monitor Tests" : "PASS — Earthquake Monitor Tests";

    if (failed.length) {
        console.error("Earthquake Monitor tests failed", failed);
    }
}());
