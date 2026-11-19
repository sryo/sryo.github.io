// Password gate for client case pages and their assets, in front of GitHub Pages.

const COOKIE = "case_pass";
const MAX_AGE = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const locked = (env.LOCKED || "").split(",").map((s) => s.trim()).filter(Boolean);
    const m = url.pathname.match(/^\/(work|contents)\/([^/]+)/);
    const slug = m && locked.includes(m[2]) ? m[2] : null;

    if (url.pathname === "/__gate" && request.method === "POST") return login(request, env);
    if (!slug) return upstream(request, env);

    if (await valid(request, env)) {
      const res = await upstream(request, env);
      const out = new Response(res.body, res);
      out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      out.headers.set("Cache-Control", "private, no-store");
      return out;
    }
    if (m[1] === "contents") return new Response("Unauthorized", { status: 401, headers: noindex() });
    return form(request, env, url.pathname, false);
  },
};

async function login(request, env) {
  const data = await request.formData();
  const next = safeNext(String(data.get("next") || "/works"));
  if (!env.PASSWORD || !equal(String(data.get("password") || ""), env.PASSWORD)) return form(request, env, next, true);
  const token = await sign(env);
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      ...noindex(),
    },
  });
}

// Token is an HMAC of the password, so changing PASSWORD logs everyone out.
async function sign(env) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SECRET || env.PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(env.PASSWORD));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function valid(request, env) {
  if (!env.PASSWORD) return false;
  const c = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`));
  return !!c && equal(c[1], await sign(env));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function safeNext(p) {
  return p.startsWith("/") && !p.startsWith("//") ? p : "/works";
}

function noindex() {
  return { "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "private, no-store" };
}

// ORIGIN is only set for local testing (wrangler dev --var ORIGIN:http://localhost:8000).
function upstream(request, env) {
  if (!env.ORIGIN) return fetch(request);
  const url = new URL(request.url);
  return fetch(new Request(env.ORIGIN + url.pathname + url.search, request));
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);

const STYLE = `<style>
.gate-line{margin:0;font-size:21px;line-height:40px;letter-spacing:-0.01em;color:var(--mute);text-wrap:pretty}
.gate-line strong,.gate-line a{color:var(--ink);font-weight:600}
.gate-pw,.gate-line a,.gate-nb{white-space:nowrap}
.gate input{width:9ch;margin:0 6px;padding:0;border:0;border-bottom:2px solid var(--rule);border-radius:0;background:transparent;color:var(--ink);font:inherit;font-weight:600;outline:none}
.gate input:focus{box-shadow:0 2px 0 var(--rule)}
.gate input[aria-invalid]{border-bottom-style:dashed}
.gate-eyes{display:inline-block;margin:0 6px 0 0;padding:0;border:0;background:none;cursor:pointer;vertical-align:-8px;color:var(--ink)}
.gate-eyes svg{display:block;width:64px;height:32px;overflow:visible}
.gate-eyes .pupil{transform:translate(var(--dx,0px),var(--dy,0px));transition:transform 300ms var(--ease-spring,ease-out)}
.gate-eyes.tracking .pupil{transition:transform 50ms linear}
.gate-eyes .lid{transition:transform 150ms ease-out}
.gate-eyes.blink .lid{transition:transform 70ms ease-in}
.gate-eyes.squint .lid{transform:translateY(6px) rotate(var(--tilt))}
.gate-eyes.blink .lid{transform:translateY(8px)}
.gate-eyes.blink .pupil{opacity:0}
.gate-eyes .eye.shut .lid{transform:translateY(8px);transition:none}
.gate-eyes .eye.shut .pupil{opacity:0}
.gate-eyes.no .look{animation:gate-no 600ms}
@keyframes gate-no{20%{transform:translateX(-3px)}50%{transform:translateX(3px)}80%{transform:translateX(-2px)}}
@media (prefers-reduced-motion:reduce){.gate-eyes .pupil,.gate-eyes.tracking .pupil,.gate-eyes .lid{transition:none}.gate-eyes.no .look{animation:none}}
.gate-go{display:inline-block;width:1.2em;margin:0 6px 0 calc(-1.2em - 6px);padding:0;border:0;background:none;color:var(--ink);font:inherit;font-weight:600;cursor:pointer;opacity:0;transform:translateX(-6px);pointer-events:none;transition:opacity 200ms ease-out,transform 200ms ease-out}
.gate-pw:has(input:valid) .gate-go{opacity:1;transform:none;pointer-events:auto}
@media (prefers-reduced-motion:reduce){.gate-go{transform:none}}
</style>`;

const EYES_JS = `(() => {
  const f = document.querySelector(".gate input[name=password]");
  const b = document.querySelector(".gate-eyes");
  if (!f || !b) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const look = () => {
    const n = f.value.length;
    const dx = n ? 3 : -3, dy = n ? -3 : 1;
    b.style.setProperty("--dx", dx + "px");
    b.style.setProperty("--dy", dy + "px");
  };
  const eyesEl = [...b.querySelectorAll(".eye")];
  const pupils = [...b.querySelectorAll(".pupil")];
  b.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    b.classList.add("tracking");
    const r = b.getBoundingClientRect(), k = 40 / r.width;
    pupils.forEach((p, i) => {
      const x = (e.clientX - r.left) * k - (i ? 30 : 10), y = (e.clientY - r.top) * k - 10;
      const d = Math.hypot(x, y), m = d > 4 ? 4 / d : 1;
      p.style.setProperty("--dx", x * m + "px");
      p.style.setProperty("--dy", y * m + "px");
    });
  });
  b.addEventListener("pointerleave", () => b.classList.remove("tracking") || pupils.forEach((p) => { p.style.removeProperty("--dx"); p.style.removeProperty("--dy"); }));
  // mousedown is cancelled so a poke doesn't take focus from the field.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("pointerdown", (e) => {
    const r = b.getBoundingClientRect();
    const el = eyesEl[e.clientX - r.left < r.width / 2 ? 0 : 1];
    el.classList.add("shut");
    clearTimeout(el.t);
    el.t = setTimeout(() => el.classList.remove("shut"), 600);
  });
  const blink = () => {
    if (still) return;
    b.classList.add("blink");
    setTimeout(() => b.classList.remove("blink"), 100);
  };
  let typed = 0;
  f.addEventListener("input", () => { typed = Date.now(); b.classList.remove("squint"); look(); });
  // The squint is in the markup so it shows without JS.
  if (b.classList.contains("squint")) {
    b.classList.remove("squint");
    blink();
    setTimeout(() => b.classList.add("squint"), 260);
  }
  setTimeout(() => b.classList.remove("no"), 900);
  if (!still) (function idle() {
    setTimeout(() => {
      if (!b.classList.contains("squint") && Date.now() - typed > 1500) {
        blink();
        if (Math.random() < 1 / 6) setTimeout(blink, 280);
      }
      idle();
    }, 3000 + Math.random() * 3000);
  })();
  look();
})();`;

function gateSection(next, wrong, title) {
  const subject = encodeURIComponent(title ? `Password for ${title}` : "Case password");
  const ask = `<a href="mailto:mateo@yadarola.com.ar?subject=${esc(subject)}">ask me for one</a>`;
  const field = `<input type="password" name="password" autocomplete="current-password" enterkeyhint="go" autofocus required aria-label="Password"${wrong ? ' aria-invalid="true"' : ""}>`;
  const eye = (cx, i) => `<g class="eye"><clipPath id="gate-e${i}"><circle cx="${cx}" cy="10" r="8"/></clipPath><circle cx="${cx}" cy="10" r="8" fill="var(--paper)"/><g class="look"><circle class="pupil" cx="${cx}" cy="10" r="3.5" fill="currentColor"/></g><g clip-path="url(#gate-e${i})"><g class="lid" style="transform-origin:${cx}px 2px;--tilt:${i ? -16 : 16}deg"><rect x="${cx - 9}" y="-16" width="18" height="18" fill="var(--paper)"/><line x1="${cx - 9}" x2="${cx + 9}" y1="2" y2="2" stroke="currentColor" stroke-width="2"/></g></g><circle cx="${cx}" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2"/></g>`;
  const eyes = `<span class="gate-eyes${wrong ? " squint no" : ""}" aria-hidden="true"><svg viewBox="0 0 40 20" aria-hidden="true">${eye(10, 0)}${eye(30, 1)}</svg></span>`;
  const go = `<button type="submit" class="gate-go" aria-label="Open">→</button>`;
  const lead = wrong ? "<strong>Wrong password.</strong> Try again" : "<strong>This case is private.</strong> Type the password";
  return `<section class="part gate"><h2>Private</h2><div class="body">
<form method="post" action="/__gate">
<input type="hidden" name="next" value="${esc(next)}">
<p class="gate-line">${lead.replace(/ (\S+)$/, ' <span class="gate-pw">$1' + field + go + eyes + "</span>")}and <span class="gate-nb">press Enter</span>, or ${ask}.</p>
</form></div></section><script>${EYES_JS}</script>`;
}

