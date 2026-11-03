// Phones: tuck the filter rows and tools behind one "Filters" button so the map is
// near the top of the screen. Nothing is removed: the button shows how many filters
// are active and opens the same rows. On larger screens the toolbar is untouched.
(function () {
    "use strict";

    // keep in step with compactViewportQuery in logic.js and the phone rules in mobile.css
    var phone = window.matchMedia("(max-width: 640px), (max-width: 1024px) and (max-height: 500px)");
    var panel = document.querySelector(".toolbar-panel");
    var searchBox = panel && panel.querySelector(".search-box");
    if (!panel || !searchBox) return;

    var rowsId = "toolbar-rows";
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toolbar-toggle";
    toggle.innerHTML = '<span aria-hidden="true">⚙</span><span class="toolbar-toggle-text">Filters</span><span class="toolbar-toggle-count" hidden></span>';
    searchBox.after(toggle);

    // the rows the button opens: everything in the toolbar after the search box
    var rows = Array.prototype.filter.call(panel.children, function (el) { return el !== searchBox && el !== toggle; });
    rows.forEach(function (el, i) { if (!el.id) el.id = rowsId + "-" + i; });
    toggle.setAttribute("aria-controls", rows.map(function (el) { return el.id; }).join(" "));

    // active = anything other than the defaults (All magnitudes, no tsunami filter, All origins)
    function activeCount() {
        var n = 0;
        var mag = panel.querySelector(".mag-filter-chip.is-active[data-mag]");
        if (mag && mag.getAttribute("data-mag") !== "0") n++;
        if (panel.querySelector("#tsunami-filter-chip.is-active")) n++;
        var origin = panel.querySelector(".origin-filter-chip.is-active");
        if (origin && origin.getAttribute("data-origin") !== "all") n++;
        return n;
    }

    function render() {
        var open = panel.classList.contains("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        var n = activeCount();
        var count = toggle.querySelector(".toolbar-toggle-count");
        count.hidden = n === 0;
        count.textContent = String(n);
        toggle.setAttribute("aria-label", (open ? "Hide" : "Show") + " filters and tools" + (n ? ", " + n + " active" : ""));
    }

    function apply() {
        panel.classList.toggle("is-compact", phone.matches);
        if (!phone.matches) panel.classList.remove("is-open");
        render();
    }

    toggle.addEventListener("click", function () {
        panel.classList.toggle("is-open");
        render();
    });
    // recount whenever a chip's state changes, whatever changed it (the tsunami banner's
    // own button toggles the tsunami chip from outside the toolbar)
    if (window.MutationObserver) {
        new MutationObserver(render).observe(panel, { subtree: true, attributes: true, attributeFilter: ["class", "aria-pressed"] });
    }
    if (phone.addEventListener) phone.addEventListener("change", apply);
    else phone.addListener(apply);
    apply();

    window.earthquakeApp = window.earthquakeApp || {};
    window.earthquakeApp.mobileToolbar = { activeCount: activeCount, isCompact: function () { return phone.matches; } };
}());
