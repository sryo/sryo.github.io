// Set before first paint so styles.css can lay out the offers front.js will
// drive. If front.js never wires them up, drop back to the no-JS layout.
document.documentElement.classList.add("js");
window.addEventListener("load", function () {
    var offers = document.querySelector(".offers");
    if (offers && !offers.classList.contains("live")) document.documentElement.classList.remove("js");
});

// Also sentence glyphs: ink is scaled to one area (the bounding box's
// geometric mean, capped at the box height) so flat glyphs weigh about the
// same as square ones, and no glyph runs wider than 1.25 boxes.
document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".also .ag svg").forEach(function (svg) {
        var b = svg.getBBox();
        if (!b.width || !b.height) return;
        var side = Math.max(b.height, Math.sqrt(b.width * b.height), b.width / 1.25);
        svg.setAttribute("viewBox", [b.x, b.y + b.height / 2 - side / 2, b.width, side]
            .map(function (n) { return n.toFixed(2); }).join(" "));
        svg.parentNode.style.setProperty("--w", (b.width / side).toFixed(3));
    });
});

// Link hover: a hovered link goes to weight 900 (styles.css). Each plain
// text link gets --swell, the letter-spacing at which its heavy form is as
// wide as its resting one, so hovering never moves the text beside it.
// Measured on the link's text (a Range), so padding and the external
// arrow don't count; links that wrap onto two lines keep the CSS default.
function fitSwell() {
    var links = document.querySelectorAll("a:not(.row):not(.embed-facade)");
    for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (a.closest(".also, .pn") || a.children.length) continue;
        var n = a.textContent.length;
        if (!n) continue;
        var r = document.createRange();
        r.selectNodeContents(a);
        if (r.getClientRects().length !== 1) continue;
        var cs = getComputedStyle(a), size = parseFloat(cs.fontSize);
        var ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);
        var rest = r.getBoundingClientRect().width;
        var keep = a.style.cssText;
        a.style.transition = "none";
        a.style.fontWeight = "900";
        var heavy = r.getBoundingClientRect().width;
        a.style.cssText = keep;
        if (!rest || !heavy || !size) continue;
        a.style.setProperty("--swell", ((ls + (rest - heavy) / n) / size).toFixed(4) + "em");
    }
}
document.addEventListener("DOMContentLoaded", function () {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSwell);
    else fitSwell();
});

// Without JS a facade stays a plain link to Figma.
document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.embed-facade");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    var f = document.createElement("iframe");
    f.src = a.href;
    f.loading = "lazy";
    f.className = "embed-live";
    var h = document.querySelector(".case-title h1");
    var name = h ? h.textContent.split(": ")[0].trim() : "";
    f.title = name ? name + " prototype" : "Figma prototype";
    f.allowFullscreen = true;
    a.replaceWith(f);
});

// An arriving view transition (a glyph flying in from its row): marked on
// <html> while it runs, so motion.js lays nothing over the glyph mid-flight.
window.addEventListener("pagereveal", function (e) {
    if (!e.viewTransition) return;
    var root = document.documentElement;
    root.setAttribute("data-vt", "");
    e.viewTransition.finished.finally(function () { root.removeAttribute("data-vt"); });
});

document.addEventListener("click", function (e) {
    var img = e.target.closest && e.target.closest("figure.wide img");
    if (!img) return;
    var z = document.createElement("div");
    z.className = "zoom";
    z.setAttribute("role", "dialog");
    z.setAttribute("aria-label", img.alt);
    var big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    z.appendChild(big);
    document.body.appendChild(z);
    requestAnimationFrame(function () { z.classList.add("open"); });
    function close() {
        document.removeEventListener("keydown", onKey);
        z.classList.remove("open");
        // Matches the .zoom fade in styles.css.
        setTimeout(function () { z.remove(); }, 200);
    }
    function onKey(k) { if (k.key === "Escape") close(); }
    z.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
});
