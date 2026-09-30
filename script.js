// Optional enhancement: one accent colour per visit, picked from the
// connector palette the ring used. Kept for the session so the ledger and
// its case pages match; without JS the stylesheet's accent applies.
(function () {
    var LINE_COLORS = [
        "#FF2D55", "#00C7BE", "#FFCC00",
        "#007AFF", "#FF9500", "#AF52DE", "#34C759"
    ];
    var color = null;
    try { color = sessionStorage.getItem("accent"); } catch (e) {}
    if (LINE_COLORS.indexOf(color) < 0) {
        color = LINE_COLORS[Math.floor(Math.random() * LINE_COLORS.length)];
        try { sessionStorage.setItem("accent", color); } catch (e) {}
    }
    document.documentElement.style.setProperty("--accent", color);
})();
