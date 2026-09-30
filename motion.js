// Motion for the portfolio pages: parity pull on the case glyph. Deferred;
// every effect checks reduced motion itself and sleeps when idle.
(function () {
    "use strict";

    var reduce = matchMedia("(prefers-reduced-motion: reduce)");
    var finePointer = matchMedia("(hover: hover) and (pointer: fine)");

    function accent() {
        return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#E94136";
    }

    // Frame-rate independent spring step. x, v, target in any unit; dtn is
    // elapsed time in 60 Hz frames.
    function spring(s, target, dtn, k, damp) {
        s.v += (target - s.x) * k * dtn;
        s.v *= Math.pow(damp, dtn);
        s.x += s.v * dtn;
    }

    // ── Parity pull ─────────────────────────────────────────────
    // The spec glyph's shapes drift apart near the pointer. Each subpath is
    // its own piece, filled on a canvas with globalCompositeOperation "xor"
    // (alpha = a + b - 2ab), so wherever two pieces overlap there's a hole,
    // exactly as fill-rule="evenodd" draws the glyph at rest. The canvas is
    // laid over the <img> only after an arrival view transition ends, and is
    // gone before the page swaps, so the glyph's flight never sees it.

    var REACH = 1.5;      // pull reaches 1.5 glyph widths from its centre
    var PULL = 9;         // max drift, in the glyph's 100-unit viewBox
    var PAD = 0.25;       // canvas margin around the glyph, as a share of it

    // Glyph SVG (a data: URI) to pieces: one absolute subpath each. Paths
    // with relative commands or transforms stay one piece (still correct,
    // just not pulled apart).
    function glyphPieces(img) {
        var m = /^data:image\/svg\+xml;base64,(.*)$/.exec(img.getAttribute("src") || "");
        if (!m) return null;
        var doc = new DOMParser().parseFromString(atob(m[1]), "image/svg+xml");
        var svg = doc.querySelector("svg");
        if (!svg || doc.querySelector("[transform]")) return null;
        var vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/[\s,]+/).map(Number);
        var pieces = [];
        doc.querySelectorAll("path").forEach(function (p) {
            var d = (p.getAttribute("d") || "").trim();
            var parts = /[a-z]/.test(d.replace(/e/g, "")) ? [d] : d.split(/(?=M)/);
            parts.forEach(function (sub) { if (sub.trim()) pieces.push({ d: sub, path: new Path2D(sub) }); });
        });
        if (pieces.length < 2) return null;
        // Centroid and area of each piece, from a 64 px raster of it.
        var S = 64, c = document.createElement("canvas");
        c.width = c.height = S;
        var ctx = c.getContext("2d", { willReadFrequently: true });
        pieces.forEach(function (pc) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, S, S);
            ctx.setTransform(S / vb[2], 0, 0, S / vb[3], -vb[0] * S / vb[2], -vb[1] * S / vb[3]);
            ctx.fill(pc.path);
            var px = ctx.getImageData(0, 0, S, S).data, a = 0, sx = 0, sy = 0;
            for (var i = 3; i < px.length; i += 4) {
                if (!px[i]) continue;
                var j = (i - 3) / 4, w = px[i] / 255;
                a += w; sx += w * (j % S); sy += w * Math.floor(j / S);
            }
            pc.area = a;
            pc.cx = a ? vb[0] + (sx / a + 0.5) * vb[2] / S : vb[0] + vb[2] / 2;
            pc.cy = a ? vb[1] + (sy / a + 0.5) * vb[3] / S : vb[1] + vb[3] / 2;
        });
        var max = Math.max.apply(null, pieces.map(function (p) { return p.area; })) || 1;
        pieces.forEach(function (pc, i) {
            // Small pieces travel further, so a hole slides out of its shape.
            pc.weight = 0.6 + 0.8 * (1 - pc.area / max);
            pc.angle = i * 2.39996;
            pc.x = { x: 0, v: 0 };
            pc.y = { x: 0, v: 0 };
        });
        return { vb: vb, pieces: pieces };
    }

    function parityPull(glyph) {
        var img = glyph.querySelector("img");
        if (!img || glyph.classList.contains("colour")) return;
        var model = null, canvas = null, ctx = null, raf = 0, last = 0;
        var pointer = null, engaged = false, tapUntil = 0, ink = "#000", edge = "#000";

        function flying() { return document.documentElement.hasAttribute("data-vt"); }

        function ensure() {
            if (canvas) return true;
            if (flying()) return false;
            if (model === null) model = glyphPieces(img) || false;
            if (!model) return false;
            canvas = document.createElement("canvas");
            canvas.className = "parity";
            canvas.setAttribute("aria-hidden", "true");
            canvas.style.cssText = "position:absolute;pointer-events:none;display:none";
            glyph.style.position = "relative";
            glyph.append(canvas);
            ctx = canvas.getContext("2d", { willReadFrequently: true });
            return true;
        }

        function teardown() {
            cancelAnimationFrame(raf);
            raf = 0;
            engaged = false;
            pointer = null;
            if (model) model.pieces.forEach(function (p) { p.x.x = p.x.v = p.y.x = p.y.v = 0; });
            if (canvas) canvas.remove();
            canvas = ctx = null;
            img.style.opacity = "";
        }

        function size() {
            var w = glyph.clientWidth, pad = Math.round(w * PAD), dpr = Math.min(2, devicePixelRatio || 1);
            var px = Math.round((w + 2 * pad) * dpr);
            if (canvas.width !== px) { canvas.width = canvas.height = px; }
            canvas.style.left = canvas.style.top = -pad + "px";
            canvas.style.width = canvas.style.height = w + 2 * pad + "px";
            return { w: w, pad: pad, dpr: dpr };
        }

        function draw(moved) {
            var s = size(), vb = model.vb, k = s.w / vb[2];
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(k * s.dpr, 0, 0, k * s.dpr, (s.pad - vb[0] * k) * s.dpr, (s.pad - vb[1] * k) * s.dpr);
            ctx.globalCompositeOperation = "xor";
            ctx.fillStyle = ink;
            model.pieces.forEach(function (p) {
                ctx.save();
                ctx.translate(p.x.x, p.y.x);
                ctx.fill(p.path);
                ctx.restore();
            });
            // The pulled shapes' outline is the one accent line, fading as
            // they come home. Drawn on top, so the ink itself is never tinted.
            ctx.globalCompositeOperation = "source-over";
            if (moved > 0.3) {
                ctx.strokeStyle = edge;
                ctx.lineWidth = 1 / k;
                ctx.globalAlpha = Math.min(1, moved / 4);
                model.pieces.forEach(function (p) {
                    ctx.save();
                    ctx.translate(p.x.x, p.y.x);
                    ctx.stroke(p.path);
                    ctx.restore();
                });
                ctx.globalAlpha = 1;
            }
        }

        function targets() {
            var b = glyph.getBoundingClientRect(), vb = model.vb, k = vb[2] / b.width;
            var f = 0, px = vb[0] + vb[2] / 2, py = vb[1] + vb[3] / 2;
            if (pointer && (engaged || performance.now() < tapUntil)) {
                var dx = pointer.x - (b.left + b.width / 2), dy = pointer.y - (b.top + b.height / 2);
                var t = 1 - Math.hypot(dx, dy) / (REACH * b.width);
                if (performance.now() < tapUntil) t = 1;
                t = Math.max(0, Math.min(1, t));
                f = t * t * (3 - 2 * t);
                px += dx * k;
                py += dy * k;
            }
            var cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2;
            return model.pieces.map(function (p) {
                if (!f) return [0, 0];
                // Away from the pointer, and a little out from the centre,
                // so concentric pieces still part.
                var ux = p.cx - px + 0.35 * (p.cx - cx), uy = p.cy - py + 0.35 * (p.cy - cy);
                var len = Math.hypot(ux, uy);
                if (len < 1) { ux = Math.cos(p.angle); uy = Math.sin(p.angle); len = 1; }
                var m = PULL * f * p.weight;
                return [ux / len * m, uy / len * m];
            });
        }

        function tick(now) {
            raf = 0;
            if (!canvas) return;
            var dtn = Math.min(3, (now - (last || now)) / 16.667 || 1);
            last = now;
            var tg = targets(), moved = 0, busy = false;
            model.pieces.forEach(function (p, i) {
                spring(p.x, tg[i][0], dtn, 0.18, 0.72);
                spring(p.y, tg[i][1], dtn, 0.18, 0.72);
                var off = Math.hypot(p.x.x, p.y.x);
                moved = Math.max(moved, off);
                if (off > 0.02 || Math.abs(p.x.v) + Math.abs(p.y.v) > 0.02 || tg[i][0] || tg[i][1]) busy = true;
            });
            var live = engaged || now < tapUntil;
            if (!busy && !live) {
                // Home: the <img> takes over again.
                canvas.style.display = "none";
                img.style.opacity = "";
                last = 0;
                return;
            }
            canvas.style.display = "block";
            img.style.opacity = "0";
            draw(moved);
            raf = requestAnimationFrame(tick);
        }

        function wake() {
            if (!ensure()) return;
            if (!raf) {
                ink = getComputedStyle(img).filter.indexOf("invert") >= 0 ? "#fff" : "#000";
                edge = accent();
                last = 0;
                raf = requestAnimationFrame(tick);
            }
        }

        // Fine pointers: the pull follows the cursor within reach.
        window.addEventListener("pointermove", function (e) {
            if (e.pointerType !== "mouse" || !finePointer.matches || reduce.matches) return;
            var b = glyph.getBoundingClientRect();
            var d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
            var near = d < REACH * b.width;
            if (!near && !engaged) return;
            engaged = near;
            pointer = { x: e.clientX, y: e.clientY };
            wake();
        }, { passive: true });
        document.documentElement.addEventListener("pointerleave", function () {
            engaged = false;
        });

        // Touch and pen: one tap, one out-and-back (about 0.9 s).
        glyph.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse" || reduce.matches) return;
            pointer = { x: e.clientX, y: e.clientY };
            tapUntil = performance.now() + 350;
            wake();
        });

        window.addEventListener("pageswap", teardown);
        window.addEventListener("pagehide", teardown);
    }

    function start() {
        if (reduce.matches) return;
        document.querySelectorAll(".spec .glyph").forEach(parityPull);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
