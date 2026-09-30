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

// Optional enhancement: a Figma facade loads its prototype in place on
// click. Without JS the link simply opens Figma.
document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.embed-facade");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    var f = document.createElement("iframe");
    f.src = a.href;
    f.loading = "lazy";
    f.className = "embed-live";
    f.title = "Figma prototype";
    f.allowFullscreen = true;
    a.replaceWith(f);
});