// The header and More work links stay: they're already public on /works.
async function form(request, env, next, wrong) {
  const headers = { "Content-Type": "text/html; charset=utf-8", ...noindex() };
  const base = env.ORIGIN || new URL(request.url).origin;
  let res;
  try {
    res = await fetch(new Request(base + next, { headers: { Accept: "text/html" } }));
  } catch {}
  if (!res || !res.ok || !(res.headers.get("Content-Type") || "").includes("text/html")) {
    return new Response(bare(next, wrong), { status: 401, headers });
  }

  let title = "";
  let placed = false;
  const out = new HTMLRewriter()
    .on('meta[name="robots"]', { element: (e) => e.remove() })
    // The wrong-password reply is served from /__gate; base keeps the page's relative links working.
    .on("head", { element: (e) => { e.prepend(`<base href="${esc(next)}">`, { html: true }); e.append(`<meta name="robots" content="noindex, nofollow">${STYLE}`, { html: true }); } })
    .on("header.case-head h1", { text: (t) => { title += t.text; } })
    .on("main > *:not(header)", { element: (e) => e.remove() })
    .on("main > header.case-head", {
      element: (e) => e.onEndTag((end) => { end.after(gateSection(next, wrong, unesc(title).trim()), { html: true }); placed = true; }),
    })
    .on("main", { element: (e) => e.onEndTag((end) => { if (!placed) end.before(gateSection(next, wrong, ""), { html: true }); }) })
    .transform(res);
  return new Response(out.body, { status: 401, headers });
}

function bare(next, wrong) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Private case / Mateo Yadarola</title>
<style>:root{--paper:#fafafa;--ink:#111;--rule:#111}@media (prefers-color-scheme:dark){:root{--paper:#0b0b0b;--ink:#f2f2f2;--rule:#f2f2f2}}
body{margin:0;padding:32px 16px;background:var(--paper);color:var(--ink);font:17px/28px system-ui,sans-serif}</style>
${STYLE}</head><body><main>${gateSection(next, wrong, "")}<p><a href="/works">All work</a></p></main></body></html>`;
}
