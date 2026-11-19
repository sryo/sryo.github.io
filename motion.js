// Portfolio motion: parity pull on the spec glyph, flow pulse on diagrams.
(function () {
    "use strict";

    var reduce = matchMedia("(prefers-reduced-motion: reduce)");
    var finePointer = matchMedia("(hover: hover) and (pointer: fine)");

    function accent() {
        return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#E94136";
    }

    // Frame-rate independent spring step.
    function spring(s, target, dtn, k, damp) {
        s.v += (target - s.x) * k * dtn;
        s.v *= Math.pow(damp, dtn);
        s.x += s.v * dtn;
    }

    // ── Parity pull ─────────────────────────────────────────────
    // Pieces are filled with "xor" compositing so any overlap is a hole, as
    // fill-rule="evenodd" draws the glyph at rest. The canvas waits for an
    // arriving view transition to end and is gone before the page swaps, so
    // the glyph's flight never shows it.

    var REACH = 1.5;
    var PULL = 9;
    var PAD = 0.25;

    // A <path> primitive may hold several subpaths; they fill nonzero, so
    // they stay one solid piece.
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
                return "M" + (el.getAttribute("points") || "").trim().split(/\s+/).join("L") + "Z";
            case "path":
                return el.getAttribute("d") || "";
        }
        return "";
    }

    // Without parts, each absolute subpath of the glyph is a piece. A path
    // with relative commands can't be split safely, so it stays one piece;
    // a glyph with transforms gets no pull at all.
    function glyphPieces(img, parts) {
        var pieces = [], doc, svg;
        if (parts) {
            doc = new DOMParser().parseFromString(atob(parts), "image/svg+xml");
            svg = doc.querySelector("svg");
            if (!svg || doc.querySelector("[transform]")) return null;
            Array.prototype.forEach.call(svg.children, function (el) {
                var d = primitivePath(el);
                if (d) pieces.push({ d: d, path: new Path2D(d) });
            });
        } else {
            var m = /^data:image\/svg\+xml;base64,(.*)$/.exec(img.getAttribute("src") || "");
            if (!m) return null;
            doc = new DOMParser().parseFromString(atob(m[1]), "image/svg+xml");
            svg = doc.querySelector("svg");
            if (!svg || doc.querySelector("[transform]")) return null;
            doc.querySelectorAll("path").forEach(function (p) {
                var d = (p.getAttribute("d") || "").trim();
                var subs = /[a-z]/.test(d.replace(/e/g, "")) ? [d] : d.split(/(?=M)/);
                subs.forEach(function (sub) { if (sub.trim()) pieces.push({ d: sub, path: new Path2D(sub) }); });
            });
        }
        var vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/[\s,]+/).map(Number);
        if (pieces.length < 2) return null;
        // A piece of several subpaths fills nonzero on its own; one-subpath
        // pieces may share a fill (see draw).
        pieces.forEach(function (pc) { pc.solo = (pc.d.match(/[Mm]/g) || []).length > 1; });
        // Each piece's centroid and area, read from a small raster.
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
        var pointer = null, engaged = false, tapUntil = 0, ink = "#000";

        function flying() { return document.documentElement.hasAttribute("data-vt"); }

        function ensure() {
            if (canvas) return true;
            if (flying()) return false;
            if (model === null) model = glyphPieces(img, glyph.getAttribute("data-parts")) || false;
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

        function draw() {
            var s = size(), vb = model.vb, k = s.w / vb[2];
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(k * s.dpr, 0, 0, k * s.dpr, (s.pad - vb[0] * k) * s.dpr, (s.pad - vb[1] * k) * s.dpr);
            ctx.globalCompositeOperation = "xor";
            ctx.fillStyle = ink;
            // Pieces sitting at the same offset fill as one evenodd path:
            // same parity as XOR, without the half-alpha seam XOR leaves
            // on an edge two pieces share (a dome on its base, a sector on
            // its ring). Offsets match to 0.01 units, well under a pixel.
            var groups = {};
            model.pieces.forEach(function (p, i) {
                var key = p.solo ? "s" + i : Math.round(p.x.x * 100) + "," + Math.round(p.y.x * 100);
                var g = groups[key] || (groups[key] = { x: p.x.x, y: p.y.x, path: new Path2D(), rule: p.solo ? "nonzero" : "evenodd" });
                g.path.addPath(p.path);
            });
            Object.keys(groups).forEach(function (key) {
                var g = groups[key];
                ctx.save();
                ctx.translate(g.x, g.y);
                ctx.fill(g.path, g.rule);
                ctx.restore();
            });
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
                canvas.style.display = "none";
                img.style.opacity = "";
                last = 0;
                return;
            }
            canvas.style.display = "block";
            img.style.opacity = "0";
            draw();
            raf = requestAnimationFrame(tick);
        }

        function wake() {
            if (!ensure()) return;
            // Re-read on every wake: the colour scheme can change mid-motion.
            ink = getComputedStyle(img).filter.indexOf("invert") >= 0 ? "#fff" : "#000";
            if (!raf) {
                last = 0;
                raf = requestAnimationFrame(tick);
            }
        }

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

        // Touch and pen have no hover, so a tap plays one out-and-back.
        glyph.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse" || reduce.matches) return;
            pointer = { x: e.clientX, y: e.clientY };
            tapUntil = performance.now() + 350;
            wake();
        });

        window.addEventListener("pageswap", teardown);
        window.addEventListener("pagehide", teardown);
    }

    // ── Flow pulse ──────────────────────────────────────────────
    // The graph is read from the SVG: rects and circles are nodes, stroked
    // paths are edges, and a path that starts mid-line branches off that
    // line. The pulse draws on a canvas over it; the SVG is untouched.

    var SPEED = 0.26;
    var TAIL = 28;
    var FLASH = 600;

    function readGraph(svg) {
        var nodes = [], edges = [];
        svg.querySelectorAll("rect, circle").forEach(function (el) {
            if (el.closest("defs, marker")) return;
            var b = el.getBBox();
            nodes.push({ el: el, x: b.x, y: b.y, w: b.width, h: b.height, round: el.tagName === "circle", out: [] });
        });
        svg.querySelectorAll("path").forEach(function (el) {
            if (el.closest("defs, marker") || getComputedStyle(el).stroke === "none") return;
            var len = el.getTotalLength();
            if (len < 1) return;
            edges.push({ el: el, len: len, a: el.getPointAtLength(0), b: el.getPointAtLength(len) });
        });
        function nodeAt(p, pad) {
            var best = null;
            nodes.forEach(function (n) {
                if (p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad
                    && (!best || n.w * n.h < best.w * best.h)) best = n;
            });
            return best;
        }
        edges.forEach(function (e) {
            e.from = nodeAt(e.a, 4);
            e.to = nodeAt(e.b, 12);
            if (e.from === e.to) e.to = null;
        });
        edges.forEach(function (e) {
            if (e.from) return;
            edges.some(function (o) {
                if (o === e) return false;
                for (var l = 0; l <= o.len; l += 2) {
                    var q = o.el.getPointAtLength(l);
                    if (Math.abs(q.x - e.a.x) + Math.abs(q.y - e.a.y) < 2) { e.parent = o; e.at = l; return true; }
                }
                return false;
            });
        });
        edges.forEach(function (e) { if (e.from) e.from.out.push(e); });
        return { nodes: nodes, edges: edges };
    }

    // When each edge starts and each node is reached, from `sources` at 0.
    function schedule(graph, sources) {
        var t = new Map(), start = new Map(), changed = true, guard = 0;
        sources.forEach(function (n) { t.set(n, 0); });
        while (changed && guard++ < 50) {
            changed = false;
            graph.edges.forEach(function (e) {
                var s = e.from ? t.get(e.from) : e.parent && start.has(e.parent) ? start.get(e.parent) + e.at / SPEED : undefined;
                if (s === undefined || (start.has(e) && start.get(e) <= s)) return;
                start.set(e, s);
                changed = true;
                if (e.to) {
                    var arrive = s + e.len / SPEED;
                    if (!t.has(e.to) || t.get(e.to) > arrive) t.set(e.to, arrive);
                }
            });
        }
        var end = 0;
        start.forEach(function (s, e) { end = Math.max(end, s + (e.len + TAIL) / SPEED); });
        t.forEach(function (a) { end = Math.max(end, a + FLASH); });
        return { nodes: t, edges: start, end: end };
    }

    function flowPulse(fig) {
        var svg = fig.querySelector(":scope > svg");
        if (!svg || fig.hasAttribute("data-toy") || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) return;
        var graph = null, canvas = null, ctx = null, runs = [], raf = 0, hovered = null;

        function ensure() {
            if (!graph) graph = readGraph(svg);
            if (!canvas) {
                canvas = document.createElement("canvas");
                canvas.className = "pulse";
                canvas.setAttribute("aria-hidden", "true");
                canvas.style.cssText = "position:absolute;pointer-events:none";
                svg.after(canvas);
                ctx = canvas.getContext("2d", { willReadFrequently: true });
            }
        }

        function fire(sources) {
            ensure();
            if (!sources) {
                var incoming = new Set();
                graph.edges.forEach(function (e) { if (e.to) incoming.add(e.to); });
                sources = graph.nodes.filter(function (n) { return n.out.length && !incoming.has(n); });
                if (!sources.length) sources = graph.nodes.slice(0, 1);
            }
            if (!sources.length) return;
            runs.push({ t0: performance.now(), plan: schedule(graph, sources) });
            if (!raf) raf = requestAnimationFrame(tick);
        }

        function segment(e, from, to) {
            ctx.beginPath();
            for (var l = from, first = true; ; l = Math.min(to, l + 4)) {
                var p = e.el.getPointAtLength(l);
                if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
                if (l >= to) break;
            }
            ctx.stroke();
        }

        function tick(now) {
            raf = 0;
            var vb = svg.viewBox.baseVal, w = svg.clientWidth, k = w / vb.width, dpr = Math.min(2, devicePixelRatio || 1);
            var px = Math.round(w * dpr), py = Math.round(svg.clientHeight * dpr);
            if (canvas.width !== px || canvas.height !== py) { canvas.width = px; canvas.height = py; }
            // SVG elements have no offsetLeft/Top, so place the canvas from
            // the boxes, adding the figure's scroll (it scrolls on phones).
            var sb = svg.getBoundingClientRect(), fb = fig.getBoundingClientRect();
            canvas.style.left = sb.left - fb.left + fig.scrollLeft + "px";
            canvas.style.top = sb.top - fb.top + fig.scrollTop + "px";
            canvas.style.width = w + "px";
            canvas.style.height = svg.clientHeight + "px";
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, px, py);
            runs = runs.filter(function (r) { return now - r.t0 < r.plan.end; });
            if (!runs.length) return;
            ctx.setTransform(k * dpr, 0, 0, k * dpr, -vb.x * k * dpr, -vb.y * k * dpr);
            ctx.strokeStyle = accent();
            ctx.lineWidth = 2 / k;
            runs.forEach(function (r) {
                var el = now - r.t0;
                r.plan.edges.forEach(function (s, e) {
                    var head = (el - s) * SPEED;
                    if (head <= 0 || head - TAIL >= e.len) return;
                    ctx.globalAlpha = 1;
                    segment(e, Math.max(0, head - TAIL), Math.min(e.len, head));
                });
                r.plan.nodes.forEach(function (a, n) {
                    var since = el - a;
                    if (since < 0 || since > FLASH || a === 0) return;
                    ctx.globalAlpha = 1 - since / FLASH;
                    ctx.beginPath();
                    if (n.round) ctx.arc(n.x + n.w / 2, n.y + n.h / 2, n.w / 2, 0, Math.PI * 2);
                    else ctx.rect(n.x, n.y, n.w, n.h);
                    ctx.stroke();
                });
            });
            ctx.globalAlpha = 1;
            raf = requestAnimationFrame(tick);
        }

        function nodeUnder(e) {
            var m = svg.getScreenCTM();
            if (!m || !graph) return null;
            var p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
            for (var i = 0; i < graph.nodes.length; i++) {
                var n = graph.nodes[i];
                if (p.x >= n.x - 4 && p.x <= n.x + n.w + 4 && p.y >= n.y - 4 && p.y <= n.y + n.h + 4) return n;
            }
            return null;
        }

        function poke(e) {
            if (reduce.matches) return;
            ensure();
            var n = nodeUnder(e);
            if (n !== hovered && n && n.out.length) fire([n]);
            hovered = n;
        }
        svg.addEventListener("pointermove", function (e) { if (e.pointerType === "mouse") poke(e); });
        svg.addEventListener("pointerleave", function () { hovered = null; });
        svg.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") { hovered = null; poke(e); } });

        // Phones scroll the figure sideways: start once 60% of it is in view.
        new IntersectionObserver(function (entries, io) {
            if (!entries.some(function (en) { return en.isIntersecting; })) return;
            io.disconnect();
            if (!reduce.matches) fire(null);
        }, { threshold: 0.6 }).observe(fig);
    }

    function start() {
        if (reduce.matches) return;
        document.querySelectorAll(".spec .glyph").forEach(parityPull);
        document.querySelectorAll("main figure.diagram").forEach(flowPulse);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
