// Front page: the open offer's proof glyphs build from their primitives, breathe, and break apart on a switch.
(function () {
    "use strict";

    var sec = document.querySelector(".offers");
    var src = sec && sec.querySelector("template.glyph-src");
    if (!sec) return;

    var ARRIVE_MS = 640;
    var LEAVE_MS = 420;
    var ARRIVE_AFTER = 250; // on a switch, arrivals start once the leavers are mostly clear
    var STAGGER = 70;
    var SCATTER_IN = 34;
    var SCATTER_OUT = 30;
    var SNAP_PX = 0.25;
    var SMALL = 24;
    var PULL = 30;
    var BREATH = 16;
    var BREATH_STAGGER = 140;
    var BREATH_OUT = 650, BREATH_HOLD = 700, BREATH_BACK = 650;
    var BREATH_EVERY = 6400;
    var BREATH_FIRST = 2600;
    var FIRST_TOUR_MS = 7000;
    var CYCLE_MS = 6000;
    var DWELL_MS = 110;
    var SEC = 0.58; // secondary glyph size, as a share of the lead glyph
    var SVGNS = "http://www.w3.org/2000/svg";

    var thesis = document.querySelector(".front .thesis");
    var stage = sec.querySelector(".stage");
    var offers = [].slice.call(sec.querySelectorAll(".offer"));
    var reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
    var wideMQ = matchMedia("(min-width: 900px)");

    function S(x) { return { x: x, v: 0 }; }
    function spring(s, t, dtn, k, damp) {
        s.v += (t - s.x) * k * dtn;
        s.v *= Math.pow(damp, dtn);
        s.x += s.v * dtn;
    }
    function clamp01(u) { return u < 0 ? 0 : u > 1 ? 1 : u; }
    // Zero velocity at both ends and peak speed a third of the way in
    // (derivative 12u(1-u)^2): a part sets off briskly but never jolts.
    function burst(u) { u = clamp01(u); var v = 1 - u; return 1 - v * v * v * (1 + 3 * u); }
    function smooth(u) { u = clamp01(u); return u * u * (3 - 2 * u); }

    offers.forEach(function (o) {
        var h = o.querySelector(".kicker"), d = o.querySelector(".detail");
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-controls", d.id);
        b.appendChild(h.querySelector(".t"));
        var pm = document.createElement("span");
        pm.className = "pm";
        pm.setAttribute("aria-hidden", "true");
        b.appendChild(pm);
        h.appendChild(b);
        // The proof sentence carries the case links; the glyphs repeat them for the pointer.
        o.querySelector(".room").setAttribute("aria-hidden", "true");
    });

    function svgOf(b64) {
        var bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
        var svg = doc.querySelector("svg");
        return svg && !doc.querySelector("parsererror") ? svg : null;
    }
    function shapes(svg) {
        return [].filter.call(svg.children, function (el) {
            return /^(path|circle|ellipse|rect|polygon)$/.test(el.localName);
        });
    }
    var SRC = {};
    if (src) [].forEach.call(src.content.querySelectorAll("i[data-slug]"), function (i) {
        var whole = i.dataset.glyph && svgOf(i.dataset.glyph);
        if (!whole) return;
        var parts = i.dataset.parts && svgOf(i.dataset.parts);
        SRC[i.dataset.slug] = {
            label: i.dataset.label,
            vb: whole.getAttribute("viewBox") || "0 0 100 100",
            whole: shapes(whole),
            parts: parts && shapes(parts).length > 1 ? shapes(parts) : null
        };
    });

    function shapeSvg(vb, els) {
        var svg = document.createElementNS(SVGNS, "svg");
        svg.setAttribute("viewBox", vb);
        els.forEach(function (el) {
            var c = document.importNode(el, true);
            c.removeAttribute("fill");
            svg.appendChild(c);
        });
        return svg;
    }

    var inst = [];
    offers.forEach(function (o, i) {
        var keys = (o.dataset.proof || "").split(" ").filter(function (k) { return SRC[k]; });
        keys.forEach(function (key, j) {
            var s = SRC[key];
            var el = document.createElement("a");
            el.className = "gl off";
            el.href = "work/" + key + "/";
            el.setAttribute("aria-label", s.label + " case");
            el.tabIndex = -1;
            var parts = (s.parts || s.whole.length && [null] || []).map(function (prim) {
                var svg = shapeSvg(s.vb, prim ? [prim] : s.whole);
                el.appendChild(svg);
                return { svg: svg, cx: 50, cy: 50, bx: 0, bw: 100, by: 0, bh: 100, sx: 0, sy: 0, rx: 0, ry: 0,
                    px: S(0), py: S(0), ox: 0, oy: 0, s: 1 };
            });
            var whole = shapeSvg(s.vb, s.whole);
            el.appendChild(whole);
            inst.push({ offer: i, j: j, n: keys.length, key: key, el: el, parts: parts, whole: whole,
                split: null, shown: false, measured: false,
                X: S(0), Y: S(0), Z: S(100), t: { x: 0, y: 0, s: 100 },
                on: false, life: 0, from: 0, to: 0, t0: 0, dur: 1, br0: -1, hOff: 0, hSc: 0 });
        });
    });

    function home(g) {
        return wideMQ.matches ? stage : offers[g.offer].querySelector(".room");
    }
    function mount() {
        inst.forEach(function (g) {
            var h = home(g);
            if (g.el.parentNode !== h) h.appendChild(g.el);
        });
    }

    function measureParts(g) {
        if (g.measured) return;
        var ok = true;
        g.parts.forEach(function (p, k) {
            var b = null;
            try { b = p.svg.firstElementChild.getBBox(); } catch (e) {}
            if (!b || !(b.width || b.height)) { ok = false; return; }
            p.cx = b.x + b.width / 2;
            p.cy = b.y + b.height / 2;
            p.bx = b.x;
            p.bw = b.width;
            p.by = b.y;
            p.bh = b.height;
            // The <svg> box is 100 CSS px, so viewBox units work as px here.
            p.svg.style.transformOrigin = p.cx + "px " + p.cy + "px";
            // Scatter outward from the glyph's middle, fanned so stacked parts separate.
            var a = Math.atan2(p.cy - 50, p.cx - 50) + ((k * 0.618) % 1 - 0.5) * 1.2 + k * 0.7;
            // Small parts don't fly: a scatter of dots and dashes reads as debris.
            var m = Math.max(b.width, b.height) < SMALL ? 0 : 0.8 + ((k * 0.382) % 1) * 0.4;
            p.sx = Math.cos(a) * m;
            p.sy = Math.sin(a) * m;
            var rx = p.cx - 50, ry = p.cy - 50, rd = Math.hypot(rx, ry);
            p.rx = rd > 4 ? rx / rd : 0;
            p.ry = rd > 4 ? ry / rd : 0;
        });
        g.measured = ok;
    }

    var active = -1;
    var area = null;
    var minLeft = 0;
    var pointer = null;
    var touched = false;
    var visible = true;
    var ready = false;

    function linesOf(el) {
        var range = document.createRange(), rows = [];
        range.selectNodeContents(el);
        [].forEach.call(range.getClientRects(), function (c) {
            if (!c.width) return;
            var row = rows.filter(function (r) { return Math.abs(r.top - c.top) < c.height / 2; })[0];
            if (!row) rows.push(row = { top: c.top, left: c.left, right: c.right });
            row.left = Math.min(row.left, c.left);
            row.right = Math.max(row.right, c.right);
        });
        return rows;
    }

    // A new size can move the line break, so fit, read the lines again and repeat.
    // Reading an untouched clone keeps transforms and earlier fits out of it.
    function fitThesis() {
        if (!thesis) return;
        if (!wideMQ.matches) { thesis.style.fontSize = ""; return; }
        var w = thesis.clientWidth, size = 80;
        var probe = thesis.cloneNode(true);
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;transform:none;animation:none;padding:0;box-sizing:border-box;width:" + w + "px";
        thesis.parentNode.appendChild(probe);
        for (var i = 0; i < 10; i++) {
            probe.style.fontSize = size + "px";
            var rows = linesOf(probe);
            var widest = Math.max.apply(null, rows.map(function (r) { return r.right - r.left; }));
            var next = rows.length > 2 ? size * 0.94 : Math.min(124, size * w / widest * 0.995);
            if (rows.length <= 2 && Math.abs(next - size) < 0.5) break;
            size = next;
        }
        probe.remove();
        thesis.style.fontSize = size + "px";
    }

    // Read once per layout change, never per frame: wide layout doesn't reflow on hover.
    function measure() {
        if (!wideMQ.matches) { area = null; return; }
        var sr = stage.getBoundingClientRect();
        // The titles' height, not the stage's: a tall cluster may grow the
        // stage (its spare last row), which must not feed back into its size.
        var list = offers[offers.length - 1].querySelector(".kicker").getBoundingClientRect().bottom - sr.top;
        var bottoms = offers.map(function (o) {
            return list - o.querySelector(".detail").getBoundingClientRect().height - 24;
        });
        var top = 0;
        if (thesis) {
            var tr = thesis.getBoundingClientRect(), cs = getComputedStyle(thesis);
            top = tr.bottom - parseFloat(cs.paddingBottom) + 0.14 * parseFloat(cs.fontSize) - sr.top;
        }
        // Short screens keep the glyphs at poster size rather than shrinking
        // them to icons, but each offer's floor still leaves its sentence and
        // case links on the first screen.
        var cap = Math.min(0.55 * sr.width, 280), pageTop = sr.top + scrollY + top;
        var rooms = offers.map(function (o) {
            return Math.max(160, innerHeight - pageTop - o.querySelector(".detail").getBoundingClientRect().height - 24 - 32);
        });
        area = { left: 0, top: top, w: sr.width, bottoms: bottoms, floor: [], cap: cap, rooms: rooms };
        minLeft = -0.5 * parseFloat(getComputedStyle(sec).columnGap || 0);
    }

    // Two secondaries stack in one column, so they get smaller and the lead gets the room.
    // A lone secondary takes the width a short (height-bound) lead leaves, up to 0.8 of it.
    function cluster(n, a) {
        var gapK = 0.07;
        var G = Math.min(a.h, a.w / (n > 1 ? 1 + gapK + SEC : 1));
        if (n > 2) G = Math.min(a.h, a.w / (1 + gapK + 1 / 2.08));
        G = Math.min(Math.max(G, a.min || 0), a.max || Infinity);
        var s = Math.max(G * SEC, Math.min(0.8 * G, a.w - G * (1 + gapK)));
        if (n > 2) s = Math.min(G / 2.08, a.w - G * (1 + gapK));
        var bottom = a.top + G;
        var out = [{ x: a.left + G / 2, y: bottom - G / 2, s: G }];
        var x2 = a.left + G * (1 + gapK) + s / 2;
        if (n > 1) out.push({ x: x2, y: bottom - s / 2, s: s });
        if (n > 2) out.push({ x: x2, y: bottom - s * 1.58, s: s });
        return out;
    }

    function targets() {
        inst.forEach(function (g) {
            var a;
            if (area) a = { left: area.left, top: area.top, w: area.w, h: Math.max(80, area.bottoms[g.offer] - area.top), min: Math.min(area.cap, area.rooms[g.offer]), max: area.rooms[g.offer] };
            else {
                var r = home(g);
                a = { left: 0, top: 0, w: r.clientWidth, h: r.clientHeight };
            }
            g.t = cluster(g.n, a)[g.j];
        });
        // Each sentence hangs right under its own cluster, so a short cluster
        // leaves no gap between the glyphs and their words.
        offers.forEach(function (o, i) {
            var d = o.querySelector(".detail"), lead = null;
            inst.forEach(function (g) { if (g.offer === i && g.j === 0) lead = g; });
            d.style.marginTop = area && lead ? Math.max(0, lead.t.y + lead.t.s / 2 + 24) + "px" : "";
            if (area) area.floor[i] = lead ? lead.t.y + lead.t.s / 2 + 12 : Infinity;
        });
        // A cluster held at its poster size reaches below area.bottoms, so
        // the pointer band is measured from the glyphs themselves.
        if (area) {
            area.rise = area.top; area.reach = Math.max.apply(null, area.bottoms);
            inst.forEach(function (g) {
                area.rise = Math.min(area.rise, g.t.y - g.t.s / 2);
                area.reach = Math.max(area.reach, g.t.y + g.t.s / 2);
            });
        }
        sec.classList.toggle("hung", !!area);
    }

    // Life: 0 is scattered and gone, 1 is assembled.
    function lifeAt(g, now) {
        if (now <= g.t0) return g.from;
        var u = clamp01((now - g.t0) / g.dur);
        return g.from + (g.to - g.from) * u;
    }
    function tween(g, to, delay, now) {
        var was = scatterAt(g, now);
        var cur = lifeAt(g, now);
        g.from = cur;
        g.to = to;
        g.t0 = now + delay;
        g.dur = Math.max(1, Math.abs(to - cur) * (to ? ARRIVE_MS : LEAVE_MS));
        // A switch mid-flight changes curves: carry the gap and ease it out
        // over the new tween, so no part jumps at the handover.
        g.hOff = g.hSc = 0;
        var is = scatterAt(g, now);
        g.hOff = was.off - is.off;
        g.hSc = was.sc - is.sc;
    }

    function scatterAt(g, now) {
        var life = lifeAt(g, now), off, sc;
        if (g.to === 1) {
            off = SCATTER_IN * (1 - burst(life));
            sc = burst(life / 0.5);
        } else {
            var l = 1 - life;
            off = SCATTER_OUT * burst(l);
            sc = 1 - l * l * l;
        }
        var keep = 1 - smooth((now - g.t0) / g.dur);
        return { off: off + g.hOff * keep, sc: clamp01(sc + g.hSc * keep) };
    }

    function setActive(i, quiet) {
        if (i === active) return;
        var prev = active;
        active = i;
        offers.forEach(function (o, n) {
            o.classList.toggle("on", n === i);
        });
        states();
        if (!ready) return;
        var now = performance.now();
        inst.forEach(function (g) {
            var on = g.offer === i;
            if (on === g.on) return;
            g.on = on;
            g.br0 = -1;
            tween(g, on ? 1 : 0, on ? (prev >= 0 && !quiet ? ARRIVE_AFTER : 0) + g.j * STAGGER : g.j * 40, now);
        });
        if (reduceMQ.matches) { snap(); return; }
        wake();
    }

    function render(g, now) {
        var z = Math.max(0.01, g.Z.x / 100);
        g.el.style.transform = "translate(" + (g.X.x - g.Z.x / 2).toFixed(2) + "px," +
            (g.Y.x - g.Z.x / 2).toFixed(2) + "px) scale(" + z.toFixed(4) + ")";
        var shown = g.life > 0;
        if (shown !== g.shown) { g.shown = shown; g.el.classList.toggle("off", !shown); }
        if (!shown) return;
        // Snapping tiny offsets to 0 puts a resting part exactly home, so the
        // whole can stand in. Curves and springs arrive at zero speed, so the
        // snap is always sub-pixel.
        var split = false, snap = SNAP_PX / Math.max(0.01, g.Z.x / 100);
        g.parts.forEach(function (p) {
            if (Math.hypot(p.ox, p.oy) < snap) { p.ox = 0; p.oy = 0; }
            if (p.ox || p.oy || p.s < 1) split = true;
        });
        // At rest the glyph's own evenodd path stands in: separate parts leave seams on shared edges.
        if (split !== g.split) {
            g.split = split;
            g.whole.style.display = split ? "none" : "";
            g.parts.forEach(function (p) { p.svg.style.display = split ? "" : "none"; });
        }
        if (split) g.parts.forEach(function (p) {
            p.svg.style.transform = "translate(" + p.ox.toFixed(2) + "px," + p.oy.toFixed(2) + "px) scale(" + p.s.toFixed(4) + ")";
        });
    }

    // Out fast so the parts clear the sliver band at once, then hold and back.
    function breathAt(g, now) {
        if (g.br0 < 0) return 0;
        var t = now - g.br0;
        if (t < 0) return 0;
        if (t < BREATH_OUT) return 1 - Math.pow(2, -10 * t / BREATH_OUT);
        t -= BREATH_OUT;
        if (t < BREATH_HOLD) return 1;
        t -= BREATH_HOLD;
        if (t < BREATH_BACK) { var u = t / BREATH_BACK; return 1 - u * u * u; }
        g.br0 = -1;
        return 0;
    }

    function snap() {
        var now = performance.now();
        inst.forEach(function (g) {
            g.X = S(g.t.x); g.Y = S(g.t.y); g.Z = S(g.t.s);
            g.from = g.to = g.life = g.on ? 1 : 0;
            g.t0 = now;
            g.br0 = -1;
            g.hOff = g.hSc = 0;
            g.parts.forEach(function (p) { p.px = S(0); p.py = S(0); p.ox = p.oy = 0; p.s = 1; });
            render(g, now);
        });
    }

    var raf = 0, lastT = 0;
    function wake() {
        if (!raf && ready && !reduceMQ.matches && visible && !document.hidden) {
            lastT = performance.now();
            raf = requestAnimationFrame(tick);
        }
    }
    function tick(now) {
        raf = 0;
        // The rAF stamp is the frame's start, which can precede the
        // performance.now() that woke the loop: never step backwards.
        var dtn = Math.max(0, Math.min(3, (now - lastT) / 16.667));
        lastT = now;
        var moving = false;
        inst.forEach(function (g) {
            var t = g.t;
            measureParts(g);
            g.life = lifeAt(g, now);
            if (now < g.t0 + g.dur) moving = true;
            var sct = scatterAt(g, now), off = sct.off, sc = sct.sc;
            if (!g.shown && g.life === 0 && g.to === 0) {
                // A hidden glyph waits at its own slot, so it arrives in place.
                g.X = S(t.x); g.Y = S(t.y); g.Z = S(t.s);
            }
            spring(g.X, t.x, dtn, 0.06, 0.6);
            spring(g.Y, t.y, dtn, 0.06, 0.6);
            spring(g.Z, t.s, dtn, 0.05, 0.62);
            if (Math.abs(g.X.v) + Math.abs(g.Y.v) + Math.abs(g.Z.v) > 0.004 ||
                Math.abs(t.x - g.X.x) + Math.abs(t.y - g.Y.x) + Math.abs(t.s - g.Z.x) > 0.1) moving = true;

            var fall = 0, ux = 0, uy = 0;
            if (pointer && g.shown && g.on) {
                var dx = pointer.x - g.X.x, dy = pointer.y - g.Y.x;
                fall = Math.max(0, 1 - Math.hypot(dx, dy) / (g.Z.x * 0.85));
                fall = fall * fall * (3 - 2 * fall);
                ux = dx / g.Z.x * 100 + 50;
                uy = dy / g.Z.x * 100 + 50;
            }
            var br = breathAt(g, now);
            if (g.br0 >= 0) moving = true;
            var left = g.X.x - g.Z.x / 2, top = g.Y.x - g.Z.x / 2, unit = g.Z.x / 100;
            var floor = area ? area.floor[g.offer] : Infinity;
            g.parts.forEach(function (p) {
                // Pull and breath: parts never cross into the titles' column or onto the sentence.
                var tx = p.rx * BREATH * br, ty = p.ry * BREATH * br;
                if (fall > 0) {
                    var ax = p.cx - ux, ay = p.cy - uy, d = Math.hypot(ax, ay) || 1;
                    tx += ax / d * PULL * fall;
                    ty += ay / d * PULL * fall;
                }
                if (area) {
                    tx = Math.max(tx, (minLeft - left) / unit - p.bx);
                    ty = Math.min(ty, (floor - top) / unit - p.by - p.bh);
                }
                spring(p.px, tx, dtn, 0.08, 0.64);
                spring(p.py, ty, dtn, 0.08, 0.64);
                if (Math.abs(p.px.v) + Math.abs(p.py.v) > 0.01 || Math.abs(tx - p.px.x) + Math.abs(ty - p.py.x) > 0.05) moving = true;
                else { p.px.x = tx; p.py.x = ty; p.px.v = p.py.v = 0; }
                p.ox = p.sx * off + p.px.x;
                p.oy = p.sy * off + p.py.x;
                p.s = sc > 0.999 ? 1 : sc;
            });
            render(g, now);
        });
        if (moving && visible && !document.hidden) raf = requestAnimationFrame(tick);
    }

    // Breaths run on a timer, so no frame is drawn between them.
    function breathe() {
        setTimeout(breathe, BREATH_EVERY);
        if (reduceMQ.matches || !visible || document.hidden || pointer) return;
        var now = performance.now();
        inst.forEach(function (g) {
            if (g.on && g.life === 1 && now > g.t0 + g.dur && g.parts.length > 1) {
                g.br0 = now + g.j * BREATH_STAGGER;
                wake();
            }
        });
    }

    function layout() {
        mount();
        fitThesis();
        measure();
        targets();
        if (reduceMQ.matches) snap();
        wake();
    }

    function userAct() { touched = true; }

    var dwell = 0, lastX = null;
    function onPointer(e) {
        if (e.pointerType !== "mouse") return;
        userAct();
        var dx = lastX === null ? 0 : e.clientX - lastX;
        lastX = e.clientX;
        if (!wideMQ.matches || !area) return;
        var r = stage.getBoundingClientRect();
        var p = { x: e.clientX - r.left, y: e.clientY - r.top };
        var t = e.target.closest && e.target.closest(".kicker .t");
        var n = t ? offers.indexOf(t.closest(".offer")) : -1;
        clearTimeout(dwell);
        // A pointer heading right is on its way to the open sentence's links,
        // so it waits longer before opening anything.
        if (n >= 0 && n !== active) {
            dwell = setTimeout(function () { setActive(n); }, dx > 1 ? 2.2 * DWELL_MS : DWELL_MS);
        }
        // The glyphs reach up into the thesis while they move, so track them there too.
        var near = p.y > area.rise - 120 && p.y < area.reach + 40 && p.x > minLeft - 40 && p.x < area.w + 60;
        if (near) { pointer = p; wake(); }
        else if (pointer) { pointer = null; wake(); }
    }
    document.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", function () {
        clearTimeout(dwell);
        if (pointer) { pointer = null; wake(); }
    });
    // Any sign of a reader ends the unattended tour for good: it never
    // swaps a sentence or a focused link out from under someone.
    ["keydown", "pointerdown", "touchstart", "wheel", "focusin", "selectionchange"].forEach(function (ev) {
        document.addEventListener(ev, userAct, { passive: true, once: true });
    });
    window.addEventListener("scroll", function () { if (window.scrollY > 40) userAct(); }, { passive: true });

    offers.forEach(function (o, n) {
        var b = o.querySelector("button");
        b.addEventListener("click", function () {
            userAct();
            // Wide: one offer is always open. Narrow: a tap toggles, like any disclosure.
            if (wideMQ.matches) setActive(n);
            else setActive(active === n ? -1 : n);
        });
        // Wide: focus anywhere in an offer opens it, so Tab and Shift+Tab walk
        // every title and every proof link in order (closed sentences stay
        // focusable there, faded out; see styles.css).
        o.addEventListener("focusin", function (e) {
            if (!wideMQ.matches || (e.target === b && !b.matches(":focus-visible"))) return;
            setActive(n);
        });
    });

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
            visible = es[es.length - 1].isIntersecting;
            if (visible) wake();
        }).observe(sec);
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });
    reduceMQ.addEventListener("change", function () { snap(); wake(); });

    // Unattended, the offers take one turn each after a quiet start, then the first stays open.
    var toured = 0;
    function tour(ms) {
        setTimeout(function () {
            if (touched || toured >= offers.length) return;
            if (reduceMQ.matches || !wideMQ.matches || !visible || document.hidden) { tour(CYCLE_MS); return; }
            toured++;
            setActive((active + 1) % offers.length);
            tour(CYCLE_MS);
        }, ms);
    }

    // Narrow, each title is a disclosure (aria-expanded). Wide, every
    // sentence stays reachable and the open title is the current one.
    function states() {
        offers.forEach(function (o, n) {
            var b = o.querySelector("button");
            if (wideMQ.matches) {
                b.removeAttribute("aria-expanded");
                if (n === active) b.setAttribute("aria-current", "true");
                else b.removeAttribute("aria-current");
            } else {
                b.removeAttribute("aria-current");
                b.setAttribute("aria-expanded", n === active ? "true" : "false");
            }
        });
    }

    // Phones fire resize as the URL bar shows and hides: only a change of
    // layout (crossing the breakpoint) cuts a running animation short.
    var rz = 0, wasWide = wideMQ.matches;
    window.addEventListener("resize", function () {
        cancelAnimationFrame(rz);
        rz = requestAnimationFrame(function () {
            if (wideMQ.matches && active < 0) setActive(0, true);
            layout();
            if (wideMQ.matches !== wasWide) { wasWide = wideMQ.matches; snap(); states(); }
        });
    });

    function start() {
        if (ready) return;
        try { begin(); }
        catch (e) {
            // Half-started is worse than not at all: back to the open list.
            document.documentElement.classList.remove("js");
            throw e;
        }
    }
    function begin() {
        ready = true;
        mount();
        inst.forEach(measureParts);
        // Both widths open the first offer, so the first screen always shows a case link.
        active = -1;
        setActive(0, true);
        fitThesis();
        measure();
        targets();
        snap();
        if (!reduceMQ.matches) {
            var now = performance.now();
            inst.forEach(function (g) {
                if (!g.on) return;
                g.from = 0; g.to = 1; g.life = 0;
                g.t0 = now + 250 + g.j * 110;
                g.dur = ARRIVE_MS;
            });
            wake();
        }
        window.addEventListener("load", layout);
        // The header's own face can land after the thesis's: anything above
        // the cluster that changes height moves the first screen's room.
        if ("ResizeObserver" in window) {
            new ResizeObserver(function () { layout(); }).observe(document.querySelector(".front .intro") || sec);
        }
        tour(FIRST_TOUR_MS);
        setTimeout(breathe, BREATH_FIRST + 250 + ARRIVE_MS);
    }
    // Wired up: styles.css may now hide the closed offers (script.js shows
    // them all again if this never runs).
    sec.classList.add("live");

    // Fit and measure only with Inter in place; fallback metrics misplace the cluster.
    if (document.fonts && document.fonts.load) {
        document.fonts.load('800 100px "InterVariable"').then(start, start);
        document.fonts.addEventListener("loadingdone", function () { if (ready) layout(); });
        document.fonts.ready.then(function () { if (ready) layout(); });
    } else start();
})();
