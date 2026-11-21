// An inchworm on the inside edge of the page; it walks while you keep still.
(function () {
  "use strict";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, a, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); p.append(e); return e; };
  const ease = (u) => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);

  const R = 12, N = 8, D = R * 1.9;
  const BODY = (N - 1) * D, MIN = BODY * 0.3, STRIDE = BODY - MIN;
  const GATHER = 1.4, HOLD = 0.35, REACH = 1.2, LIE = 0.6, T = GATHER + HOLD + REACH + LIE;

  // Inside the page, the walking line is the page rectangle inset by R. s runs clockwise
  // from the top-left; the normal points into the page, away from the edge.
  let W = 0, H = 0, L = 0;
  function size() {
    W = document.documentElement.clientWidth;
    H = document.documentElement.scrollHeight;
    L = 2 * (W - 2 * R) + 2 * (H - 2 * R);
  }
  function P(s) {
    const w = W - 2 * R, h = H - 2 * R;
    s = ((s % L) + L) % L;
    if (s < w) return { x: R + s, y: R, nx: 0, ny: 1 };
    s -= w;
    if (s < h) return { x: W - R, y: R + s, nx: -1, ny: 0 };
    s -= h;
    if (s < w) return { x: W - R - s, y: H - R, nx: 0, ny: -1 };
    s -= w;
    return { x: R, y: H - R - s, nx: 1, ny: 0 };
  }
  const at = (s) => { const p = P(s); return { x: p.x, y: p.y }; };

  function half(c) {
    const r = Math.min(0.9999, c / BODY);
    let lo = 1e-4, hi = Math.PI - 1e-4;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (Math.sin(m) / m > r) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  let lastMove = performance.now();
  const stir = () => { lastMove = performance.now(); };
  ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"].forEach((e) => addEventListener(e, stir, { passive: true }));

  function begin() {
    size();
    addEventListener("resize", size);
    const svg = mk("svg", { "aria-hidden": "true" }, document.body);
    svg.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:9";
    // Body is the page's text colour; the eyes are holes, so the page shows through.
    const rgb = (el, k) => (getComputedStyle(el)[k].match(/[\d.]+/g) || []).map(Number);
    const ink = rgb(document.body, "color");
    let paper = rgb(document.body, "backgroundColor");
    if (paper.length > 3 && paper[3] === 0) paper = rgb(document.documentElement, "backgroundColor");
    // Where ink and paper are complements (works, light or dark), draw white with
    // difference blending: the worm reads as ink on paper and paper on ink, the same
    // parity the illustrations use.
    const invert = paper.length >= 3 && [0, 1, 2].every((i) => Math.abs(ink[i] + paper[i] - 255) < 40);
    const fill = invert ? "#fff" : "currentColor";
    svg.style.color = "inherit";
    if (invert) svg.style.mixBlendMode = "difference";
    const mask = mk("mask", { id: "egg-eyes", maskUnits: "userSpaceOnUse" }, svg);
    const sheet = mk("rect", { fill: "#fff" }, mask);
    const eyes = [0, 1].map(() => mk("ellipse", { rx: R * 0.2, ry: R * 0.2, fill: "#000" }, mask));
    const fit = () => { sheet.setAttribute("width", W); sheet.setAttribute("height", H); mask.setAttribute("width", W); mask.setAttribute("height", H); };
    fit(); addEventListener("resize", fit);
    const g = mk("g", { mask: "url(#egg-eyes)" }, svg);
    const ants = [0, 1].map(() => mk("line", { stroke: fill, "stroke-width": R / 5, "stroke-linecap": "round" }, svg));
    const segs = []; for (let i = 0; i < N; i++) segs.push(mk("circle", { r: R, fill }, g));

    // Starts on the bottom edge, a third of the way in from the right.
    const start = (W - 2 * R) + (H - 2 * R) + (W - 2 * R) / 3;
    // fear: 0 calm, 1 pressed flat with eyes shut. Any movement scares it; after
    // 1.2s of stillness it calms, looks again, and only then walks on.
    let t = 0, cycles = 0, fear = 1, last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      // Any movement freezes it mid-step; stillness lets it carry on.
      const calm = now - lastMove > 1200;
      fear = calm ? Math.max(0, fear - dt / 0.7) : Math.min(1, fear + dt / 0.25);
      if (calm && fear === 0) t += dt;
      while (t >= T) { t -= T; cycles++; }
      const o = start + cycles * STRIDE;
      let tail, head;
      if (t < GATHER) { tail = o + ease(t / GATHER) * STRIDE; head = o + BODY; }
      else if (t < GATHER + HOLD) { tail = o + STRIDE; head = o + BODY; }
      else if (t < GATHER + HOLD + REACH) { tail = o + STRIDE; head = o + BODY + ease((t - GATHER - HOLD) / REACH) * STRIDE; }
      else { tail = o + STRIDE; head = o + BODY + STRIDE; }
      const c = head - tail;
      const pts = [];
      for (let i = 0; i < N; i++) pts.push(at(tail + (i / (N - 1)) * c));
      const A = P(tail), B = P(head), M = P((tail + head) / 2);
      const cx = B.x - A.x, cy = B.y - A.y, ch = Math.hypot(cx, cy);
      // Blended near flat so the loop doesn't jump when it starts at a corner.
      const bw = Math.min(1, Math.max(0, (BODY - c) / (2 * D))) * (1 - ease(fear));
      if (bw > 0 && ch > 0.01 && ch < BODY - 0.01) {
        const th = half(ch), rad = BODY / (2 * th);
        let nx = -cy / ch, ny = cx / ch;
        if (nx * (M.nx + A.nx + B.nx) + ny * (M.ny + A.ny + B.ny) < 0) { nx = -nx; ny = -ny; }
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ux = cx / ch, uy = cy / ch, oc = -rad * Math.cos(th);
        for (let i = 0; i < N; i++) {
          const ph = -th + (i / (N - 1)) * 2 * th, ax = rad * Math.sin(ph), ay = oc + rad * Math.cos(ph);
          const x = mx + ux * ax + nx * ay, y = my + uy * ax + ny * ay;
          pts[i] = { x: pts[i].x + (x - pts[i].x) * bw, y: pts[i].y + (y - pts[i].y) * bw };
        }
      }
      pts.forEach((p, i) => { segs[i].setAttribute("cx", p.x.toFixed(2)); segs[i].setAttribute("cy", p.y.toFixed(2)); });
      const hd = pts[N - 1], nk = pts[N - 2];
      let fx = hd.x - nk.x, fy = hd.y - nk.y; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
      // "Up" is the head's own perpendicular, so eyes and antennae turn with it in the
      // loop. Walking clockwise, that side faces into the page.
      const ux = -fy, uy = fx;
      eyes.forEach((e, k) => {
        const back = k ? 0.05 : 0.5;
        const ex = hd.x + fx * R * back + ux * R * 0.3, ey = hd.y + fy * R * back + uy * R * 0.3;
        // Eyes shut in the first third of the fright and stay a slit.
        const open = 1 - Math.min(1, fear * 3);
        e.setAttribute("cx", ex); e.setAttribute("cy", ey);
        e.setAttribute("ry", (R * 0.2 * Math.max(0.15, open)).toFixed(2));
        e.setAttribute("transform", `rotate(${(Math.atan2(fy, fx) * 180 / Math.PI).toFixed(1)} ${ex.toFixed(2)} ${ey.toFixed(2)})`);
      });
      ants.forEach((a, k) => {
        const bx = hd.x + ux * R * 0.8 + fx * R * (k ? -0.15 : 0.3), by = hd.y + uy * R * 0.8 + fy * R * (k ? -0.15 : 0.3);
        a.setAttribute("x1", bx); a.setAttribute("y1", by);
        a.setAttribute("x2", bx + ux * R * 0.7 + fx * R * (k ? 0.2 : 0.55)); a.setAttribute("y2", by + uy * R * 0.7 + fy * R * (k ? 0.2 : 0.55));
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }
  if (document.readyState === "complete") begin(); else addEventListener("load", begin);
})();
