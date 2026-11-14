// Signature footer: when the ask scrolls in, two client glyphs land on it and XOR the type, then everything settles into a frame of big glyphs clear of the poster's text.
(function () {
    "use strict";

    var foot = document.querySelector(".sig");
    if (!foot || !window.Path2D || !window.IntersectionObserver) return;
    var stage = foot.querySelector(".sig-stage");
    var ask = foot.querySelector(".sig-ask");
    var askText = ask.querySelector(".sig-l") || ask;
    var poster = foot.querySelector(".sig-poster");
    var reachEl = poster.querySelector(".sig-reach");
    var links = [].slice.call(foot.querySelectorAll(".sig-g"));
    if (!links.length) return;
    document.documentElement.classList.add("sig-js");
    // Reads the side glyph size from the CSS (--gs), so the type scale and the ring stay in one place.
    var gsProbe = document.createElement("span");
    gsProbe.className = "sig-gs";
    gsProbe.setAttribute("aria-hidden", "true");
    foot.append(gsProbe);

    var reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
    var reduce = reduceMQ.matches;
    var PAD = 0.3;        // canvas overhang around a glyph's 100-unit box, matches the CSS inset
    var PULL = 22;        // drift of a piece at full pull, in the glyph's 100-unit box
    var CLIENT = 1.75;    // client glyphs' ink is this much bigger than a side project's
    var CLEAR = 16;       // px between a resting glyph's ink box and any line of the poster
    var STAG = 640;       // ms between landings: one lander on the type at a time
    var POP = 260;        // ms to pop up to full size
    var HOLD = 400;       // ms a landing glyph sits on the ask, pop included
    var GLIDE = 760;      // ms from the ask to its place in the frame
    var RING0 = 60;       // ms before the first glyph pops straight into the frame
    var RSTAG = 32;       // ms between those pops, both sides of the frame at once
    var LEAVE = 1.8;      // departure plays the arrival backwards, this much faster
    var FOCUS_PULL = 0.45;   // focus pulls the pieces a little apart; the glyph stays recognisable
    var FOCUS_ROOM = 40;  // px under a glyph's ink for its name on hover and focus: 10 gap, 22 line, 8 spare
    var EDGE = 0.7;       // phone: share of a glyph's width on screen when it bleeds off a side, the same for all

    function spring(s, target, dtn, k, damp) {
        s.v += (target - s.x) * k * dtn;
        s.v *= Math.pow(damp, dtn);
        s.x += s.v * dtn;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function popIn(t) { var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
    // Stable per-glyph noise in [-1, 1], so the frame's irregularity is the same on every visit.
    function noise(i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

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

    // The primitives: _.parts.svg (base64, from the build), else the inline glyph's own shapes.
    function partsOf(a) {
        var src = a.dataset.parts, svg;
        if (src) {
            var bin = atob(src), bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            svg = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml").documentElement;
        } else {
            svg = a.querySelector("svg");
        }
        return svg ? [].slice.call(svg.children) : [];
    }

    var probe = document.createElement("canvas");
    probe.width = probe.height = 64;
    var pctx = probe.getContext("2d", { willReadFrequently: true });

    // Pieces with centroid and area, plus the whole glyph's ink box in its 100-unit frame.
    function model(els) {
        var pieces = [], ink = { l: 100, t: 100, r: 0, b: 0 };
        els.forEach(function (el) {
            var d = primitivePath(el);
            if (d) pieces.push({ path: new Path2D(d), solo: (d.match(/[Mm]/g) || []).length > 1 });
        });
        pieces.forEach(function (pc) {
            pctx.setTransform(1, 0, 0, 1, 0, 0);
            pctx.clearRect(0, 0, 64, 64);
            pctx.setTransform(0.64, 0, 0, 0.64, 0, 0);
            pctx.fill(pc.path);
            var px = pctx.getImageData(0, 0, 64, 64).data, a = 0, sx = 0, sy = 0;
            for (var i = 3; i < px.length; i += 4) {
                if (px[i] < 64) continue;
                var j = (i - 3) / 4, w = px[i] / 255, X = j % 64, Y = Math.floor(j / 64);
                a += w; sx += w * X; sy += w * Y;
                ink.l = Math.min(ink.l, X / 0.64); ink.r = Math.max(ink.r, (X + 1) / 0.64);
                ink.t = Math.min(ink.t, Y / 0.64); ink.b = Math.max(ink.b, (Y + 1) / 0.64);
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
        if (ink.r <= ink.l) ink = { l: 0, t: 0, r: 100, b: 100 };
        return { pieces: pieces, ink: ink };
    }

    var G = links.map(function (a, i) {
        var c = document.createElement("canvas");
        a.append(c);
        var m = model(partsOf(a)), ink = m.ink;
        return {
            el: a, li: a.parentNode, canvas: c, ctx: c.getContext("2d"), pieces: m.pieces, i: i,
            // Ink box in the 100-unit frame: sizes are set by ink, so a bell and a disc read the same size.
            il: ink.l, ir: ink.r, ib: ink.b,
            iw: ink.r - ink.l, ih: ink.b - ink.t, icx: (ink.l + ink.r) / 2, icy: (ink.t + ink.b) / 2,
            ox: { x: 0, v: 0 }, oy: { x: 0, v: 0 }, pull: { x: 0, v: 0 },
            hover: false, focus: false, drawn: "", x: 0, y: 0, size: 0, base: 0, box: 0, rot: 0,
            client: a.classList.contains("client"), lander: false, k: 0, rx: 0, ry: 0, start: 0, dur: POP
        };
    });
    var clients = G.filter(function (g) { return g.client; });
    var sides = G.filter(function (g) { return !g.client; });
    // Corners from the ledger's order; fewer than four clients borrow side projects.
    var pool = clients.concat(sides);
    var C = { tl: pool[0], tr: pool[1], br: pool[2], bl: pool[3] };
    var corners = [C.tl, C.tr, C.br, C.bl].filter(Boolean);
    sides = G.filter(function (g) { return corners.indexOf(g) < 0; });
    var ORDER = [];
    var END = 0;

    // Difference blend: white reads as ink on paper and as paper where glyphs overlap the type or each other.
    var INK = "#fff";

    // ── Geometry ──────────────────────────────────────────────────
    // Client rects of every text box under an element (a range over the element itself would add block boxes).
    function textRects(el) {
        var out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange(), n;
        while ((n = w.nextNode())) {
            if (!n.nodeValue.trim()) continue;
            r.selectNodeContents(n);
            [].push.apply(out, [].slice.call(r.getClientRects()));
        }
        return out;
    }
    // Lines of a block, merged from its text rects (a link splits a line into two rects), in the footer's frame.
    function lines(el, fr) {
        var out = [];
        textRects(el).forEach(function (q) {
            if (q.width < 2) return;
            var cy = (q.top + q.bottom) / 2 - fr.top;
            var ln = out.filter(function (o) { return Math.abs(o.cy - cy) < q.height * 0.4; })[0];
            if (!ln) out.push(ln = { cy: cy, l: q.left - fr.left, r: q.right - fr.left, t: q.top - fr.top, b: q.bottom - fr.top, h: q.height });
            ln.l = Math.min(ln.l, q.left - fr.left);
            ln.r = Math.max(ln.r, q.right - fr.left);
            ln.t = Math.min(ln.t, q.top - fr.top);
            ln.b = Math.max(ln.b, q.bottom - fr.top);
        });
        return out.sort(function (a, b) { return a.cy - b.cy; });
    }

    var geo = null;

    // A glyph's ink half-extents at a given ink size (the bigger ink side equals `ink`).
    function half(g, ink) {
        var k = ink / Math.max(g.iw, g.ih);
        return [g.iw * k / 2, g.ih * k / 2];
    }
    function setInk(g, ink) {
        g.ink = ink;
        g.base = ink * 100 / Math.max(g.iw, g.ih);
        // Half extents of the turned ink box: what has to clear the text.
        var h = half(g, ink), a = Math.abs(g.rot * Math.PI / 180), cs = Math.cos(a), sn = Math.sin(a);
        g.hw = h[0] * cs + h[1] * sn; g.hh = h[0] * sn + h[1] * cs;
    }
    // Text in a horizontal band [y0, y1]: the leftmost and rightmost edges among lines touching it.
    function textSpan(ls, y0, y1) {
        var l = Infinity, r = -Infinity;
        ls.forEach(function (ln) { if (ln.b > y0 && ln.t < y1) { l = Math.min(l, ln.l); r = Math.max(r, ln.r); } });
        return [l, r];
    }
    // Text in a vertical band [x0, x1]: the top of the highest and the bottom of the lowest line touching it.
    function textCol(ls, x0, x1) {
        var t = Infinity, b = -Infinity;
        ls.forEach(function (ln) { if (ln.r > x0 && ln.l < x1) { t = Math.min(t, ln.t); b = Math.max(b, ln.b); } });
        return [t, b];
    }

    // Lays glyphs along a run between two points, spare length shared out unevenly.
    function run(list, axis, from, to, cross) {
        if (!list.length) return;
        var len = Math.abs(to - from), dir = to > from ? 1 : -1;
        var widths = list.map(function (g) { return axis === "x" ? g.hw * 2 : g.hh * 2; });
        var spare = len - widths.reduce(function (a, b) { return a + b; }, 0);
        var w = [], W = 0;
        for (var j = 0; j <= list.length; j++) { var v = 1 + 0.5 * noise(list[0].i + j, 3); if (j === 0 || j === list.length) v *= 0.5; w.push(v); W += v; }
        var c = from;
        list.forEach(function (g, j) {
            c += dir * (spare * w[j] / W + widths[j] / 2);
            if (axis === "x") { g.rx = c; g.ry = cross(g, j); } else { g.ry = c; g.rx = cross(g, j); }
            c += dir * widths[j] / 2;
        });
    }

    // Phone: as many glyphs as fit down one side, each bleeding off the edge by the same share and CLEAR off the text.
    // Returns the ones that found no room.
    function column(list, isL, y0, y1, ls, W) {
        var y = y0, out = [];
        while (list.length) {
            var q = list[0], cy = y + q.hh;
            if (cy + q.hh > y1) { out = out.concat(list.splice(0)); break; }
            var sp = textSpan(ls, cy - q.hh - CLEAR, cy + q.hh + CLEAR);
            var minX = q.hw * (2 * EDGE - 1), x;
            if (isL) x = Math.min(isFinite(sp[0]) ? sp[0] - CLEAR - q.hw : Infinity, minX);
            else x = Math.max(isFinite(sp[1]) ? sp[1] + CLEAR + q.hw : -Infinity, W - minX);
            var ok = isL ? x >= minX - 0.5 : x <= W - minX + 0.5;
            if (ok) { q.rx = x; q.ry = cy; list.shift(); y = cy + q.hh + 14; }
            else y += 6;
        }
        return out;
    }

    // Moves a resting glyph's ink box off every (padded) line of the poster, by the shortest way out.
    // On a phone a sideways move never pushes it more than (1 - EDGE) off screen.
    function clearText(q, rects, W, narrow, cx) {
        for (var pass = 0; pass < 8; pass++) {
            var hit = null;
            rects.forEach(function (R) {
                if (!hit && q.rx - q.hw < R.r && q.rx + q.hw > R.l && q.ry - q.hh < R.b && q.ry + q.hh > R.t) hit = R;
            });
            if (!hit) return;
            var opts = [];
            if (q.rx <= cx) opts.push({ dx: hit.l - (q.rx + q.hw), dy: 0 });
            if (q.rx >= cx) opts.push({ dx: hit.r - (q.rx - q.hw), dy: 0 });
            if (q.ry <= (hit.t + hit.b) / 2) opts.push({ dx: 0, dy: hit.t - (q.ry + q.hh) });
            else opts.push({ dx: 0, dy: hit.b - (q.ry - q.hh) });
            var minX = q.hw * (2 * EDGE - 1);
            opts = opts.filter(function (o) {
                if (!narrow || !o.dx) return true;
                var x = q.rx + o.dx;
                return x >= minX && x <= W - minX;
            });
            opts.sort(function (a, b) { return Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy); });
            q.rx += opts[0].dx; q.ry += opts[0].dy;
        }
    }

    function measure() {
        var W = foot.getBoundingClientRect().width, gs = gsProbe.getBoundingClientRect().width || 120;
        var narrow = W < 768, H0 = innerHeight, c = CLEAR;
        var side = narrow ? clamp(W * 0.27, 88, 112) : gs, big = side * (narrow ? 1.5 : CLIENT);
        G.forEach(function (g) { g.rot = (g.client ? 5 : 11) * noise(g.i, 2); });
        sides.forEach(function (g) { setInk(g, side * (1 + 0.06 * noise(g.i, 1))); });
        corners.forEach(function (g) { setInk(g, g.client ? big : side); });
        // Phone: the round first client lands and rests down the right side, so the book takes the top left corner.
        var tl = narrow ? C.bl : C.tl, tr = C.tr, br = C.br, bl = narrow ? C.tl : C.bl;
        if (narrow && bl) setInk(bl, side);

        // The poster sits centred in one screen; the bands above and below hold the frame's top and bottom.
        var ph = poster.getBoundingClientRect().height;
        var top, bot;
        if (narrow) {
            top = Math.max(tl ? tl.hh * 2 + 8 + c : 0, tr ? tr.hh * 2 + 8 + c : 0, side + c);
            bot = side;
        } else {
            top = Math.max(side + 8 + c + FOCUS_ROOM, (H0 - ph) / 2);
            bot = Math.max(side * 0.75 + c, H0 - ph - top);
        }
        stage.style.setProperty("--ring-t", Math.round(top) + "px");
        stage.style.setProperty("--ring-b", Math.round(bot) + "px");

        var fr = foot.getBoundingClientRect(), H = fr.height;
        var askL = lines(askText, fr), reachL = lines(reachEl, fr), all = askL.concat(reachL);
        if (!askL.length) return;
        var g = { W: W, H: H, narrow: narrow };
        var l1 = askL[0], last = all[all.length - 1];
        var reachTop = reachL.length ? reachL[0].t : l1.b, textBot = last.b;
        var pad = all.map(function (ln) { return { l: ln.l - c, r: ln.r + c, t: ln.t - c, b: ln.b + c }; });
        var sq = sides.slice(), segs, order = [];

        if (!narrow) {
            // The two top clients sit off the ask's first line, beside it; the bottom ones bleed off the corners.
            if (tl) { tl.rx = l1.l - c - tl.hw; tl.ry = Math.max(tl.hh + 8, l1.cy - tl.hh * 0.45); }
            if (tr) { tr.rx = l1.r + c + tr.hw; tr.ry = Math.max(tr.hh + 8, l1.cy - tr.hh * 0.45); }
            if (br) { br.rx = W - br.hw * 0.8; br.ry = H - br.hh * 0.78; }
            if (bl) { bl.rx = bl.hw * 0.8; bl.ry = H - bl.hh * 0.78; }
            [tl, tr, br, bl].forEach(function (k) { if (k) clearText(k, pad, W, false, W / 2); });
            segs = [
                { id: "top", axis: "x", from: tl ? tl.rx + tl.hw * 0.8 : 0, to: tr ? tr.rx - tr.hw * 0.8 : W, corner: tl },
                { id: "right", axis: "y", from: tr && W - (tr.rx + tr.hw) < side * 1.3 ? tr.ry + tr.hh * 0.85 : side * 0.15, to: br ? br.ry - br.hh * 0.85 : H, corner: tr },
                { id: "bottom", axis: "x", from: br ? br.rx - br.hw * 0.85 : W, to: bl ? bl.rx + bl.hw * 0.85 : 0, corner: br },
                { id: "left", axis: "y", from: bl ? bl.ry - bl.hh * 0.85 : H, to: tl && tl.rx - tl.hw < side * 1.3 ? tl.ry + tl.hh * 0.85 : side * 0.15, corner: bl }
            ];
            // Share the side glyphs out by run length, largest remainders first.
            var tot = 0, left = sq.length;
            segs.forEach(function (s) { s.len = Math.max(0, Math.abs(s.to - s.from)); tot += s.len; });
            segs.forEach(function (s) { s.n = Math.floor(sq.length * s.len / (tot || 1)); left -= s.n; s.rem = sq.length * s.len / (tot || 1) - s.n; });
            segs.slice().sort(function (a, b) { return b.rem - a.rem; }).forEach(function (s) { if (left > 0) { s.n++; left--; } });
            // Fewer, bigger: a run holds what fits with room between. Extras go where there is room left,
            // the columns first; the bottom run, which can bleed, takes what is still over.
            var bottomSeg = segs[2];
            segs.forEach(function (s) {
                s.cap = Math.max(0, Math.floor(s.len / (side * (s.id === "top" ? 1.6 : s.id === "bottom" ? 1.15 : 1.3))));
            });
            var extra = 0;
            segs.forEach(function (s) { if (s.n > s.cap) { extra += s.n - s.cap; s.n = s.cap; } });
            while (extra > 0) {
                var room = segs.filter(function (s) { return s.n < s.cap; })
                    .sort(function (a, b) { return (b.cap - b.n) / (b.cap || 1) - (a.cap - a.n) / (a.cap || 1); })[0] || bottomSeg;
                room.n++; extra--;
            }
            // Corner clients are obstacles for the columns too.
            var obst = all.concat([tl, tr].filter(Boolean).map(function (k) {
                return { l: k.rx - k.hw, r: k.rx + k.hw, t: k.ry - k.hh, b: k.ry + k.hh };
            }));
            segs.forEach(function (s) {
                var list = sq.splice(0, s.n);
                if (s.corner) order.push(s.corner);
                [].push.apply(order, list);
                run(list, s.axis, s.from, s.to, function (q, j) {
                    var jit = noise(q.i, 4);
                    if (s.id === "top") {
                        // Between the footer's top and the poster, whole: a glyph bleeding off the top would show
                        // the footer's edge as a flat cut while the page scrolls in.
                        var t = textCol(all, q.rx - q.hw - c, q.rx + q.hw + c)[0];
                        var lo = q.hh + 8, hi = (isFinite(t) ? t : l1.t) - c - FOCUS_ROOM - q.hh;
                        return hi < lo ? lo : lo + (hi - lo) * (0.6 + 0.35 * jit);
                    }
                    if (s.id === "bottom") {
                        // Under the address block, bleeding off the page's end by up to a third.
                        var b = textCol(all, q.rx - q.hw - c, q.rx + q.hw + c)[1];
                        var lo2 = (isFinite(b) ? b : textBot) + c + q.hh, hi2 = H - q.hh * 0.7;
                        return hi2 < lo2 ? lo2 : lo2 + (hi2 - lo2) * (0.55 + 0.35 * jit);
                    }
                    return 0;
                });
                if (s.axis === "y") list.forEach(function (q) {
                    // Columns: in the open paper between the text and the screen's edge, a little past it.
                    var sp = textSpan(obst, q.ry - q.hh - c, q.ry + q.hh + c), isL = s.id === "left";
                    var edge = isL ? q.hw * 0.7 : W - q.hw * 0.7;
                    var inner = isL ? (isFinite(sp[0]) ? sp[0] - c - q.hw : W / 2) : (isFinite(sp[1]) ? sp[1] + c + q.hw : W / 2);
                    var x = edge + (inner - edge) * (0.42 + 0.12 * noise(q.i, 5));
                    q.rx = isL ? Math.min(x, inner) : Math.max(x, inner);
                });
            });
        } else {
            // Phone: the footer is taller than the screen, so nothing bleeds off its top (a hard cut mid-scroll):
            // two clients hold the top corners, one bleeds off the bottom right; the rest go down the sides
            // where the text leaves room, then in staggered rows under the poster.
            if (tl) { tl.rx = tl.hw * (2 * EDGE - 1); tl.ry = tl.hh + 4; }
            if (tr) { tr.rx = W - tr.hw * (2 * EDGE - 1); tr.ry = tr.hh + 8; }
            var topList = [];
            var gap0 = (tr ? tr.rx - tr.hw : W) - (tl ? tl.rx + tl.hw : 0);
            while (sq.length && gap0 > (topList.length + 1) * side * 1.05) topList.push(sq.shift());
            run(topList, "x", tl ? tl.rx + tl.hw : 0, tr ? tr.rx - tr.hw : W, function (q) { return Math.min(q.hh + 6, top - c - q.hh); });
            if (tl) order.push(tl);
            [].push.apply(order, topList);
            if (tr) order.push(tr);
            // The round lander rests down the right side when there is room; the rest share both sides.
            var colTop = Math.max(tl ? tl.ry + tl.hh : 0, tr ? tr.ry + tr.hh : 0) + 14;
            var rightAll = (bl ? [bl] : []).concat(sq.filter(function (q, j) { return j % 2 === 1; }));
            var leftAll = sq.filter(function (q, j) { return j % 2 === 0; });
            var rest = column(rightAll.slice(), false, colTop, textBot, all, W)
                .concat(column(leftAll.slice(), true, colTop, textBot, all, W));
            var placed = function (q) { return rest.indexOf(q) < 0; };
            [].push.apply(order, rightAll.filter(placed));
            // Rows under the poster, smaller glyphs: the bottom-right client and two, then four, three, four...
            // A full row's ends bleed off the sides by the same share as the columns; the last row sits whole.
            var bottomList = (br ? [br] : []).concat(rest), rowsN = [], n = bottomList.length;
            rest.forEach(function (q) { setInk(q, side * 0.82 * (1 + 0.06 * noise(q.i, 1))); });
            for (var r0 = 0; n > 0; r0++) { var m = Math.min(n, r0 === 0 ? 3 : r0 % 2 ? 4 : 3); rowsN.push(m); n -= m; }
            var y = textBot + c + 8, at = 0;
            rowsN.forEach(function (m, r) {
                var row = bottomList.slice(at, at + m), full = m === (r === 0 ? 3 : r % 2 ? 4 : 3);
                var hh = Math.max.apply(null, row.map(function (q) { return q.hh; }));
                at += m;
                var a0 = row[0], a1 = row[row.length - 1];
                var x0 = full ? a0.hw * (2 * EDGE - 1) : W / (m + 1), x1 = full ? W - a1.hw * (2 * EDGE - 1) : W - W / (m + 1);
                row.forEach(function (q, j) {
                    q.rx = m > 1 ? x1 + (x0 - x1) * j / (m - 1) : W / 2;
                    q.ry = y + hh + q.hh * 0.12 * noise(q.i, 4);
                });
                y += hh * 2 + 12;
            });
            [].push.apply(order, bottomList);
            [].push.apply(order, leftAll.filter(placed).reverse());
            // The page ends under the last row, with room for a focused glyph's name.
            var posterBot = H - (parseFloat(stage.style.getPropertyValue("--ring-b")) || 0);
            var lastY = Math.max.apply(null, bottomList.map(function (q) { return q.ry + q.hh; }).concat([textBot + c])) + FOCUS_ROOM;
            var nb = Math.max(Math.round(side * 0.5), Math.round(lastY - posterBot));
            stage.style.setProperty("--ring-b", nb + "px");
            H = g.H = posterBot + nb;
        }
        // Last guard: no resting glyph touches a line of the poster.
        G.forEach(function (q) { clearText(q, pad, W, narrow, W / 2); });

        ORDER = order.filter(function (q, j) { return order.indexOf(q) === j; });
        G.forEach(function (q) { if (ORDER.indexOf(q) < 0) ORDER.push(q); });
        // Tab order follows the frame, clockwise from the top left.
        var ol = G[0].li.parentNode, same = ORDER.every(function (q, j) { return ol.children[j] === q.li; });
        if (!same) ORDER.forEach(function (q) { ol.append(q.li); });

        // Landers: two round clients, one after the other, on the ask's last line, then off to their places.
        var ln = askL[askL.length - 1];
        G.forEach(function (q) { q.lander = false; });
        (narrow ? [bl, tr] : [tl, tr]).filter(Boolean).forEach(function (q, k) {
            q.lander = true; q.k = k;
            q.big = Math.min(Math.max(q.ink, ln.h * 2.4), W * 0.62) * 100 / Math.max(q.iw, q.ih);
            var bh = q.big * q.ih / 200, bw = q.big * q.iw / 200;
            var sideL = narrow ? k === 0 : q.rx < W / 2;
            q.lx = clamp(sideL ? ln.l + bw * 0.25 : ln.r - bw * 0.25, bw * 0.6, W - bw * 0.6);
            q.ly = Math.min(ln.cy, reachTop - c - bh);
        });
        // Pops run outward from the top centre down both sides at once.
        var others = G.filter(function (q) { return !q.lander; });
        others.forEach(function (q) { q.ang = Math.abs(Math.atan2(q.rx - W / 2, -(q.ry - H / 2))); });
        others.sort(function (a, b) { return a.ang - b.ang; }).forEach(function (q, k) { q.k = k; });
        G.forEach(function (q) {
            q.start = q.lander ? q.k * STAG : RING0 + q.k * RSTAG;
            q.dur = q.lander ? HOLD + GLIDE : POP;
            q.box = Math.max(q.base, q.lander ? q.big : 0);
        });
        var was = END && t >= END;
        END = Math.max.apply(null, G.map(function (q) { return q.start + q.dur; }));
        if (was || reduce) t = END;

        g.dpr = Math.min(2, devicePixelRatio || 1);
        geo = g;
        G.forEach(function (q) {
            q.el.style.width = q.el.style.height = q.box.toFixed(1) + "px";
            // The name hangs under the ink, not the box: box and ink differ for wide or short glyphs.
            var k = q.base / q.box;
            q.el.style.setProperty("--fl", (50 + (q.il - 50) * k).toFixed(1) + "%");
            q.el.style.setProperty("--fw", ((q.ir - q.il) * k).toFixed(1) + "%");
            q.el.style.setProperty("--fb", (50 + (q.ib - 50) * k).toFixed(1) + "%");
            var px = Math.round(q.box * (1 + 2 * PAD) * g.dpr);
            if (q.canvas.width !== px) { q.canvas.width = q.canvas.height = px; q.drawn = ""; }
        });
    }

    // ── Drawing: XOR, so overlaps are holes, whole and mid-pull ────
    function draw(g) {
        var key = g.pieces.map(function (p) { return Math.round(p.x.x * 10) + "," + Math.round(p.y.x * 10); }).join(";");
        if (key === g.drawn) return;
        g.drawn = key;
        var c = g.ctx, px = g.canvas.width, k = px / (100 * (1 + 2 * PAD));
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, px, px);
        c.setTransform(k, 0, 0, k, PAD * 100 * k, PAD * 100 * k);
        c.globalCompositeOperation = "xor";
        c.fillStyle = INK;
        // Pieces at the same offset fill as one evenodd path: same parity, no seam.
        var groups = {};
        g.pieces.forEach(function (p, i) {
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

    // Pieces drift away from the pointer (or out from the centre, for focus).
    function pieceTargets(g, f) {
        var px = 50, py = 50;
        if (pointer && (g.hover || g.near > 0)) {
            var k = 100 / g.size;
            px = clamp(50 + (pointer.x - g.cx) * k, -40, 140);
            py = clamp(50 + (pointer.y - g.cy) * k, -40, 140);
        }
        return g.pieces.map(function (p) {
            if (f < 0.001) return [0, 0];
            var ux = p.cx - px + 0.35 * (p.cx - 50), uy = p.cy - py + 0.35 * (p.cy - 50);
            var len = Math.hypot(ux, uy);
            if (len < 1) { ux = Math.cos(p.angle); uy = Math.sin(p.angle); len = 1; }
            var m = PULL * f * p.weight;
            return [ux / len * m, uy / len * m];
        });
    }

    // ── Timeline: t runs forward on arrival and backward on departure ──
    var t = 0, dir = 0, pointer = null;
    var raf = 0, last = 0, onScreen = false;

    function kick() { if (!raf && onScreen) raf = requestAnimationFrame(tick); }

    function tick(now) {
        raf = 0;
        if (!geo) return;
        var dt = Math.min(50, now - (last || now)) || 16.667;
        last = now;
        var dtn = dt / 16.667;
        var busy = false;
        if (!reduce && dir) {
            t = clamp(t + dt * dir * (dir < 0 ? LEAVE : 1), 0, END);
            if ((dir > 0 && t < END) || (dir < 0 && t > 0)) busy = true; else dir = 0;
        }
        G.forEach(function (g) {
            // Positions are ink centres; the box centre is offset by where the ink sits in the glyph's frame.
            var x = g.rx, y = g.ry, size = g.base, rot = g.rot;
            var e = t - g.start, sc = 1;
            if (!g.lander) {
                sc = e <= 0 ? 0 : popIn(Math.min(1, e / POP));
            } else if (e < HOLD + GLIDE) {
                var f = e < HOLD ? 1 : 1 - easeInOut((e - HOLD) / GLIDE);
                x += (g.lx - x) * f;
                y += (g.ly - y) * f;
                size += (g.big - size) * f;
                rot *= 1 - f;
                sc = e <= 0 ? 0 : popIn(Math.min(1, e / POP));
            }
            var near = 0;
            if (pointer && !reduce) {
                var d = Math.hypot(pointer.x - x, pointer.y - y);
                near = clamp(1 - d / (g.ink * 1.1), 0, 1);
            }
            g.near = near;
            var goalPull = g.focus ? FOCUS_PULL : g.hover ? 1 : near * 0.55;
            // Pointing nudges the glyph away a little, like a magnet of the same pole.
            var gx = 0, gy = 0;
            if (pointer && near > 0 && !g.hover && !reduce) {
                var dx = x - pointer.x, dy = y - pointer.y, dl = Math.hypot(dx, dy) || 1;
                gx = dx / dl * near * g.ink * 0.14;
                gy = dy / dl * near * g.ink * 0.14;
            }
            // Focus brings a bleeding glyph, and its name, fully onto the screen.
            if (g.focus) {
                var m = 10;
                gx = Math.max(0, m - (x - g.hw)) - Math.max(0, x + g.hw - (geo.W - m));
                gy = Math.max(0, m - (y - g.hh)) - Math.max(0, y + g.hh + FOCUS_ROOM - (geo.H - m));
            }
            if (reduce) {
                g.ox.x = gx; g.oy.x = gy; g.pull.x = goalPull; g.ox.v = g.oy.v = g.pull.v = 0;
            } else {
                spring(g.ox, gx, dtn, 0.09, 0.78);
                spring(g.oy, gy, dtn, 0.09, 0.78);
                spring(g.pull, goalPull, dtn, 0.1, 0.78);
                if (Math.abs(g.ox.v) + Math.abs(g.oy.v) + Math.abs(g.pull.v) > 0.002 ||
                    Math.abs(g.ox.x - gx) + Math.abs(g.oy.x - gy) > 0.05 || Math.abs(g.pull.x - goalPull) > 0.005) busy = true;
            }
            x += g.ox.x; y += g.oy.x;
            size *= Math.max(0, sc);
            g.cx = x; g.cy = y; g.size = Math.max(1, size);
            // Box centre from the ink centre, the offset turned with the glyph.
            var a = rot * Math.PI / 180, ox = (50 - g.icx) / 100 * size, oy = (50 - g.icy) / 100 * size;
            var bx = x + ox * Math.cos(a) - oy * Math.sin(a), by = y + ox * Math.sin(a) + oy * Math.cos(a);
            var s = size / g.box;
            g.el.style.setProperty("--s", Math.max(0.05, s).toFixed(3));
            g.el.style.setProperty("--r", rot.toFixed(2) + "deg");
            g.el.style.transform = "translate3d(" + (bx - g.box / 2).toFixed(1) + "px," + (by - g.box / 2).toFixed(1) + "px,0) rotate(" + rot.toFixed(2) + "deg) scale(" + Math.max(0, s).toFixed(4) + ")";
            // Settled glyphs take the pointer; arriving ones don't, so a pass over the ask never catches one.
            var settled = e >= g.dur;
            g.el.style.pointerEvents = settled ? "" : "none";
            g.el.style.zIndex = g.hover || g.focus ? "2" : "";

            var tg = pieceTargets(g, Math.max(0, g.pull.x));
            g.pieces.forEach(function (p, i) {
                if (reduce) { p.x.x = tg[i][0]; p.y.x = tg[i][1]; return; }
                spring(p.x, tg[i][0], dtn, 0.16, 0.74);
                spring(p.y, tg[i][1], dtn, 0.16, 0.74);
                if (Math.abs(p.x.v) + Math.abs(p.y.v) + Math.abs(p.x.x - tg[i][0]) + Math.abs(p.y.x - tg[i][1]) > 0.02) busy = true;
            });
            draw(g);
        });

        if (busy && !reduce) kick();
    }

    // ── Input ───────────────────────────────────────────────────
    G.forEach(function (g) {
        g.el.addEventListener("pointerenter", function (e) {
            if (e.pointerType !== "mouse") return;
            g.hover = true; kick();
        });
        g.el.addEventListener("pointerleave", function () { g.hover = false; kick(); });
        g.el.addEventListener("focus", function () {
            if (!g.el.matches(":focus-visible")) return;
            // Keyboard focus lands on a glyph that may not have arrived yet: bring the frame in at once.
            if (t < END && !reduce) { t = END; dir = 0; }
            g.focus = true; kick();
        });
        g.el.addEventListener("blur", function () { g.focus = false; kick(); });
    });
    foot.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var fr = foot.getBoundingClientRect();
        pointer = { x: e.clientX - fr.left, y: e.clientY - fr.top };
        kick();
    });
    foot.addEventListener("pointerleave", function () { pointer = null; kick(); });

    // Arrive when most of the ask is in view, or once it has passed above (a jump to the page's end);
    // leave (backwards, into the ask) once it is nearly gone below.
    new IntersectionObserver(function (es) {
        var en = es[0];
        var above = !en.isIntersecting && en.boundingClientRect.bottom <= 0;
        if ((en.intersectionRatio >= 0.4 || above) && !reduce) { if (t < END) dir = 1; }
        else if (en.intersectionRatio < 0.15 && en.boundingClientRect.top > 0 && !reduce) { if (t > 0) dir = -1; }
        kick();
    }, { threshold: [0, 0.15, 0.4] }).observe(ask);

    new IntersectionObserver(function (es) {
        onScreen = es[0].isIntersecting;
        // A jump past the ask never crosses its thresholds: arrive anyway.
        if (onScreen && !reduce && t < END && ask.getBoundingClientRect().bottom <= 0) dir = 1;
        if (onScreen) { last = 0; kick(); }
    }).observe(foot);

    var resizeT = 0, lastW = 0;
    window.addEventListener("resize", function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(function () {
            // A phone's toolbar showing or hiding changes the height only: keep the frame.
            if (geo && geo.narrow && innerWidth === lastW) return;
            lastW = innerWidth;
            measure(); kick();
        }, 120);
    });
    reduceMQ.addEventListener("change", function () {
        reduce = reduceMQ.matches;
        t = END; dir = 0;
        measure(); kick();
    });

    function start() { lastW = innerWidth; measure(); kick(); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
