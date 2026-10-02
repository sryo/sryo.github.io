// Offer ring: proof glyphs orbit the thesis; lighting an offer swings its proof glyphs to the front, where they pull apart and recombine.
(function () {
    "use strict";

    var hero = document.querySelector(".or-hero");
    var ring = hero && hero.querySelector(".or-ring");
    var data = document.getElementById("or-data");
    if (!ring || !data) return;
    document.documentElement.classList.add("or-js");

    var DATA = JSON.parse(data.textContent);
    var thesis = hero.querySelector(".or-thesis");
    var list = hero.querySelector(".or-offers");
    var buttons = [].slice.call(hero.querySelectorAll(".or-offer"));
    var proofs = [].slice.call(hero.querySelectorAll(".or-proof"));
    var reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
    var reduce = reduceMQ.matches;
    var TAU = Math.PI * 2;
    var FRONT = Math.PI / 2;   // angle 90° is the bottom of the ellipse: nearest the viewer
    var PAD = 0.3;             // canvas margin around a glyph, so pulled pieces stay inside
    var PULL = 15;             // drift of a piece at full pull, in the glyph's 100-unit box
    var PULSE = 700;           // ms a pulse holds the pieces apart before they recombine

    function spring(s, target, dtn, k, damp) {
        s.v += (target - s.x) * k * dtn;
        s.v *= Math.pow(damp, dtn);
        s.x += s.v * dtn;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function wrap(a) { a %= TAU; return a < 0 ? a + TAU : a; }
    // The copy of `target` (± whole turns) nearest `from`, so a glyph never laps the ring.
    function near(target, from) { return target + TAU * Math.round((from - target) / TAU); }

    // ── Glyph models: one Path2D per _.parts.svg primitive ────────
    function primitivePath(el) {
        function a(k) { return +el.getAttribute(k) || 0; }
        var rx, ry, cx = a("cx"), cy = a("cy");
        switch (el.localName) {
            case "circle":
            case "ellipse":
                rx = el.localName === "circle" ? a("r") : a("rx");
                ry = el.localName === "circle" ? rx : a("ry");
                return "M" + (cx - rx) + " " + cy + "A" + rx + " " + ry + " 0 1 0 " + (cx + rx) + " " + cy +
                    "A" + rx + " " + ry + " 0 1 0 " + (cx - rx) + " " + cy + "Z";
            case "rect":
                return "M" + a("x") + " " + a("y") + "h" + a("width") + "v" + a("height") + "h" + -a("width") + "Z";
            case "polygon":
                return "M" + (el.getAttribute("points") || "").trim().split(/[\s]+/).join("L") + "Z";
            case "path":
                return el.getAttribute("d") || "";
        }
        return "";
    }

    var probe = document.createElement("canvas");
    probe.width = probe.height = 64;
    var pctx = probe.getContext("2d", { willReadFrequently: true });

    function model(parts) {
        var doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + parts + "</svg>", "image/svg+xml");
        var pieces = [];
        [].forEach.call(doc.documentElement.children, function (el) {
            var d = primitivePath(el);
            if (d) pieces.push({ d: d, path: new Path2D(d), solo: (d.match(/[Mm]/g) || []).length > 1 });
        });
        // Centroid and area from a 64 px raster, as the case page's parity pull does.
        pieces.forEach(function (pc) {
            pctx.setTransform(1, 0, 0, 1, 0, 0);
            pctx.clearRect(0, 0, 64, 64);
            pctx.setTransform(0.64, 0, 0, 0.64, 0, 0);
            pctx.fill(pc.path);
            var px = pctx.getImageData(0, 0, 64, 64).data, a = 0, sx = 0, sy = 0;
            for (var i = 3; i < px.length; i += 4) {
                if (!px[i]) continue;
                var j = (i - 3) / 4, w = px[i] / 255;
                a += w; sx += w * (j % 64); sy += w * Math.floor(j / 64);
            }
            pc.area = a;
            pc.cx = a ? (sx / a + 0.5) / 0.64 : 50;
            pc.cy = a ? (sy / a + 0.5) / 0.64 : 50;
        });
        var max = Math.max.apply(null, pieces.map(function (p) { return p.area; })) || 1;
        pieces.forEach(function (pc, i) {
            pc.weight = 0.6 + 0.8 * (1 - pc.area / max);
            pc.angle = i * 2.39996;
            pc.x = { x: 0, v: 0 };
            pc.y = { x: 0, v: 0 };
        });
        return pieces;
    }

    // ── Build the ring ───────────────────────────────────────────
    var G = DATA.glyphs.map(function (g, i) {
        var a = document.createElement("a");
        a.className = "or-g";
        a.href = g.href;
        a.tabIndex = -1;
        a.setAttribute("aria-label", g.name);
        var c = document.createElement("canvas");
        a.append(c);
        ring.append(a);
        return {
            slug: g.slug, name: g.name, el: a, canvas: c, ctx: c.getContext("2d"),
            pieces: model(g.parts), i: i, k: i,
            ang: { x: 0, v: 0 }, sc: { x: 0, v: 0 }, pull: { x: 0, v: 0 },
            arrT: 0,
            pulseT: -1e9, tAng: 0, goal: 0, delay: 0, drawn: "", hover: false, sel: false
        };
    });

    var ink = "#111", geo = null, active = -1, pointer = null;

    function readInk() {
        ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111";
        G.forEach(function (g) { g.drawn = ""; });
    }
    readInk();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readInk(); kick(); });

    // Height on the ring. The near half is flattened at the front (s + s³(1 - s) has zero slope at s = 1),
    // so the proofs sit in a row while the sides keep their plain ellipse height.
    function flat(c) { return c + c * c * c * (1 - c); }
    function ringY(a) { var s = Math.sin(a); return geo.cy + geo.ry * (s > 0 ? flat(s) : s); }

    // Perspective: a glyph at the front of the ring is full size, at the back 45%.
    function persp(a) { return 0.45 + 0.55 * (Math.sin(a) + 1) / 2; }

    // Geometry from the laid-out text. Wide: the ring circles the hero, proofs at its foot under the list,
    // the rest parked in the margins beside the list. Narrow: a band between the thesis and the offers.
    function measure() {
        hero.style.minHeight = "";
        var hr = hero.getBoundingClientRect();
        var tr = thesis.getBoundingClientRect(), lr = list.getBoundingClientRect();
        var W = hr.width, H = hr.height, g = { W: W, H: H, wide: W >= 960, cx: W / 2 };
        g.intro = { l: tr.left - hr.left, r: tr.right - hr.left, y: (tr.top + tr.bottom) / 2 - hr.top, h: tr.height };
        var nRest = G.length - 2;
        if (g.wide) {
            var top = lr.top - hr.top, bot = lr.bottom - hr.top, left = buttons[0].getBoundingClientRect().left - hr.left;
            // The proofs fill the room under the list, 150 to 280 px. A short window grows the hero instead.
            var room = H - bot - 30;
            if (room < 150) { H = bot + 180; g.H = H; hero.style.minHeight = H + "px"; room = 150; }
            // A glyph's art sits inside a margin of its 100-unit box, so the box may run a little past the room.
            var size = Math.min(room * 1.12, 300);
            g.cy = (top + bot) / 2;
            g.rest = clamp(Math.min(size * 0.46, left * 0.7), 56, 120);
            g.frontY = (bot + 14 + H - 16) / 2;
            g.ry = g.frontY - g.cy;
            g.dA = g.rest * 1.3 / g.ry;
            // Rx puts the innermost parked glyph's centre halfway into the margin.
            g.rx = (g.cx - left / 2) / Math.cos((Math.ceil(nRest / 2) - 1) / 2 * g.dA);
            for (var it = 0; it < 4; it++) {
                g.step = size * 1.08 / g.rx;
                // The outer proofs ride up the arc: keep their tops clear of the proof sentence.
                var outerTop = g.frontY - g.ry * (1 - flat(Math.cos(g.step))) - size * persp(FRONT + g.step) / 2;
                if (outerTop >= bot + 4) break;
                size -= bot + 4 - outerTop;
            }
            g.size = size;
            g.parkMid = Math.PI;
        } else {
            var tb = tr.bottom - hr.top, ot = lr.top - hr.top;
            g.size = Math.min(150, (W / 2 - 16) / 1.62);
            g.rest = g.size * 0.44;
            g.frontY = ot - 12 - g.size / 2;
            var backY = tb + 18 + g.rest / 2;
            g.ry = (g.frontY - backY) / 2;
            g.cy = backY + g.ry;
            g.rx = W * 0.4;
            g.step = g.size * 1.06 / g.rx;
            g.dA = g.rest * 1.55 / g.rx;
            g.parkMid = Math.PI * 1.5;
        }
        g.restSc = g.rest / (g.size * persp(g.parkMid));
        g.S = Math.ceil(g.size * 1.3 * (1 + 2 * PAD));
        g.dpr = Math.min(2, devicePixelRatio || 1);
        geo = g;
        G.forEach(function (x) {
            x.el.style.width = x.el.style.height = g.S + "px";
            var px = Math.round(g.S * g.dpr);
            if (x.canvas.width !== px) { x.canvas.width = x.canvas.height = px; x.drawn = ""; }
        });
        layout(false);
    }

    // Parking angles for the glyphs that aren't proof, ascending from the front.
    function slots(n) {
        var out = [], j;
        if (geo.wide) {
            var nl = Math.ceil(n / 2), nr = n - nl;
            for (j = 0; j < nl; j++) out.push(Math.PI + (j - (nl - 1) / 2) * geo.dA);
            for (j = 0; j < nr; j++) out.push(TAU + (j - (nr - 1) / 2) * geo.dA);
        } else {
            for (j = 0; j < n; j++) out.push(Math.PI * 1.5 + (j - (n - 1) / 2) * geo.dA);
        }
        return out;
    }

    // The lit offer's proofs gather at the front; the rest park out of the text's way.
    // The ring turns by one amount, so every glyph keeps its order like a carousel.
    function layout(swing) {
        var proof = DATA.offers[active] || [];
        G.forEach(function (g) { g.sel = proof.indexOf(g.slug) >= 0; });
        var sel = G.filter(function (g) { return g.sel; });
        var rest = G.filter(function (g) { return !g.sel; });
        var sx = 0, sy = 0;
        sel.forEach(function (g) { sx += Math.cos(g.tAng); sy += Math.sin(g.tAng); });
        var mean = Math.atan2(sy, sx);
        function rel(g) { return wrap(g.tAng - mean + Math.PI) - Math.PI; }
        var turn = wrap(FRONT - mean + Math.PI) - Math.PI;
        var k = sel.length;
        sel.sort(function (a, b) { return rel(a) - rel(b); }).forEach(function (g, j) {
            g.goal = FRONT + (j - (k - 1) / 2) * geo.step;
        });
        var sl = slots(rest.length);
        rest.sort(function (a, b) { return wrap(rel(a)) - wrap(rel(b)); }).forEach(function (g, j) { g.goal = sl[j]; });
        G.forEach(function (g) { g.goal = near(g.goal, g.tAng + turn); });
        if (!swing) G.forEach(function (g) { g.ang.x = g.tAng = g.goal; g.ang.v = 0; g.sc.x = g.sel ? 1 : geo.restSc; g.sc.v = 0; });
    }

    // Pieces of the lit glyphs drift apart, then recombine into the whole mark.
    function pulse(delay) {
        if (reduce) return;
        var t = performance.now() + (delay || 0);
        G.forEach(function (g) { if (g.sel) g.pulseT = t; });
        kick();
    }

    function setActive(i, swing) {
        if (i === active) return;
        active = i;
        buttons.forEach(function (b, j) { b.setAttribute("aria-expanded", j === i ? "true" : "false"); });
        proofs.forEach(function (p, j) { p.classList.toggle("is-on", j === i); });
        layout(swing && !reduce);
        pulse(swing ? 200 : 0);
        kick();
    }

    // ── Drawing: XOR, so overlaps are holes, whole and mid-pull ────
    function draw(g) {
        var key = ink + g.pieces.map(function (p) { return Math.round(p.x.x * 10) + "," + Math.round(p.y.x * 10); }).join(";");
        if (key === g.drawn) return;
        g.drawn = key;
        var c = g.ctx, px = g.canvas.width, k = px / (100 * (1 + 2 * PAD));
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, px, px);
        c.setTransform(k, 0, 0, k, PAD * 100 * k, PAD * 100 * k);
        c.globalCompositeOperation = "xor";
        c.fillStyle = ink;
        // Pieces at the same offset fill as one evenodd path: same parity, no seam.
        var groups = {};
        g.pieces.forEach(function (p, i) {
            // Offsets snap to a tenth of a unit, so a settled glyph is one path with no hairline seams.
            var key2 = p.solo ? "s" + i : Math.round(p.x.x * 10) + "," + Math.round(p.y.x * 10);
            var q = groups[key2] || (groups[key2] = { x: Math.round(p.x.x * 10) / 10, y: Math.round(p.y.x * 10) / 10, path: new Path2D(), rule: p.solo ? "nonzero" : "evenodd" });
            q.path.addPath(p.path);
        });
        Object.keys(groups).forEach(function (key2) {
            var q = groups[key2];
            c.save();
            c.translate(q.x, q.y);
            c.fill(q.path, q.rule);
            c.restore();
        });
    }

    // ── Frame loop: runs while something moves, then stops ─────────
    var raf = 0, last = 0, visible = true;

    var HOLD = 420, ARRIVE = 1400;   // ms: an arriving glyph sits on the thesis, then reaches its place
    function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    // Overshoots a little before settling, like the springs.
    function popIn(t) { var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

    function kick() { if (!raf && visible) raf = requestAnimationFrame(tick); }

    function pieceTargets(g, f) {
        var cx = 50, cy = 50, px = cx, py = cy;
        if (g.hover && pointer) {
            var b = g.el.getBoundingClientRect();
            var k = 100 * (1 + 2 * PAD) / b.width;
            px = cx + (pointer.x - (b.left + b.width / 2)) * k;
            py = cy + (pointer.y - (b.top + b.height / 2)) * k;
        }
        return g.pieces.map(function (p) {
            if (f < 0.001) return [0, 0];
            var ux = p.cx - px + 0.35 * (p.cx - cx), uy = p.cy - py + 0.35 * (p.cy - cy);
            var len = Math.hypot(ux, uy);
            if (len < 1) { ux = Math.cos(p.angle); uy = Math.sin(p.angle); len = 1; }
            var m = PULL * f * p.weight;
            return [ux / len * m, uy / len * m];
        });
    }

    function tick(now) {
        raf = 0;
        if (!geo) return;
        var dtn = reduce ? 1 : Math.min(3, (now - (last || now)) / 16.667 || 1);
        last = now;
        var busy = false, n = G.length;

        G.forEach(function (g) {
            var started = reduce || now > g.arrT;
            var goalSc = g.sel ? 1 : geo.restSc;
            var age = now - g.pulseT;
            var goalPull = age >= 0 && age < PULSE ? 1 : 0;
            if (g.hover) goalPull = 0.85;
            if (age < 0) busy = true;
            if (reduce) {
                g.ang.x = g.goal; g.sc.x = goalSc; g.pull.x = 0;
                g.ang.v = g.sc.v = g.pull.v = 0;
            } else {
                spring(g.ang, g.goal, dtn, 0.05, 0.78);
                spring(g.sc, goalSc, dtn, 0.07, 0.76);
                spring(g.pull, goalPull, dtn, 0.07, 0.8);
            }
            g.tAng = g.ang.x;
            var a = g.ang.x;
            var x = geo.cx + Math.cos(a) * geo.rx;
            var y = ringY(a);
            var size = geo.size * persp(a) * g.sc.x;
            // Arrival: each glyph pops up large over the thesis, XORing it, holds, then glides out to its place.
            var e = reduce ? 1e9 : now - g.arrT;
            if (e < ARRIVE) {
                busy = true;
                var f = e < HOLD ? 1 : 1 - easeInOut((e - HOLD) / (ARRIVE - HOLD));
                var span = geo.intro.r - geo.intro.l;
                var ix = geo.intro.l + (g.k + 0.5) / n * span;
                var iy = geo.intro.y + (g.k % 2 ? -0.22 : 0.22) * geo.intro.h;
                x += (ix - x) * f;
                y += (iy - y) * f;
                size += (Math.min(geo.size * 1.3, span / n * 1.3) - size) * f;
                size *= e <= 0 ? 0 : popIn(Math.min(1, e / 320));
            }
            var s = size * (1 + 2 * PAD) / geo.S;
            g.el.style.transform = "translate3d(" + (x - geo.S / 2).toFixed(1) + "px," + (y - geo.S / 2).toFixed(1) + "px,0) scale(" + Math.max(0, s).toFixed(4) + ")";
            g.el.style.zIndex = String(Math.round((Math.sin(a) + 1) * 50) + (g.sel ? 100 : 0));

            var tg = pieceTargets(g, Math.max(0, g.pull.x));
            g.pieces.forEach(function (p, i) {
                if (reduce) { p.x.x = p.y.x = 0; return; }
                spring(p.x, tg[i][0], dtn, 0.16, 0.74);
                spring(p.y, tg[i][1], dtn, 0.16, 0.74);
                if (Math.abs(p.x.v) + Math.abs(p.y.v) + Math.abs(p.x.x - tg[i][0]) + Math.abs(p.y.x - tg[i][1]) > 0.02) busy = true;
            });
            draw(g);
            if (!reduce && (!started || Math.abs(g.ang.v) + Math.abs(g.sc.v) + Math.abs(g.pull.v) > 0.0004 ||
                Math.abs(g.pull.x - goalPull) > 0.01 || Math.abs(g.ang.x - g.goal) > 0.001)) busy = true;
        });

        if (!reduce && busy) kick();
    }

    // ── Tour (wide screens): until someone picks an offer, each lights in turn once, then the first again ──
    var tourTimer = 0, breathTimer = 0, touring = false, step = 0;
    function stopTour() { touring = false; clearTimeout(tourTimer); clearTimeout(breathTimer); }
    function nextTour() {
        if (!touring) return;
        if (!visible || document.hidden) { tourTimer = setTimeout(nextTour, 1000); return; }
        step++;
        setActive(step % DATA.offers.length, true);
        if (step >= DATA.offers.length) { stopTour(); return; }
        breathTimer = setTimeout(function () { if (touring) pulse(); }, 2700);
        tourTimer = setTimeout(nextTour, 5200);
    }

    // ── Input ───────────────────────────────────────────────────
    var fine = matchMedia("(hover: hover) and (pointer: fine)");
    var intent = 0;
    function pick(i) { stopTour(); if (i === active) pulse(); else setActive(i, true); }
    buttons.forEach(function (b, i) {
        // Hover lights an offer only once the pointer rests on it, so passing over the list on the
        // way to a proof link never swaps the link out from under the cursor.
        b.addEventListener("pointermove", function () {
            if (!fine.matches || !geo || !geo.wide || i === active) return;
            clearTimeout(intent);
            intent = setTimeout(function () { stopTour(); setActive(i, true); }, 160);
        });
        b.addEventListener("pointerleave", function () { clearTimeout(intent); });
        b.addEventListener("click", function () { clearTimeout(intent); pick(i); });
        b.addEventListener("focus", function () { if (b.matches(":focus-visible")) { stopTour(); setActive(i, true); } });
    });

    G.forEach(function (g) {
        g.el.addEventListener("pointerenter", function (e) {
            if (e.pointerType !== "mouse") return;
            g.hover = true;
            kick();
        });
        g.el.addEventListener("pointerleave", function () { g.hover = false; kick(); });
    });
    hero.addEventListener("pointermove", function (e) {
        pointer = { x: e.clientX, y: e.clientY };
        if (G.some(function (g) { return g.hover; })) kick();
    });

    new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) kick();
    }).observe(hero);

    var resizeT = 0;
    window.addEventListener("resize", function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(function () { measure(); kick(); }, 120);
    });
    reduceMQ.addEventListener("change", function () { location.reload(); });

    function start() {
        G.forEach(function (g, k) { g.ang.x = g.tAng = FRONT + TAU * k / G.length; });
        measure();
        // First offer lit from the first frame, so a proof is always showing.
        setActive(0, false);
        // Arrival order follows where each glyph lands, left to right, so none cross on the way out.
        G.slice().sort(function (a, b) { return Math.cos(a.goal) - Math.cos(b.goal); }).forEach(function (g, k) { g.k = k; });
        var t0 = performance.now();
        G.forEach(function (g) { g.arrT = reduce ? 0 : t0 + 80 + g.k * 75; });
        pulse(2100);
        kick();
        if (!reduce && geo.wide) { touring = true; tourTimer = setTimeout(nextTour, 5600); }
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
