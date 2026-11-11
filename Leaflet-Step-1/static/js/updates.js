/*
 * What's new: app updates, told to returning visitors (like the other Emberkite games).
 * After an update, someone who has been here before sees the newest update once;
 * "What's new" in the ? guide shows where the app stands today and every update.
 *
 * To announce an update: add an entry at the TOP of CHANGELOG with the next number,
 * refresh APP_TODAY if the big picture changed, and bump this file's ?v= in index.html.
 */
(function () {
    "use strict";

    /** Where the app stands today, at the top of the full history. */
    var APP_TODAY = [
        "A 3D globe of every earthquake USGS reports, live: size shows magnitude, colour shows depth. Pick 1 hour to 30 days, or an older range.",
        "Search by place, filter by magnitude or by origin (natural, or human-made such as quarry blasts), play a timelapse, and download the list as CSV or GeoJSON.",
        "Tap a quake for its details, alert level and shaking, then ✨ Explain this quake for a plain-English account from Claude.",
        "Layers: five map styles, tectonic plates, an energy heatmap, and a fleet of airships that ping the quakes they pass.",
        "Quake Quest (🧭): predict each quake before you peek, climb the ranks, earn airships, and keep your progress on an Emberkite tag."
    ];

    /** Newest first. */
    var CHANGELOG = [
        {
            v: 10, date: "10 Nov 2026", title: "Layers fit on phones", items: [
                "The Layers menu stays inside the map on phones now, and scrolls when the options don't all fit.",
                "Updates like this one now show here when you come back. Find them all again under ? → What's new."
            ]
        },
        {
            v: 9, date: "8 Nov 2026", title: "Link previews", items: [
                "Sharing a link to the app now shows a picture of the globe and a short description."
            ]
        },
        {
            v: 8, date: "3 Nov 2026", title: "Popups that fit", items: [
                "Quake, airship and plate popups always fit on the map, even near the poles.",
                "Tapping a quake stops the globe spinning, so it stays put while you read."
            ]
        },
        {
            v: 7, date: "2 Nov 2026", title: "Emberkite tags", items: [
                "Claim an Emberkite tag (one gamer tag for every Emberkite game) in the Field Journal to keep your Quake Quest progress on any device.",
                "The Field Journal's Leaders tab ranks players by XP."
            ]
        },
        {
            v: 6, date: "2 Nov 2026", title: "Better on phones", items: [
                "The map leads on phones: filters fold away under a Filters button, and the stats are a row you swipe.",
                "Quake popups on phones keep the essentials up front, with the rest a tap away.",
                "Works the right way up or on its side."
            ]
        },
        {
            v: 5, date: "2 Nov 2026", title: "Quake Quest", items: [
                "A geology game on the live map: tap a quake and predict its depth, energy or plate boundary before you peek.",
                "Climb the ranks and earn airships. Each one carries an instrument, and 📡 Scan finds quakes you haven't predicted yet.",
                "Your Field Journal (🧭) keeps your lessons, badges and missions."
            ]
        },
        {
            v: 4, date: "2 Nov 2026", title: "Ask Claude about any quake", items: [
                "✨ Explain this quake: a plain-English account of what happened, how deep, and how much energy it released.",
                "The app's new home is quakes.emberkitegames.com.",
                "Tectonic plates were redrawn with all seven kinds of boundary.",
                "The tsunami flag now reads \"tsunami-capable\": it is not a warning. Official warnings are at tsunami.gov."
            ]
        },
        {
            v: 3, date: "14 Sep 2026", title: "Alert levels and downloads", items: [
                "Quakes show their alert level (green to red) and how strongly they were felt.",
                "Filter natural quakes from human-made ones such as quarry blasts and mining explosions.",
                "Download the quakes you're looking at as CSV or GeoJSON."
            ]
        },
        {
            v: 2, date: "1 Sep 2026", title: "Hear the quakes", items: [
                "Each quake has a sound to match its size (🔊 Audio turns it on and off).",
                "The Energy Heatmap layer shows where the most energy is being released."
            ]
        },
        {
            v: 1, date: "23 Aug 2026", title: "The globe and the airships", items: [
                "Earthquakes on a 3D globe you can spin and zoom.",
                "Three squadrons of airships orbit the globe and ping the quakes they fly over. Tap one to see it in 3D."
            ]
        }
    ];

    var VERSION = CHANGELOG[0].v;
    var SEEN_KEY = "earthquakeMonitor.seenUpdate";
    /** Anything one of these keys holds means this visitor has been here before. */
    var BEEN_HERE = ["quakeQuest.v1", "emberkite.player"];

    function read(store, key) {
        try { return store.getItem(key); } catch (e) { return null; }
    }

    function write(store, key, value) {
        try { store.setItem(key, value); } catch (e) { /* private mode: they'll see it again, no harm */ }
    }

    /**
     * Which update (if any) to show on arrival, and remember that it was shown.
     * A first-time visitor is marked up to date silently: "what's new" means nothing yet.
     */
    function takeArrivalNotice(store) {
        var seen = Number(read(store, SEEN_KEY)) || 0;
        if (seen >= VERSION) return null;
        var returning = seen > 0 || BEEN_HERE.some(function (key) { return read(store, key) !== null; });
        write(store, SEEN_KEY, String(VERSION));
        if (!returning) return null;
        return CHANGELOG.filter(function (u) { return u.v > seen; }).slice(0, 3);
    }

    // ------------------------------------------------------------------ the card
    var backdrop = null;
    var lastFocus = null;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function entryCard(update) {
        var card = el("article", "update-entry");
        var head = el("div", "update-entry-head");
        head.appendChild(el("h3", null, update.title));
        head.appendChild(el("span", "update-entry-date", update.date));
        card.appendChild(head);
        var list = el("ul");
        update.items.forEach(function (item) { list.appendChild(el("li", null, item)); });
        card.appendChild(list);
        return card;
    }

    function render(body, updates, full) {
        body.textContent = "";
        if (full) {
            var today = el("article", "update-entry update-today");
            today.appendChild(el("h3", null, "The app today"));
            var list = el("ul");
            APP_TODAY.forEach(function (line) { list.appendChild(el("li", null, line)); });
            today.appendChild(list);
            body.appendChild(today);
        }
        updates.forEach(function (u) { body.appendChild(entryCard(u)); });
    }

    function close() {
        if (!backdrop) return;
        backdrop.remove();
        backdrop = null;
        document.removeEventListener("keydown", onKey, true);
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    function onKey(event) {
        if (event.key === "Escape") {
            event.stopPropagation();
            close();
        }
    }

    /** updates: the entries to show; omit for the full history. */
    function open(updates) {
        close();
        var full = !updates;
        lastFocus = document.activeElement;

        backdrop = el("div", "guide-modal-backdrop updates-backdrop");
        var modal = el("div", "guide-modal updates-modal");
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "updates-title");
        modal.tabIndex = -1;

        var header = el("div", "guide-modal-header");
        var brand = el("div", "guide-modal-brand");
        brand.appendChild(el("span", "guide-header-icon", "🌋"));
        var titles = el("div");
        var title = el("h2", "guide-modal-title", "What's new");
        title.id = "updates-title";
        titles.appendChild(title);
        titles.appendChild(el("p", "guide-modal-subtitle", "Earthquake Monitor · update " + VERSION));
        brand.appendChild(titles);
        header.appendChild(brand);
        var x = el("button", "guide-modal-close", "✕");
        x.type = "button";
        x.setAttribute("aria-label", "Close what's new");
        x.addEventListener("click", close);
        header.appendChild(x);

        var body = el("div", "guide-modal-body updates-body");
        render(body, full ? CHANGELOG : updates, full);

        var footer = el("div", "guide-modal-footer");
        var all = el("button", "updates-all-btn", "All updates");
        all.type = "button";
        all.hidden = full;
        all.addEventListener("click", function () {
            render(body, CHANGELOG, true);
            body.scrollTop = 0;
            all.hidden = true;
            done.focus();
        });
        var done = el("button", "guide-done-btn", "Got it");
        done.type = "button";
        done.addEventListener("click", close);
        footer.appendChild(all);
        footer.appendChild(done);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);
        backdrop.addEventListener("click", function (event) { if (event.target === backdrop) close(); });
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(backdrop);
        modal.focus();
    }

    /** Something else already on screen (the guide, the Field Journal, a sign-in)? Then wait. */
    function anotherDialogOpen() {
        return Array.prototype.some.call(document.querySelectorAll('[aria-modal="true"]'), function (node) {
            return node.getClientRects().length > 0;
        });
    }

    function showOnArrival(tries) {
        var store;
        try { store = window.localStorage; } catch (e) { return; }   // storage blocked: nothing to compare against
        var notice = takeArrivalNotice(store);
        if (!notice || !notice.length) return;
        (function attempt(left) {
            if (anotherDialogOpen() && left > 0) return setTimeout(function () { attempt(left - 1); }, 1500);
            open(notice);
        })(tries);
    }

    function init() {
        var guideFooter = document.querySelector("#guide-modal .guide-modal-footer");
        if (!guideFooter) return;   // not the app page (tests, the Field Guide)
        var btn = el("button", "updates-all-btn", "✨ What's new");
        btn.type = "button";
        btn.id = "open-updates";
        btn.addEventListener("click", function () {
            var closeGuide = document.getElementById("close-guide-modal");
            if (closeGuide) closeGuide.click();
            open();
        });
        guideFooter.insertBefore(btn, guideFooter.lastElementChild);
        setTimeout(function () { showOnArrival(10); }, 1200);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.quakeUpdates = {
        CHANGELOG: CHANGELOG,
        APP_TODAY: APP_TODAY,
        VERSION: VERSION,
        SEEN_KEY: SEEN_KEY,
        takeArrivalNotice: takeArrivalNotice,
        open: open,
        close: close
    };
}());
