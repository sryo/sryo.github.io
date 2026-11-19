// Browser tests for index.html, works.html and every work/<slug>/ page.
// Run: node tests/site.mjs (builds the portfolio first with build.sh).
// Screenshots go to $SHOTS_DIR (default: tests/shots, gitignored).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolve } from 'node:path';
import { mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS_DIR || resolve(ROOT, 'tests/shots');
mkdirSync(SHOTS, { recursive: true });

// works.html and work/ are build output (gitignored): build them fresh.
execSync('bash build.sh', { cwd: ROOT, stdio: 'ignore' });

const req = createRequire(import.meta.url);
let playwright;
try { playwright = req('playwright'); }
catch { playwright = req(resolve(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = playwright;

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };
const WORK = resolve(ROOT, 'work');
const CASES = existsSync(WORK) ? readdirSync(WORK).filter(s => existsSync(resolve(WORK, s, 'index.html'))).sort() : [];
// ONLY=<substring> limits the run to matching pages, for quick iteration.
const PAGES = ['/', '/works.html', ...CASES.map(s => `/work/${s}/`)].filter(p => !process.env.ONLY || p.includes(process.env.ONLY));
const PORTFOLIO = p => p !== '/';
const SIDE_SLUGS = readdirSync(resolve(ROOT, 'contents/about/items')).filter(s => existsSync(resolve(ROOT, 'contents/about/items', s, '_.md'))).sort();
const slugOf = p => p.split('/')[2];
const SIDE = p => p.startsWith('/work/') && SIDE_SLUGS.includes(slugOf(p));

const tests = [];
const test = (name, fn, only = () => true) => tests.push({ name, fn, only });

// ── Every page ────────────────────────────────────────────────
test('no console errors', async ({ errors }) => {
  if (errors.length) throw new Error(errors.join('\n'));
});

test('has title and meta description', async ({ page }) => {
  if (!(await page.title())) throw new Error('empty <title>');
  const d = await page.getAttribute('meta[name="description"]', 'content');
  if (!d) throw new Error('missing meta description');
});

test('no horizontal scroll', async ({ page }) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) throw new Error(`overflows by ${over}px`);
});

test('no phone number is published', async ({ page }) => {
  // Inlined data: URIs are left out: base64 can spell anything by chance.
  const html = (await page.evaluate(() => document.documentElement.outerHTML)).replace(/data:[^"')\s]+/g, '');
  // Generic on purpose: the real number must never appear in this file.
  const m = html.match(/\+54|\b351[\s.-]?\d{3}[\s.-]?\d{4}\b|href="tel:/);
  if (m) throw new Error(`page carries "${m[0]}"`);
});

test('images have alt text', async ({ page }) => {
  const n = await page.locator('img:not([alt])').count();
  if (n) throw new Error(`${n} <img> without alt`);
});

// ── Portfolio pages ───────────────────────────────────────────
test('set in InterVariable', async ({ page }) => {
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 16px InterVariable')
      && getComputedStyle(document.body).fontFamily.includes('InterVariable');
  });
  if (!ok) throw new Error('InterVariable not loaded or not applied');
}, PORTFOLIO);

test('glyphs invert in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const filters = await page.$$eval('.glyph:not(.colour) img', imgs => imgs.map(i => getComputedStyle(i).filter));
  await page.emulateMedia({ colorScheme: 'light' });
  if (!filters.length) throw new Error('no .glyph img on page');
  const bad = filters.filter(f => !f.includes('invert'));
  if (bad.length) throw new Error(`${bad.length} glyphs not inverted: ${bad[0]}`);
}, p => p === '/works.html' || (p.startsWith('/work/') && !p.endsWith('/about/')));

test('case h1 is display size at desktop', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const px = parseFloat(await page.$eval('h1', h => getComputedStyle(h).fontSize));
  if (px < 36) throw new Error(`h1 is ${px}px`);
}, p => p.startsWith('/work/'));

test('accent is ink: no colour for now', async ({ page }) => {
  const r = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement);
    return { accent: cs.getPropertyValue('--accent').trim(), ink: cs.getPropertyValue('--ink').trim(), inline: document.documentElement.style.getPropertyValue('--accent') }; });
  if (r.accent !== r.ink || r.inline) throw new Error(`--accent is ${r.accent} (inline "${r.inline}"), ink is ${r.ink}`);
}, PORTFOLIO);

test('pages opt in to cross-document view transitions', async ({ page }) => {
  const ok = await page.evaluate(() => [...document.styleSheets].some(sh =>
    [...sh.cssRules].some(r => r.cssText.startsWith('@view-transition'))));
  if (!ok) throw new Error('no @view-transition rule');
}, PORTFOLIO);

test('ledger rows do not overlap', async ({ page }) => {
  const boxes = await page.$$eval('a.row', rows => rows.map(r => {
    const b = r.getBoundingClientRect(); return [b.top, b.bottom];
  }));
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i][0] < boxes[i - 1][1] - 0.5) throw new Error(`row ${i} overlaps row ${i - 1}`);
  }
}, p => p === '/works.html');

test('email sits in the header links and the footer', async ({ page }) => {
  const r = await page.evaluate(() => ({ all: document.querySelectorAll('a[href="mailto:mateo@yadarola.com.ar"]').length,
    head: document.querySelectorAll('.front .intro nav.site a[href="mailto:mateo@yadarola.com.ar"]').length,
    footer: document.querySelectorAll('footer.sig a[href="mailto:mateo@yadarola.com.ar"]').length,
    mail: document.querySelectorAll('footer.sig .sig-mail[href="mailto:mateo@yadarola.com.ar"]').length }));
  if (r.head !== 1 || r.mail !== 1 || r.footer !== 2 || r.all !== 3) throw new Error(`mailto links: ${r.head} in the header, ${r.footer} in the footer (${r.mail} the address), ${r.all} in all`);
}, p => p === '/works.html');

test('no small caps labels or item counts', async ({ page }) => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(e => { const cs = getComputedStyle(e); return cs.textTransform === 'uppercase' || (parseFloat(cs.fontSize) < 13 && parseFloat(cs.letterSpacing) > 0.5); })
    .map(e => e.textContent.trim().slice(0, 30)));
  if (bad.length) throw new Error(`${bad.length} caps labels: ${bad.slice(0, 4).join(' | ')}`);
  if (await page.locator('.count, .label, main .mast, main .cols').count()) throw new Error('a count, caps label, masthead or column header is still rendered');
  const small = await page.$$eval('main h2', hs => hs.filter(h => parseFloat(getComputedStyle(h).fontSize) < 21).map(h => h.textContent.trim()));
  if (small.length) throw new Error(`h2 under 21px: ${small.join(', ')}`);
}, PORTFOLIO);

test('back link, spec terms and pager direction are readable text', async ({ page }) => {
  const sizes = await page.$$eval('nav.mast a, .spec dl, .pn-dir, .item-meta', es => es.map(e => [e.className || e.tagName, parseFloat(getComputedStyle(e).fontSize)]));
  const small = sizes.filter(([, px]) => px < 15);
  if (small.length) throw new Error(`under 15px: ${small.map(([c, px]) => `${c} ${px}px`).join(', ')}`);
}, p => p.startsWith('/work/'));

test('side lines are not questions', async ({ page }) => {
  const lines = await page.$$eval('[aria-labelledby="g-side"] .row .line', ls => ls.map(l => l.textContent.trim()));
  if (!lines.length) throw new Error('no side rows');
  const bad = lines.filter(l => l.startsWith('What if') || l.endsWith('?') || l.length > 100);
  if (bad.length) throw new Error(`${bad.length} lines: ${bad[0]}`);
}, p => p === '/works.html');

test('every row has a drawn glyph', async ({ page }) => {
  const n = await page.locator('.glyph.initial').count();
  if (n) throw new Error(`${n} typographic initials`);
}, p => p === '/works.html');

test('glyphs are on-system: black fills, no text, style or animation', async ({ page }) => {
  const srcs = await page.$$eval('.glyph:not(.colour) img', imgs => imgs.map(i => i.getAttribute('src')));
  const bad = [];
  for (const src of srcs) {
    const m = src.match(/^data:image\/svg\+xml;base64,(.*)$/);
    if (!m) { bad.push(`not an inline SVG: ${src.slice(0, 40)}`); continue; }
    const svg = Buffer.from(m[1], 'base64').toString('utf8');
    if (/<(text|style|animate)/i.test(svg)) { bad.push(svg.match(/<(text|style|animate)\w*/i)[0]); continue; }
    const fills = [...svg.matchAll(/fill(?:="|:\s*)([^";]+)/g)].map(f => f[1].trim().toLowerCase());
    const off = fills.filter(f => !['black', '#000', '#000000', 'none'].includes(f));
    if (off.length) bad.push(`fill ${off[0]}`);
  }
  if (bad.length) throw new Error(`${bad.length} off-system glyphs: ${bad.join(', ')}`);
}, p => p === '/works.html');

const SIDE_GLYPHS = ['chanchan', 'avis', 'figma-cdp', 'murmur', 'dirpad', 'trueframe', 'fin', 'subi',
  'posta', 'airnod', 'zentrate', 'figma-plugins'];
test('side glyphs are basic shapes XORed in one path', async () => {
  const bad = [];
  for (const slug of SIDE_GLYPHS) {
    const svg = await readFile(resolve(ROOT, 'contents/about/items', slug, '_.svg'), 'utf8');
    const paths = svg.match(/<path\b[^>]*>/g) || [];
    if (paths.length !== 1) { bad.push(`${slug}: ${paths.length} paths`); continue; }
    if (!/fill-rule="evenodd"/.test(paths[0])) { bad.push(`${slug}: no evenodd`); continue; }
    if (/<(circle|rect|ellipse|polygon|line|text|style|animate)\b/i.test(svg)) { bad.push(`${slug}: extra element`); continue; }
    if (/stroke/i.test(svg)) { bad.push(`${slug}: stroke`); continue; }
    const d = paths[0].match(/\sd="([^"]*)"/)?.[1] || '';
    const cmds = d.replace(/[-\d.,\s]+/g, '');
    if (/[^MLHVAZmlhvaz]/.test(cmds)) { bad.push(`${slug}: curve command ${cmds.match(/[^MLHVAZmlhvaz]/)[0]}`); continue; }
    const shapes = (cmds.match(/[Mm]/g) || []).length;
    if (shapes < 2 || shapes > 4) { bad.push(`${slug}: ${shapes} shapes, want 2–4`); continue; }
    if (cmds.length > 32) bad.push(`${slug}: ${cmds.length} segments, too detailed`);
  }
  if (bad.length) throw new Error(`${bad.length} glyphs off-grammar: ${bad.join('; ')}`);
}, p => p === '/works.html');

const GLYPHS = [...readdirSync(resolve(ROOT, 'contents')).map(s => `contents/${s}`),
  ...SIDE_SLUGS.map(s => `contents/about/items/${s}`)].filter(d => existsSync(resolve(ROOT, d, '_.svg')));
test('glyph parts XOR back into the glyph', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const glyphs = GLYPHS.map(d => ({ d, svg: readFileSync(resolve(ROOT, d, '_.svg'), 'utf8'),
    parts: existsSync(resolve(ROOT, d, '_.parts.svg')) ? readFileSync(resolve(ROOT, d, '_.parts.svg'), 'utf8') : null }));
  const missing = glyphs.filter(g => !g.parts).map(g => g.d);
  if (missing.length) throw new Error(`no _.parts.svg: ${missing.join(', ')}`);
  const res = await page.evaluate(async glyphs => {
    const S = 200, out = [];
    const toD = el => {
      const a = k => +el.getAttribute(k), round = el.localName === 'circle';
      switch (el.localName) {
        case 'circle': case 'ellipse': {
          const rx = a(round ? 'r' : 'rx'), ry = round ? rx : a('ry'), cx = a('cx'), cy = a('cy');
          return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
        }
        case 'rect': return `M${a('x')} ${a('y')}h${a('width')}v${a('height')}h${-a('width')}Z`;
        case 'polygon': return 'M' + el.getAttribute('points').trim().split(/\s+/).join('L') + 'Z';
        case 'path': return el.getAttribute('d');
      }
      return null;
    };
    for (const g of glyphs) {
      const doc = new DOMParser().parseFromString(g.parts, 'image/svg+xml'), kids = [...doc.documentElement.children];
      const odd = kids.find(el => !toD(el) || el.hasAttribute('transform') || /fill="(?!black)/.test(el.outerHTML));
      if (kids.length < 2 || odd) { out.push(`${g.d}: ${odd ? `<${odd.localName}> not a black primitive` : 'fewer than 2 parts'}`); continue; }
      const ref = new OffscreenCanvas(S, S).getContext('2d');
      const im = new Image(); im.src = 'data:image/svg+xml;base64,' + btoa(g.svg); await im.decode();
      ref.drawImage(im, 0, 0, S, S);
      const x = new OffscreenCanvas(S, S).getContext('2d');
      x.scale(S / 100, S / 100);
      x.globalCompositeOperation = 'xor';
      kids.forEach(el => x.fill(new Path2D(toD(el))));
      const A = ref.getImageData(0, 0, S, S).data, B = x.getImageData(0, 0, S, S).data;
      let bad = 0;
      // Antialiasing moves a pixel's alpha by less than half; a primitive off
      // by one unit, or a missing one, moves it by more.
      for (let i = 3; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 128) bad++;
      if (bad / (S * S) > 0.002) out.push(`${g.d}: ${(bad / (S * S) * 100).toFixed(2)}% differs`);
    }
    return out;
  }, glyphs);
  if (res.length) throw new Error(res.join('; '));
}, p => p === '/works.html');

test('client roles fit on one line at 1440', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const tall = await page.$$eval('[aria-labelledby="g-client"] .row .meta', rs => rs
    .filter(r => r.getBoundingClientRect().height > parseFloat(getComputedStyle(r).lineHeight) + 1)
    .map(r => r.textContent));
  if (tall.length) throw new Error(`${tall.length} roles wrap: ${tall[0]}`);
}, p => p === '/works.html');

test('at 390 the glyph sits left of the name', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  await page.setViewportSize({ width: 390, height: 844 });
  const bad = await page.$$eval('.row', rows => rows.filter(r => {
    const g = r.querySelector('.glyph'), n = r.querySelector('.name');
    return !(g && n && g.getBoundingClientRect().left < n.getBoundingClientRect().left);
  }).length);
  await page.setViewportSize({ width: 375, height: 812 });
  if (bad) throw new Error(`${bad} rows with the glyph right of the name`);
}, p => p === '/works.html');

test('Impact captions are at least 13px at 390', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  await page.setViewportSize({ width: 390, height: 844 });
  const sizes = await page.$$eval('.metric-label', ls => ls.map(l => parseFloat(getComputedStyle(l).fontSize)));
  await page.setViewportSize({ width: 375, height: 812 });
  const small = sizes.filter(s => s < 13);
  if (small.length) throw new Error(`${small.length} captions under 13px (${small[0]}px)`);
}, p => p.startsWith('/work/'));

test('Figma facades swap in a lazy iframe on click', async ({ page }) => {
  const n = await page.locator('a.embed-facade').count();
  if (!n) throw new Error('no .embed-facade');
  if (await page.locator('iframe[src*="embed.figma.com"]').count()) throw new Error('eager Figma iframe');
  await page.locator('a.embed-facade').first().click();
  const lazy = await page.locator('iframe[src*="embed.figma.com"][loading="lazy"]').count();
  if (lazy !== 1) throw new Error(`${lazy} iframes after click`);
  await page.reload();
}, p => p === '/work/murmur/');

test('Tab then Enter on a row opens its case page', async ({ page }) => {
  let href = null;
  // The opening and the offers' proof links come first: up to 40 stops.
  for (let i = 0; i < 40 && !href; i++) {
    await page.keyboard.press('Tab');
    href = await page.evaluate(() => document.activeElement?.matches('a.row') ? document.activeElement.getAttribute('href') : null);
  }
  if (!href) throw new Error('no a.row reachable by Tab');
  await Promise.all([page.waitForURL(u => u.pathname.endsWith('/' + href.replace(/#.*/, ''))), page.keyboard.press('Enter')]);
  await page.goBack();
}, p => p === '/works.html');

// The pager keeps date order (newest first), whatever the front page features.
test('rel=next walks every client case once', async ({ page, base }) => {
  const rows = await page.$$eval('[aria-labelledby="g-client"] a.row, [aria-labelledby="g-also"] .it > a', as => as.map(a => a.href));
  const seen = [];
  let url = `${base}/work/${Object.keys(CV)[0]}/`;
  while (url) {
    if (seen.includes(url)) throw new Error(`loop at ${url}`);
    seen.push(url);
    await page.goto(url);
    url = await page.$eval('a[rel="next"]', a => a.href).catch(() => null);
  }
  const want = Object.keys(CV).map(s => `${base}/work/${s}/`);
  if (seen.join() !== want.join()) throw new Error(`walked [${seen.join(', ')}], want date order`);
  if ([...rows].sort().join() !== [...seen].sort().join()) throw new Error(`walked ${seen.length}, front page has ${rows.length}`);
  await page.goto(`${base}/works.html`);
}, p => p === '/works.html');

const CASE = p => p.startsWith('/work/') && !p.endsWith('/about/') && !SIDE(p);
const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

// Client cases, newest first, with the year and role each page must show.
// A pending case must still fail its checks, so it can't linger.
const CV = {
  valora: [2024, 'Lead UX/UI designer'],
  continental: [2022, 'Lead UX/UI designer'],
  'ey-helix': [2021, 'Lead UX designer'],
  bancor: [2020, 'Product owner and lead designer'],
  veng: [2019, 'Lead UX designer'],
  hometown: [2019, 'Senior UX designer'],
  topicflower: [2019, 'Senior UX designer'],
  omsnic: [2019, 'Lead UI designer'],
  lavoz: [2017, 'UX researcher and product designer'],
  infoxel: [2016, 'Product designer'],
};
const CV_PENDING = [];
const CV_DONE = p => CASE(p) && !CV_PENDING.includes(slugOf(p));
const CLIENT_ROWS = Object.keys(CV);
const CLIENT_ENDS = [CLIENT_ROWS[0], CLIENT_ROWS[CLIENT_ROWS.length - 1]].map(s => `/work/${s}/`);

async function cvFactProblems(page, slug) {
  const [year, role] = CV[slug];
  const r = await page.evaluate(() => {
    const dts = [...document.querySelectorAll('.spec dt')];
    const role = dts.find(d => d.textContent.trim() === 'Role')?.nextElementSibling?.textContent.trim();
    return { year: document.querySelector('.spec dl time')?.textContent.trim(), role };
  });
  const bad = [];
  if (r.year !== String(year)) bad.push(`Year reads ${r.year}, the CV says ${year}`);
  if (r.role !== role) bad.push(`Role reads "${r.role}", the CV says "${role}"`);
  return bad;
}

async function myRoleProblems(page) {
  const labels = await page.$$eval('main h2', hs => hs.map(h => h.textContent.trim()));
  return labels.includes('My role') ? [] : ['no My role section'];
}

async function clientDiagramProblems(page, vp) {
  const figs = await page.$$eval('main figure.diagram', fs => fs.map(f => {
    const svg = f.querySelector('svg'), cap = f.querySelector('figcaption');
    let lines = 0;
    if (cap) { const r = document.createRange(); r.selectNodeContents(cap); lines = new Set([...r.getClientRects()].map(b => Math.round(b.top))).size; }
    const labels = [];
    if (svg) {
      const texts = [...svg.querySelectorAll('text')].map(t => ({ x: +t.getAttribute('x'), y: +t.getAttribute('y'), s: t.textContent.trim(),
        mute: !!t.closest('.mute'), knock: t.classList.contains('knock'), anchor: getComputedStyle(t).textAnchor }));
      for (const c of svg.querySelectorAll('circle')) {
        const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
        const t = texts.find(t => !t.mute && t.x === cx && t.anchor === 'middle' && [cy, cy + 40, cy - 40].includes(t.y));
        if (!t) { labels.push(`circle at ${cx},${cy} is not labelled inside, below or above`); continue; }
        const fits = [...t.s].length <= 5;
        if (fits && t.y !== cy) labels.push(`"${t.s}" fits inside its circle`);
        if (!fits && t.y === cy) labels.push(`"${t.s}" does not fit inside its circle`);
      }
      for (const t of texts.filter(t => !t.mute)) {
        if (/\.$/.test(t.s)) labels.push(`"${t.s}" ends with a period`);
        if (/^[a-z]/.test(t.s) && !/[._/<>A-Z]/.test(t.s)) labels.push(`label "${t.s}" is not sentence case`);
        if (t.knock && /[()]/.test(t.s)) labels.push(`knockout label "${t.s}" is a parenthetical`);
      }
    }
    return { svg: svg ? svg.outerHTML.replace(/ role="img"/, '') : '', cap: cap?.textContent.trim() || '', lines, labels };
  }));
  const bad = [];
  if (figs.length > 2) bad.push(`${figs.length} diagrams, want at most 2`);
  for (const f of figs) {
    if (!f.svg) { bad.push('diagram without an svg'); continue; }
    if (!f.cap) bad.push('diagram without a caption');
    if (f.cap.length > 95) bad.push(`caption is ${f.cap.length} characters, max 95: ${f.cap}`);
    if (vp === 'desktop' && f.lines > 1) bad.push(`caption wraps to ${f.lines} lines: ${f.cap}`);
    if (/\.$/.test(f.cap)) bad.push(`caption ends with a period: ${f.cap}`);
    bad.push(...diagramProblems(f.svg), ...f.labels);
  }
  return bad;
}

test('client case matches the CV: year and role', async ({ page, path }) => {
  const bad = await cvFactProblems(page, slugOf(path));
  if (bad.length) throw new Error(bad.join('; '));
}, CV_DONE);

test('every client case has a My role section', async ({ page }) => {
  const bad = await myRoleProblems(page);
  if (bad.length) throw new Error(bad.join('; '));
}, CV_DONE);

test('client case diagrams: at most two, on spec', async ({ page, vp }) => {
  const bad = await clientDiagramProblems(page, vp);
  if (bad.length) throw new Error(bad.join('; '));
}, CV_DONE);

test('CV_PENDING holds only cases still to update', async ({ page, path, vp }) => {
  const slug = slugOf(path);
  if (!CV[slug]) throw new Error(`${slug} is not in the CV map`);
  const bad = [...await cvFactProblems(page, slug), ...await myRoleProblems(page), ...await clientDiagramProblems(page, vp)];
  if (!bad.length) throw new Error(`${slug} is done: remove it from CV_PENDING`);
}, p => CASE(p) && CV_PENDING.includes(slugOf(p)));

// Ordered by strength, not by year.
const FEATURED = ['bancor', 'lavoz', 'lede', 'ey-helix'];

test('featured client cases: Bancor, La Voz, Lede, EY Helix', async ({ page }) => {
  const rows = await page.$$eval('[aria-labelledby="g-client"] ol.featured > li > a.row', as => as.map(a => a.getAttribute('href')));
  const want = FEATURED.map(s => `work/${s}/`);
  if (rows.join() !== want.join()) throw new Error(`featured [${rows.join(', ')}], want [${want.join(', ')}]`);
  const r = await page.$$eval('[aria-labelledby="g-client"] a.row', as => as.map(a => ({
    line: a.querySelector('.line')?.textContent.trim(), meta: a.querySelector('.meta')?.textContent.trim() })));
  const bad = r.filter(x => !x.line || x.meta);
  if (bad.length) throw new Error(`${bad.length} featured rows without a summary line, or with a role and year`);
}, p => p === '/works.html');

const ALSO = Object.keys(CV).filter(s => !FEATURED.includes(s));

test('Also is one sentence of every other client case, newest first, with working links', async ({ page, base, vp }) => {
  const r = await page.evaluate(() => {
    const p = document.querySelector('[aria-labelledby="g-also"] p.run');
    return { heading: document.querySelector('#g-also')?.textContent.trim(), sentences: document.querySelectorAll('[aria-labelledby="g-also"] p').length,
      text: p && [...p.childNodes].map(n => n.nodeType === 3 ? n.textContent : n.cloneNode(true)).map(n => {
        if (typeof n === 'string') return n; n.querySelectorAll('.rl').forEach(e => e.remove()); return n.textContent; }).join('').replace(/\u00a0/g, ' '),
      items: [...document.querySelectorAll('[aria-labelledby="g-also"] .it > a')].map(a => ({
        href: a.getAttribute('href'), name: a.querySelector('.nm')?.firstChild.textContent.trim(),
        year: a.querySelector('time.yr')?.textContent, glyphFirst: a.firstElementChild?.matches('.ag') && !!a.firstElementChild.querySelector('svg'),
        role: a.querySelector('.rl')?.textContent.trim() })) };
  });
  if (r.heading !== 'Also') throw new Error(`heading reads "${r.heading}"`);
  if (r.sentences !== 1) throw new Error(`${r.sentences} paragraphs, want one sentence`);
  const got = r.items.map(i => i.href), want = ALSO.map(s => `work/${s}/`);
  if (got.join() !== want.join()) throw new Error(`Also [${got.join(', ')}], want [${want.join(', ')}]`);
  const bad = r.items.filter(i => !i.name || !/^\d{4}$/.test(i.year || '') || !i.glyphFirst);
  if (bad.length) throw new Error(`${bad.length} items lack a glyph before the name, or a year: ${bad[0].href}`);
  const sentence = r.items.map((i, k) => (k === r.items.length - 1 ? 'and ' : '') + `${i.name} ${i.year}`).join(', ').replace(/, and /, ' and ') + '.';
  if (r.text.replace(/\s+/g, ' ').trim() !== sentence) throw new Error(`reads "${r.text.trim()}", want "${sentence}"`);
  if (vp !== 'desktop') return;
  for (const i of r.items) {
    const res = await page.request.get(`${base}/${i.href}`);
    if (res.status() !== 200) throw new Error(`${i.href} answered ${res.status()}`);
    if (!(await res.text()).includes('<h1>')) throw new Error(`${i.href} has no h1`);
  }
}, p => p === '/works.html');

test('Also roles are in each link, from the case frontmatter', async ({ page }) => {
  const r = await page.$$eval('[aria-labelledby="g-also"] .it > a', as => as.map(a => ({ href: a.getAttribute('href'), role: a.querySelector('.rl')?.textContent.trim(), name: a.textContent })));
  const bad = [];
  for (const i of r) {
    const md = readFileSync(resolve(ROOT, 'contents', i.href.split('/')[1], '_.md'), 'utf8');
    const want = md.match(/^role:\s*"?(.*?)"?\s*$/m)?.[1];
    if (!want || i.role !== want) bad.push(`${i.href} role "${i.role}", want "${want}"`);
    else if (!i.name.includes(want)) bad.push(`${i.href}: role not in the link's accessible text`);
  }
  if (bad.length) throw new Error(bad.join('; '));
}, p => p === '/works.html');

test('hovering or focusing an Also name changes no glyph geometry', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const geo = () => page.$$eval('[aria-labelledby="g-also"] .ag', gs => gs.map(g => {
    const b = g.getBoundingClientRect(), svg = g.querySelector('svg'), kids = svg ? [...svg.querySelectorAll('*')] : [];
    return [b.left, b.top, b.width, b.height, svg?.getAttribute('viewBox'), getComputedStyle(g).transform, kids.length,
      kids.map(k => getComputedStyle(k).transform + getComputedStyle(k).display + (k.getAttribute('d') || '')).join('|')].join(',');
  }));
  const before = await geo();
  const n = await page.locator('[aria-labelledby="g-also"] .it > a').count();
  for (let i = 0; i < n; i++) {
    const a = page.locator('[aria-labelledby="g-also"] .it > a').nth(i);
    await a.scrollIntoViewIfNeeded();
    const scrolled = await geo();
    await a.locator('.nm').hover();
    await page.waitForTimeout(450);
    const r = await a.evaluate(a => ({ deco: getComputedStyle(a.querySelector('.nm')).textDecorationColor, role: a.querySelector('.rl').getBoundingClientRect().width,
      parts: a.querySelectorAll('.parts, [data-parts]').length }));
    if ((await geo()).join() !== scrolled.join()) throw new Error(`hovering item ${i + 1} moved or broke a glyph`);
    if (r.parts) throw new Error(`item ${i + 1} carries glyph parts`);
    if (r.role > 1) throw new Error(`item ${i + 1}: role shown on hover (${r.role}px wide)`);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(r.deco)) throw new Error(`item ${i + 1}: no underline on hover`);
    await page.mouse.move(0, 0);
    await a.focus();
    await page.waitForTimeout(300);
    if ((await geo()).join() !== scrolled.join()) throw new Error(`focusing item ${i + 1} moved or broke a glyph`);
    await a.blur();
  }
  if (!before.length) throw new Error('no Also glyphs');
}, p => p === '/works.html');

test('featured rows outweigh the Also sentence', async ({ page }) => {
  const m = await page.evaluate(() => {
    const f = document.querySelector('ol.featured a.row'), i = document.querySelector('[aria-labelledby="g-also"] .it > a');
    return { fg: f.querySelector('.glyph').getBoundingClientRect().height, ig: i.querySelector('.ag').getBoundingClientRect().height,
      fn: parseFloat(getComputedStyle(f.querySelector('.name')).fontSize), iname: parseFloat(getComputedStyle(i.querySelector('.nm')).fontSize) };
  });
  if (!(m.fg > m.ig)) throw new Error(`featured glyph ${m.fg}px, Also ${m.ig}px`);
  if (!(m.fn > m.iname)) throw new Error(`featured name ${m.fn}px, Also ${m.iname}px`);
}, p => p === '/works.html');

test('on phones the Also sentence fits and never orphans its last item', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  for (const width of [360, 375, 390, 414, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const r = await page.evaluate(() => {
      const its = [...document.querySelectorAll('[aria-labelledby="g-also"] .it')];
      const tops = its.map(it => Math.round(it.getBoundingClientRect().top));
      return { over: document.documentElement.scrollWidth - innerWidth,
        out: [...document.querySelectorAll('ol.featured a.row *, [aria-labelledby="g-also"] .it *')]
          .filter(e => { const b = e.getBoundingClientRect(); return b.width > 1 && (b.left < -0.5 || b.right > innerWidth + 0.5); }).map(e => e.className || e.tagName),
        split: its.filter(it => new Set([...it.getClientRects()].map(r => Math.round(r.bottom))).size > 1).length,
        lonely: tops.length > 1 && tops[tops.length - 1] !== tops[tops.length - 2] };
    });
    if (r.over > 0) throw new Error(`${width}: page overflows by ${r.over}px`);
    if (r.out.length) throw new Error(`${width}: ${r.out.length} parts leave the screen: ${r.out[0]}`);
    if (r.split) throw new Error(`${width}: an Also item breaks across lines`);
    if (r.lonely) throw new Error(`${width}: the last Also item sits alone on its line`);
  }
  await page.setViewportSize({ width: 375, height: 812 });
}, p => p === '/works.html');

test('featured rows show a focus ring, Also links an ink rule', async ({ page }) => {
  await page.focus('ol.featured a.row');
  if (await page.$eval('ol.featured a.row', a => getComputedStyle(a).outlineStyle) === 'none') throw new Error('featured rows have no focus outline');
  const a = page.locator('[aria-labelledby="g-also"] .it > a').first();
  await a.focus();
  const r = await a.evaluate(a => {
    const g = a.querySelector('.ag'), rule = getComputedStyle(g, '::after'), gb = g.getBoundingClientRect();
    const ink = g.querySelector('svg').getBBox(), ctm = g.querySelector('svg').getScreenCTM();
    return { vis: rule.visibility, h: parseFloat(rule.height), ink: getComputedStyle(a.querySelector('.nm')).textDecorationColor, ruleTop: gb.bottom + parseFloat(rule.top) - gb.height,
      inkBottom: (ink.y + ink.height) * ctm.d + ctm.f };
  });
  if (r.vis !== 'visible' || r.h < 2) throw new Error('focused Also link shows no rule under its glyph');
  if (r.ruleTop < r.inkBottom) throw new Error(`focus rule at ${r.ruleTop}px crosses the glyph ink (to ${r.inkBottom}px)`);
}, p => p === '/works.html');

// ── Front page (works.html) ───────────────────────────────────
// The copy lives in contents/front.md.
const SCOPE_H1 = /^Mateo Yadarola, product designer\.$/;
const THESIS = 'Give me a hard problem and a team, or just the problem.';
const CLOSER = "Hiring a product designer? Let's talk.";

test('front: name h1 beside the site links, then the thesis as the poster', async ({ page }) => {
  const r = await page.evaluate(() => ({
    h1: document.querySelector('.front .intro h1.name')?.textContent.trim(),
    home: document.querySelector('.front .intro h1.name a.home')?.getAttribute('href'),
    nav: [...document.querySelectorAll('.front .intro nav.site a')].map(a => a.getAttribute('href')),
    thesis: document.querySelector('.front .thesis')?.textContent.replace(/\u00a0/g, ' ').trim(),
    thesisPx: parseFloat(getComputedStyle(document.querySelector('.front .thesis')).fontSize),
    biggest: Math.max(...[...document.querySelectorAll('main *')].filter(e => e.closest('.thesis') === null && e.getClientRects().length).map(e => parseFloat(getComputedStyle(e).fontSize))),
    order: [...document.querySelectorAll('.front > *')].map(e => e.classList[0]) }));
  if (!SCOPE_H1.test(r.h1 || '')) throw new Error(`h1 reads "${r.h1}"`);
  if (r.home !== './') throw new Error('the name in the h1 does not link home');
  if (r.nav.join() !== '#g-client,work/about/,https://www.linkedin.com/in/myadarola/,mailto:mateo@yadarola.com.ar') throw new Error(`site links: ${r.nav.join(', ')}`);
  if (r.thesis !== THESIS) throw new Error(`thesis reads "${r.thesis}"`);
  if (!(r.thesisPx > r.biggest)) throw new Error(`thesis ${r.thesisPx}px is not the biggest type (${r.biggest}px)`);
  if (r.order.join() !== 'intro,thesis,offers') throw new Error(`front order: ${r.order.join(', ')}`);
}, p => p === '/works.html');

test('front: 4 to 6 offers, each a bold kicker, a line and proof links to existing cases', async ({ page, base, vp }) => {
  const offers = await page.$$eval('[aria-labelledby="g-offers"] li.offer', ls => ls.map(l => ({
    kicker: l.querySelector('.kicker')?.textContent.trim(),
    caps: getComputedStyle(l.querySelector('.kicker')).textTransform,
    size: parseFloat(getComputedStyle(l.querySelector('.kicker')).fontSize),
    weight: Number(getComputedStyle(l.querySelector('.kicker')).fontWeight),
    line: l.querySelector('.offer-line')?.textContent.trim(),
    links: [...l.querySelectorAll('.proof a')].map(a => a.getAttribute('href')) })));
  if (offers.length < 4 || offers.length > 6) throw new Error(`${offers.length} offers`);
  for (const o of offers) {
    if (!o.kicker || o.caps === 'uppercase' || o.size < 16 || o.weight < 600) throw new Error(`kicker "${o.kicker}" is not a bold sentence-case lead-in (${o.caps}, ${o.size}px, ${o.weight})`);
    if (!o.line) throw new Error(`"${o.kicker}" has no line`);
    if (!o.links.length) throw new Error(`"${o.kicker}" links to no case`);
    const bad = o.links.find(h => !/^work\/[a-z0-9-]+\/$/.test(h) || !existsSync(resolve(ROOT, h, 'index.html')));
    if (bad) throw new Error(`"${o.kicker}" links to ${bad}, which is no case page`);
  }
  if (vp !== 'desktop') return;
  for (const h of new Set(offers.flatMap(o => o.links))) {
    const res = await page.request.get(`${base}/${h}`);
    if (res.status() !== 200 || !(await res.text()).includes('<h1>')) throw new Error(`${h} is not a case page`);
  }
}, p => p === '/works.html');

test('front: offers sit between the opening and the featured cases', async ({ page }) => {
  const ok = await page.evaluate(() => {
    const [i, o, c] = ['.intro', '[aria-labelledby="g-offers"]', '[aria-labelledby="g-client"]'].map(s => document.querySelector(s));
    return !!(i && o && c) && (i.compareDocumentPosition(o) & 4) && (o.compareDocumentPosition(c) & 4);
  });
  if (!ok) throw new Error('offers are not between the intro and the client cases');
}, p => p === '/works.html');

test('front: How I work leads with the uncomfortable-questions line; the signature closes on the hiring ask', async ({ page }) => {
  const r = await page.evaluate(() => ({
    how: document.querySelector('[aria-labelledby="g-how"] h2.how-line')?.textContent.trim(),
    cols: [...document.querySelectorAll('[aria-labelledby="g-how"] .how-cols p')].map(p => p.textContent.trim()),
    ask: document.querySelector('footer.sig .sig-ask')?.textContent.replace(/\u00a0/g, ' ').trim(),
    avail: document.querySelector('footer.sig .sig-avail')?.textContent.trim() }));
  if (r.how !== "I'm a designer. Usually that means asking uncomfortable questions until something gets simpler.") throw new Error(`How I work reads "${r.how}"`);
  if (r.cols.length !== 1 || !/^Based in Córdoba/.test(r.cols[0]) || /Banco de Córdoba|Continental|Valora|EY|La Voz/.test(r.cols.join(' '))) throw new Error(`How I work columns read ${JSON.stringify(r.cols)}`);
  if (r.ask !== CLOSER) throw new Error(`signature ask reads "${r.ask}"`);
  if (!/remote/i.test(r.avail || '')) throw new Error(`signature availability reads "${r.avail}"`);
}, p => p === '/works.html');

test('front: no unconfirmed claims, no em dashes', async ({ page }) => {
  const t = await page.evaluate(() => [...document.querySelectorAll('.intro, [aria-labelledby="g-offers"], [aria-labelledby="g-how"], footer.sig')].map(e => e.textContent).join(' '));
  const m = t.match(/nine tools|70,000|\b112\b|selfie|research on unbanked|design lead|\u2014/i);
  if (m) throw new Error(`front copy carries "${m[0]}"`);
}, p => p === '/works.html');

test('at 390 the opening and offers fit the screen', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  await page.setViewportSize({ width: 390, height: 844 });
  const r = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - innerWidth,
    out: [...document.querySelectorAll('.intro *, [aria-labelledby="g-offers"] *, [aria-labelledby="g-how"] *, footer.sig .sig-poster *')]
      .filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.left < -0.5 || b.right > innerWidth + 0.5); })
      .map(e => e.className || e.tagName) }));
  await page.setViewportSize({ width: 375, height: 812 });
  if (r.over > 0) throw new Error(`page overflows by ${r.over}px`);
  if (r.out.length) throw new Error(`${r.out.length} parts leave the screen: ${r.out[0]}`);
}, p => p === '/works.html');

test('offer proof links show a focus ring', async ({ page }) => {
  await page.focus('[aria-labelledby="g-offers"] .proof a');
  const style = await page.$eval('[aria-labelledby="g-offers"] .proof a', a => getComputedStyle(a).outlineStyle);
  if (style === 'none') throw new Error('proof link has no focus outline');
}, p => p === '/works.html');

// ── Front page motion (front.js) ──────────────────────────────
// A fresh page per check, so emulation and the rAF probe start clean.
async function frontPage(page, opts = {}) {
  const ctx = await page.context().browser().newContext({ viewport: opts.viewport || { width: 1440, height: 900 },
    reducedMotion: opts.reduce ? 'reduce' : 'no-preference', javaScriptEnabled: opts.js !== false });
  const p = await ctx.newPage();
  // Every requestAnimationFrame call, by time: the probe for a sleeping loop.
  await p.addInitScript(() => {
    window.__frames = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { window.__frames.push(performance.now()); return raf(cb); };
  });
  await p.goto(page.url().replace(/#.*$/, ''), { waitUntil: 'load' });
  if (opts.js !== false) {
    await p.evaluate(() => document.fonts.ready);
    // front.js starts once Inter is in; wide, it hangs the sentences (.hung).
    await p.waitForFunction(() => document.querySelector('.offers.live') && (innerWidth < 900 || document.querySelector('.offers.hung')));
  }
  return { p, close: () => ctx.close() };
}

async function frontFrames(p, ms) {
  return p.evaluate(ms => new Promise(r => { const t0 = performance.now(), n0 = window.__frames.length;
    setTimeout(() => r(window.__frames.slice(n0).map(t => t - t0)), ms); }), ms);
}

test('front: switching offers shows that offer and its working proof links', async ({ page, base, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.keyboard.press('Shift');
    const n = await p.locator('.offers .offer').count();
    for (let i = 0; i < n; i++) {
      await p.locator('.offers .offer .kicker button').nth(i).click();
      await p.waitForTimeout(900);
      const r = await p.evaluate(i => {
        const o = document.querySelectorAll('.offers .offer')[i];
        const vis = e => { const cs = getComputedStyle(e), b = e.getBoundingClientRect(); return cs.visibility === 'visible' && +cs.opacity > 0.9 && b.width > 0; };
        return { open: o.classList.contains('on'), expanded: o.querySelector('button').getAttribute('aria-current'),
          others: [...document.querySelectorAll('.offers .offer.on')].length,
          line: vis(o.querySelector('.offer-line')), links: [...o.querySelectorAll('.proof a')].filter(vis).map(a => a.getAttribute('href')),
          want: o.dataset.proof.split(' ').map(s => `work/${s}/`),
          glyphs: [...document.querySelectorAll('.stage .gl:not(.off)')].map(g => g.getAttribute('href')) };
      }, i);
      if (!r.open || r.expanded !== 'true' || r.others !== 1) throw new Error(`offer ${i + 1} did not open alone (aria-current ${r.expanded})`);
      if (!r.line || r.links.join() !== r.want.join()) throw new Error(`offer ${i + 1} shows links [${r.links.join(', ')}], want [${r.want.join(', ')}]`);
      if (r.glyphs.join() !== r.want.join()) throw new Error(`offer ${i + 1} shows glyphs [${r.glyphs.join(', ')}], want [${r.want.join(', ')}]`);
      for (const h of r.links) {
        const res = await p.request.get(`${base}/${h}`);
        if (res.status() !== 200) throw new Error(`${h} answered ${res.status()}`);
      }
    }
  } finally { await close(); }
}, p => p === '/works.html');

test('front: the frame loop sleeps when nothing moves', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.keyboard.press('Shift'); // ends the unattended tour
    await p.waitForTimeout(2500);    // the load assembly is done
    const f = await frontFrames(p, 9000);
    const gaps = f.map((t, i) => (i ? t - f[i - 1] : t)).concat(9000 - (f[f.length - 1] || 0));
    if (f.length > 0.6 * 9 * 60) throw new Error(`${f.length} frames in 9s: the loop never sleeps`);
    if (Math.max(...gaps) < 2500) throw new Error(`longest frame-free stretch is ${Math.round(Math.max(...gaps))}ms`);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(3200); // the signature's glyphs arrive, then its loop sleeps too
    const off = await frontFrames(p, 7000);
    if (off.length > 2) throw new Error(`${off.length} frames in 7s with the offers out of view`);
  } finally { await close(); }
}, p => p === '/works.html');

// requestAnimationFrame is wrapped so each sample is read right after
// front.js sets that frame's transforms. A loop of its own samples the
// frames where front.js sleeps, so every step keeps its true frame time.
async function partFrames(p, ms, act) {
  await p.evaluate(() => {
    window.__parts = [];
    const re = /translate\(([-\d.]+)px, ?([-\d.]+)px\)/, sc = /scale\(([-\d.]+)\)/;
    const read = ts => {
      if (!window.__parts) return;
      const f = { ts, gl: [...document.querySelectorAll('.stage .gl')].map(g => {
        const kids = [...g.children], whole = kids.pop(), z = +(sc.exec(g.style.transform) || [0, 1])[1];
        const split = whole.style.display === 'none';
        return { h: g.getAttribute('href'), off: g.classList.contains('off'), n: kids.length, split,
          xy: kids.map(s => { const m = split && re.exec(s.style.transform); return m ? [m[1] * z, m[2] * z] : [0, 0]; }) };
      }) };
      const log = window.__parts;
      if (log.length && log[log.length - 1].ts === ts) log[log.length - 1] = f; else log.push(f);
    };
    window.__rafPlain = window.__rafPlain || window.requestAnimationFrame;
    const raf = window.__rafPlain;
    window.requestAnimationFrame = cb => raf(ts => { cb(ts); read(ts); });
    const beat = ts => { if (!window.__parts) return; read(ts); raf(beat); };
    raf(beat);
  });
  if (act) await act();
  await p.waitForTimeout(ms);
  return p.evaluate(() => { const f = window.__parts; window.__parts = null; window.requestAnimationFrame = window.__rafPlain; return f; });
}

function speeds(frames, href) {
  const out = [];
  let prev = null;
  for (const f of frames) {
    const g = f.gl.find(x => x.h === href);
    if (!g || g.off) { prev = null; continue; }
    if (prev) out.push(Math.max(...g.xy.map((q, i) => Math.hypot(q[0] - prev.xy[i][0], q[1] - prev.xy[i][1]))) / Math.max(1, (f.ts - prev.ts) / 16.667));
    prev = { xy: g.xy, ts: f.ts };
  }
  return out;
}

test('front: on a switch every glyph moves in parts, starting and stopping without a jolt', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.keyboard.press('Shift');
    await p.waitForTimeout(2200);
    const offers = await p.$$eval('.offers .offer', os => os.map(o => o.dataset.proof.split(' ').map(s => `work/${s}/`)));
    const frames = await partFrames(p, 1600, () => p.locator('.offers .offer .kicker button').nth(1).click());
    for (const href of [...offers[0], ...offers[1]]) {
      const g = frames.at(-1).gl.find(x => x.h === href);
      if (g.n < 2) throw new Error(`${href} has ${g.n} part`);
      const v = speeds(frames, href), moving = v.map((s, i) => s > 0.05 ? i : -1).filter(i => i >= 0);
      if (!moving.length) throw new Error(`${href} never moved in parts`);
      const peak = Math.max(...v), first = v[moving[0]], last = v[moving.at(-1)];
      // From rest and back to rest: the first and last steps are small next
      // to the peak (or under 1.5px, for a late frame under load), and once
      // under way no frame leaps past the one before (a snap).
      if (first > 0.6 * peak && first > 1.5) throw new Error(`${href} sets off at ${first.toFixed(1)}px/frame (peak ${peak.toFixed(1)})`);
      if (last > 0.35 * peak && last > 1.5) throw new Error(`${href} stops from ${last.toFixed(1)}px/frame (peak ${peak.toFixed(1)})`);
      for (let i = 1; i < v.length; i++) {
        if (v[i - 1] > 1 && v[i] > 2 * v[i - 1] + 1) throw new Error(`${href} jumps ${v[i].toFixed(1)}px after ${v[i - 1].toFixed(1)}px at frame ${i}`);
      }
    }
    // Arrived: every open glyph rests as its whole (a breath may come first).
    await p.waitForFunction(want => want.every(h => { const g = document.querySelector(`.stage .gl[href="${h}"]`);
      return !g.classList.contains('off') && g.lastElementChild.style.display !== 'none'; }), offers[1], { timeout: 4000 })
      .catch(() => { throw new Error('the new cluster never came to rest as whole glyphs'); });
  } finally { await close(); }
}, p => p === '/works.html');

test('front: every glyph in the open cluster answers the pointer and breathes', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.keyboard.press('Shift');
    await p.locator('.offers .offer .kicker button').nth(1).click();
    await p.waitForTimeout(1500);
    const boxes = await p.$$eval('.stage .gl:not(.off)', gs => gs.map(g => { const r = g.getBoundingClientRect(); return { h: g.getAttribute('href'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    if (boxes.length < 3) throw new Error(`${boxes.length} glyphs open`);
    for (const b of boxes) {
      await p.mouse.move(b.x + 4, b.y + 4, { steps: 4 });
      await p.waitForTimeout(600);
      const split = await p.$eval(`.stage .gl[href="${b.h}"]`, g => g.lastElementChild.style.display === 'none');
      if (!split) throw new Error(`${b.h} ignores the pointer over it`);
    }
    await p.mouse.move(4, 890, { steps: 3 });
    await p.waitForTimeout(1500);
    const frames = await partFrames(p, 7000);
    const still = boxes.filter(b => !frames.some(f => f.gl.find(g => g.h === b.h).split));
    if (still.length) throw new Error(`no breath in 7s from ${still.map(b => b.h).join(', ')}`);
    // The 7s window may end mid-breath, so wait for the whole glyphs.
    await p.waitForFunction(() => [...document.querySelectorAll('.stage .gl:not(.off)')].every(g => g.lastElementChild.style.display !== 'none'), null, { timeout: 4000 })
      .catch(() => { throw new Error('a glyph rests in parts after its breath'); });
  } finally { await close(); }
}, p => p === '/works.html');

test('front: reduced motion shows the still cluster and draws no frames', async ({ page, vp }) => {
  const viewport = vp === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const { p, close } = await frontPage(page, { reduce: true, viewport });
  try {
    await p.waitForTimeout(300);
    const f = await frontFrames(p, 1500);
    const r = await p.evaluate(() => {
      const first = document.querySelector('.offers .offer');
      return { want: first.dataset.proof.split(' ').length,
        shown: [...document.querySelectorAll('.gl:not(.off)')].map(g => ({ href: g.getAttribute('href'),
          whole: getComputedStyle(g.lastElementChild).display !== 'none',
          parts: [...g.children].slice(0, -1).filter(s => getComputedStyle(s).display !== 'none').length,
          t: g.style.transform })) };
    });
    if (f.length) throw new Error(`${f.length} frames drawn under reduced motion`);
    if (r.shown.length !== r.want) throw new Error(`${r.shown.length} glyphs shown, want ${r.want}`);
    const torn = r.shown.find(g => !g.whole || g.parts);
    if (torn) throw new Error(`${torn.href} rests in parts`);
  } finally { await close(); }
}, p => p === '/works.html');

test('front: at rest the thesis reads clean, the cluster hangs right under it', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
    const { p, close } = await frontPage(page, { reduce: true, viewport });
    try {
      const r = await p.evaluate(() => {
        const th = document.querySelector('.front .thesis'), cs = getComputedStyle(th);
        const bottom = th.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom);
        const gl = [...document.querySelectorAll('.stage .gl:not(.off)')].map(g => g.getBoundingClientRect());
        return { bottom, em: parseFloat(cs.fontSize), top: Math.min(...gl.map(b => b.top)), over: th.scrollWidth - th.clientWidth };
      });
      if (r.over > 1) throw new Error(`at ${viewport.width} the thesis runs ${r.over}px past its column`);
      if (r.top < r.bottom + 0.05 * r.em) throw new Error(`at ${viewport.width} the cluster (top ${Math.round(r.top)}) sits on the thesis (bottom ${Math.round(r.bottom)})`);
      if (r.top > r.bottom + 0.6 * r.em) throw new Error(`at ${viewport.width} the cluster (top ${Math.round(r.top)}) has lost the thesis (bottom ${Math.round(r.bottom)})`);
    } finally { await close(); }
  }
}, p => p === '/works.html');

test('front: on a laptop screen the open offer shows a case link above the fold', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 780 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    const { p, close } = await frontPage(page, { reduce: true, viewport });
    try {
      const r = await p.evaluate(() => ({ link: document.querySelector('.offers .offer.on .proof a').getBoundingClientRect().bottom,
        lead: Math.max(...[...document.querySelectorAll('.stage .gl:not(.off)')].map(g => g.getBoundingClientRect().width)) }));
      if (r.link > viewport.height) throw new Error(`at ${viewport.width}x${viewport.height} the first case link ends at ${Math.round(r.link)}px`);
      if (r.lead < 159) throw new Error(`at ${viewport.width}x${viewport.height} the lead glyph is ${Math.round(r.lead)}px`);
    } finally { await close(); }
  }
}, p => p === '/works.html');

test('front: on a phone the first offer is open with its case link on the first screen', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  const { p, close } = await frontPage(page, { viewport: { width: 390, height: 844 } });
  try {
    await p.waitForTimeout(1600);
    const r = await p.evaluate(() => {
      const o = document.querySelector('.offers .offer');
      const a = o.querySelector('.proof a').getBoundingClientRect();
      return { on: o.classList.contains('on'), linkBottom: a.bottom, h: innerHeight,
        over: document.documentElement.scrollWidth - innerWidth,
        room: [...o.querySelectorAll('.room .gl:not(.off)')].length, want: o.dataset.proof.split(' ').length,
        email: getComputedStyle(document.querySelector('.site .short')).display !== 'none' && getComputedStyle(document.querySelector('.site .long')).display === 'none' };
    });
    if (!r.on) throw new Error('the first offer is closed');
    if (r.linkBottom > r.h) throw new Error(`the first case link ends at ${Math.round(r.linkBottom)}px, below the ${r.h}px screen`);
    if (r.room !== r.want) throw new Error(`${r.room} glyphs in the open offer, want ${r.want}`);
    if (r.over > 0) throw new Error(`page overflows by ${r.over}px`);
    if (!r.email) throw new Error('the header shows the full email address on a phone');
    await p.locator('.offers .offer .kicker button').first().click();
    if (await p.locator('.offers .offer.on').count()) throw new Error('a tap on the open offer did not close it');
    const exp = await p.locator('.offers .offer .kicker button').first().getAttribute('aria-expanded');
    if (exp !== 'false') throw new Error(`closed disclosure says aria-expanded="${exp}"`);
  } finally { await close(); }
}, p => p === '/works.html');

test('front: without JS every offer reads open with its proof links', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page, { js: false });
  try {
    const r = await p.evaluate(() => [...document.querySelectorAll('.offers .offer')].map(o => ({
      line: o.querySelector('.offer-line').getBoundingClientRect().height > 0 && getComputedStyle(o.querySelector('.detail')).visibility === 'visible',
      links: o.querySelectorAll('.proof a').length, button: !!o.querySelector('button') })));
    if (r.length < 4) throw new Error(`${r.length} offers`);
    if (r.some(o => !o.line || !o.links)) throw new Error('an offer hides its line or links without JS');
    if (r.some(o => o.button)) throw new Error('kickers render as buttons without JS');
  } finally { await close(); }
}, p => p === '/works.html');

test('front: if front.js never runs, every offer reads open once the page loads', async ({ page, vp }) => {
  const viewport = vp === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const ctx = await page.context().browser().newContext({ viewport });
  const p = await ctx.newPage();
  try {
    await p.route(/\/front\.js$/, r => r.abort());
    await p.goto(page.url(), { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ js: document.documentElement.classList.contains('js'),
      shown: [...document.querySelectorAll('.offers .proof a')].filter(a => { const cs = getComputedStyle(a.closest('.detail')); return cs.visibility === 'visible' && +cs.opacity > 0.9 && a.getBoundingClientRect().height > 0; }).length,
      all: document.querySelectorAll('.offers .proof a').length }));
    if (r.js || r.shown !== r.all) throw new Error(`${r.shown} of ${r.all} proof links reachable without front.js`);
  } finally { await ctx.close(); }
}, p => p === '/works.html');

test('front: heading from a title to its proof link opens nothing on the way', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    for (const steps of [18, 36]) {
      const { p, close } = await frontPage(page, { viewport });
      try {
        await p.waitForTimeout(1200);
        const t = await p.locator('.offers .offer').first().locator('.kicker .t').boundingBox();
        const a = await p.locator('.offers .offer').first().locator('.proof a').first().boundingBox();
        await p.mouse.move(t.x + 40, t.y + t.height / 2);
        await p.waitForTimeout(200);
        await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps });
        await p.waitForTimeout(400);
        const r = await p.evaluate(([x, y]) => ({ open: [...document.querySelectorAll('.offers .offer')].findIndex(o => o.classList.contains('on')),
          under: document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') }), [a.x + a.width / 2, a.y + a.height / 2]);
        if (r.open !== 0 || r.under !== 'work/valora/') throw new Error(`at ${viewport.width}, ${steps} steps: offer ${r.open + 1} open, ${r.under} under the pointer`);
      } finally { await close(); }
    }
  }
}, p => p === '/works.html');

test('front: Tab and Shift+Tab reach every proof link in order', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.waitForTimeout(800);
    await p.locator('.offers .offer .kicker button').first().focus();
    const want = await p.$$eval('.offers .offer', os => os.flatMap(o => [o.querySelector('button').textContent.trim(), ...[...o.querySelectorAll('.proof a')].map(a => a.getAttribute('href'))]));
    const seen = [];
    const where = () => p.evaluate(() => { const e = document.activeElement; return e.tagName === 'BUTTON' ? e.textContent.trim() : e.getAttribute('href'); });
    seen.push(await where());
    for (let i = 1; i < want.length; i++) { await p.keyboard.press('Tab'); seen.push(await where()); }
    if (seen.join('|') !== want.join('|')) throw new Error(`Tab order: ${seen.join(', ')}`);
    const back = [];
    for (let i = 1; i < want.length; i++) { await p.keyboard.press('Shift+Tab'); back.push(await where()); }
    if (back.join('|') !== want.slice(0, -1).reverse().join('|')) throw new Error(`Shift+Tab order: ${back.join(', ')}`);
    await p.waitForTimeout(700);
    const shown = await p.evaluate(() => { const o = document.activeElement.closest('.offer'); return o.classList.contains('on') && +getComputedStyle(o.querySelector('.detail')).opacity > 0.9; });
    if (!shown) throw new Error('the focused offer is not the open one');
  } finally { await close(); }
}, p => p === '/works.html');

test('front: the unattended tour never moves a focused reader', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await frontPage(page);
  try {
    await p.locator('.offers .offer').first().locator('.proof a').first().evaluate(a => a.focus());
    await p.waitForTimeout(8500);
    const r = await p.evaluate(() => ({ open: [...document.querySelectorAll('.offers .offer')].findIndex(o => o.classList.contains('on')),
      focus: document.activeElement.getAttribute('href') }));
    if (r.open !== 0 || r.focus !== 'work/valora/') throw new Error(`offer ${r.open + 1} open, focus on ${r.focus}`);
  } finally { await close(); }
}, p => p === '/works.html');

test('front: every visible word is 15px or larger, none in caps', async ({ page }) => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('.front *, [aria-labelledby="g-how"] *, footer.sig *')]
    .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.sr') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(e => { const cs = getComputedStyle(e); return parseFloat(cs.fontSize) < 15 || cs.textTransform === 'uppercase'; })
    .map(e => `${e.textContent.trim().slice(0, 24)} (${getComputedStyle(e).fontSize})`));
  if (bad.length) throw new Error(`${bad.length} small or caps labels: ${bad.slice(0, 3).join(' | ')}`);
}, p => p === '/works.html');

test('front: closed offers read as text, not disabled', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const r = await page.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const b = document.querySelector('.offers .offer:not(.on) .kicker button');
    const fg = lum(getComputedStyle(b).color), bg = lum(getComputedStyle(document.body).backgroundColor);
    return { ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), weight: +getComputedStyle(b).fontWeight };
  });
  if (r.ratio < 4.5) throw new Error(`closed offers contrast ${r.ratio.toFixed(2)}:1`);
  if (r.weight < 600) throw new Error(`closed offers set at ${r.weight}`);
}, p => p === '/works.html');

// ── Signature footer (foot.js) ────────────────────────────────
async function sigPage(page, opts = {}) {
  const { p, close } = await frontPage(page, opts);
  if (opts.js !== false) {
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(opts.reduce ? 400 : 3200);
  }
  return { p, close };
}

const sigOverlap = p => p.evaluate(() => {
  const fr = document.querySelector('.sig-ring').getBoundingClientRect(), rects = [];
  for (const el of document.querySelectorAll('.sig-ask, .sig-mail, .sig-more, .sig-avail')) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = document.createRange();
    let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; r.selectNodeContents(n); rects.push(...r.getClientRects()); }
  }
  const hits = [], hidden = [];
  for (const a of document.querySelectorAll('.sig-g')) {
    const cv = a.querySelector('canvas'), M = new DOMMatrix(getComputedStyle(a).transform);
    if (!cv || !cv.width || Math.hypot(M.a, M.b) < 0.5) { hidden.push(a.dataset.name); continue; }
    const box = parseFloat(a.style.width), n = cv.width;
    const T = new DOMMatrix().translate(fr.left + box / 2, fr.top + box / 2).multiply(M).translate(-box / 2, -box / 2);
    const px = cv.getContext('2d').getImageData(0, 0, n, n).data;
    let k = 0;
    for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
      if (px[(y * n + x) * 4 + 3] < 128) continue;
      const q = T.transformPoint(new DOMPoint(-0.3 * box + (x + 0.5) / n * 1.6 * box, -0.3 * box + (y + 0.5) / n * 1.6 * box));
      if (rects.some(r => q.x > r.left && q.x < r.right && q.y > r.top && q.y < r.bottom)) k++;
    }
    if (k) hits.push(`${a.dataset.name} (${k} px)`);
  }
  return { hits, hidden };
});

test('signature: the hiring ask, the underlined address, LinkedIn and GitHub', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await sigPage(page);
  try {
    const r = await p.evaluate(() => {
      const f = document.querySelector('footer.sig'), accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const probe = document.createElement('i'); probe.style.color = accent; f.append(probe);
      const ac = getComputedStyle(probe).color; probe.remove();
      return { ask: f.querySelector('.sig-ask').textContent.replace(/ /g, ' ').trim(),
        talk: f.querySelector('.sig-ask a')?.getAttribute('href'),
        mail: f.querySelector('.sig-mail')?.getAttribute('href'), mailText: f.querySelector('.sig-mail')?.textContent,
        more: [...f.querySelectorAll('.sig-more a')].map(a => a.getAttribute('href')),
        accented: [...f.querySelectorAll('.sig-poster *')].filter(e => getComputedStyle(e).textDecorationLine.includes('underline') && getComputedStyle(e).textDecorationColor === ac).map(e => e.className || e.tagName),
        skip: getComputedStyle(f.querySelector('.sig-mail')).textDecorationSkipInk };
    });
    if (r.ask !== CLOSER) throw new Error(`ask reads "${r.ask}"`);
    if (r.talk !== 'mailto:mateo@yadarola.com.ar') throw new Error(`Let's talk opens ${r.talk}`);
    if (r.mail !== 'mailto:mateo@yadarola.com.ar' || r.mailText !== 'mateo@yadarola.com.ar') throw new Error(`address link: ${r.mail} "${r.mailText}"`);
    if (r.more.join() !== 'https://www.linkedin.com/in/myadarola/,https://github.com/sryo') throw new Error(`links: ${r.more.join(', ')}`);
    if (!r.accented.includes('sig-mail')) throw new Error('the address is not underlined');
    if (r.skip !== 'none') throw new Error('the address underline skips ink (leaves a dot under the @)');
  } finally { await close(); }
}, p => p === '/works.html');

test('signature: at rest every glyph is out and none touches the poster text', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const { p, close } = await sigPage(page, { viewport });
    try {
      const r = await sigOverlap(p);
      if (r.hidden.length) throw new Error(`at ${viewport.width}, ${r.hidden.length} glyphs never arrived: ${r.hidden.slice(0, 3).join(', ')}`);
      if (r.hits.length) throw new Error(`at ${viewport.width}, glyphs rest on the text: ${r.hits.join(', ')}`);
    } finally { await close(); }
  }
}, p => p === '/works.html');

test('signature: the poster fits one screen at 1440x900', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await sigPage(page);
  try {
    const r = await p.evaluate(() => { const b = document.querySelector('.sig-poster').getBoundingClientRect(); return { t: b.top, b: b.bottom }; });
    if (r.t < 0 || r.b > 900) throw new Error(`poster spans ${Math.round(r.t)} to ${Math.round(r.b)}px`);
  } finally { await close(); }
}, p => p === '/works.html');

test('signature: the frame loop sleeps once the glyphs settle', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await sigPage(page);
  try {
    const f = await frontFrames(p, 3000);
    if (f.length > 4) throw new Error(`${f.length} frames in 3s at rest`);
  } finally { await close(); }
}, p => p === '/works.html');

test('signature: reduced motion shows the still frame and draws no frames', async ({ page, vp }) => {
  const viewport = vp === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const { p, close } = await sigPage(page, { reduce: true, viewport });
  try {
    const f = await frontFrames(p, 1500);
    const r = await sigOverlap(p);
    if (f.length > 2) throw new Error(`${f.length} frames in 1.5s`);
    if (r.hidden.length) throw new Error(`${r.hidden.length} glyphs not drawn: ${r.hidden.slice(0, 3).join(', ')}`);
    if (r.hits.length) throw new Error(`glyphs rest on the text: ${r.hits.join(', ')}`);
  } finally { await close(); }
}, p => p === '/works.html');

test('signature: on a phone nothing scrolls sideways and side glyphs stay 60% on screen', async ({ page, vp }) => {
  if (vp !== 'mobile') return;
  const { p, close } = await sigPage(page, { viewport: { width: 390, height: 844 } });
  try {
    const r = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth,
      cut: [...document.querySelectorAll('.sig-g canvas')].map(c => {
        const a = c.parentNode, M = new DOMMatrix(getComputedStyle(a).transform), box = parseFloat(a.style.width), n = c.width;
        const fr = document.querySelector('.sig-ring').getBoundingClientRect();
        const T = new DOMMatrix().translate(fr.left + box / 2, fr.top + box / 2).multiply(M).translate(-box / 2, -box / 2);
        const px = c.getContext('2d').getImageData(0, 0, n, n).data;
        let l = Infinity, rr = -Infinity;
        for (let y = 0; y < n; y += 3) for (let x = 0; x < n; x += 3) {
          if (px[(y * n + x) * 4 + 3] < 128) continue;
          const q = T.transformPoint(new DOMPoint(-0.3 * box + x / n * 1.6 * box, -0.3 * box + y / n * 1.6 * box));
          l = Math.min(l, q.x); rr = Math.max(rr, q.x);
        }
        const on = Math.min(rr, innerWidth) - Math.max(l, 0);
        return { name: a.dataset.name, share: on / (rr - l) };
      }).filter(g => g.share < 0.55) }));
    if (r.over > 0) throw new Error(`page overflows by ${r.over}px`);
    if (r.cut.length) throw new Error(`glyphs mostly off screen: ${r.cut.map(g => `${g.name} ${Math.round(g.share * 100)}%`).join(', ')}`);
  } finally { await close(); }
}, p => p === '/works.html');

test('signature: without JS the glyphs read as rows of links under the poster', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const { p, close } = await sigPage(page, { js: false });
  try {
    const r = await p.evaluate(() => {
      const poster = document.querySelector('.sig-poster').getBoundingClientRect();
      const g = [...document.querySelectorAll('.sig-g')].map(a => a.getBoundingClientRect());
      return { n: g.length, below: g.every(b => b.top >= poster.bottom && b.width >= 64) };
    });
    if (r.n < 8 || !r.below) throw new Error(`${r.n} glyphs, all under the poster: ${r.below}`);
  } finally { await close(); }
}, p => p === '/works.html');

test('CV_PENDING names only known cases', async () => {
  const unknown = CV_PENDING.filter(s => !CV[s]);
  if (unknown.length) throw new Error(`unknown slugs in CV_PENDING: ${unknown.join(', ')}`);
}, p => p === '/works.html');

test('spec Year shows the year only', async ({ page }) => {
  const t = await page.$eval('.spec dl time', t => ({ text: t.textContent.trim(), dt: t.getAttribute('datetime') }));
  if (!/^\d{4}$/.test(t.text)) throw new Error(`Year reads "${t.text}"`);
  if (!/^\d{4}$/.test(t.dt)) throw new Error(`datetime is "${t.dt}"`);
  const cells = await page.$$eval('.spec dd', ds => ds.map(d => d.textContent));
  const month = cells.find(c => MONTHS.test(c));
  if (month) throw new Error(`spec cell names a month: ${month}`);
}, CASE);

test('no part holds only the closing CTA', async ({ page }) => {
  const hollow = await page.$$eval('section.part', ss => ss.filter(s => {
    const b = s.querySelector('.body').cloneNode(true);
    b.querySelectorAll('a[href*="linkedin.com"]').forEach(a => a.closest('p')?.remove());
    return !b.textContent.trim() && !b.querySelector('img, iframe, a');
  }).map(s => s.querySelector('h2')?.textContent || '(lead)'));
  if (hollow.length) throw new Error(`hollow parts: ${hollow.join(', ')}`);
}, CASE);

test('one closing CTA row sits right before the pager', async ({ page }) => {
  const r = await page.evaluate(() => {
    const ctas = document.querySelectorAll('.case-cta');
    const main = document.querySelector('main');
    const a = ctas[0]?.querySelector('a[href*="linkedin.com"]');
    return { n: ctas.length, last: main.lastElementChild?.matches('.case-cta'), pn: main.nextElementSibling?.matches('.pn'),
      text: a?.textContent.trim(), label: a?.getAttribute('aria-label'),
      inBody: document.querySelectorAll('.part a[href*="linkedin.com"]').length };
  });
  if (r.n !== 1) throw new Error(`${r.n} .case-cta`);
  if (!r.last || !r.pn) throw new Error('.case-cta is not directly before the pager');
  if (r.text !== "Let's talk") throw new Error(`CTA link reads "${r.text}"`);
  if (r.label !== "Let's talk on LinkedIn") throw new Error(`CTA aria-label is "${r.label}"`);
  if (r.inBody) throw new Error(`${r.inBody} LinkedIn links left in the body`);
}, CASE);

test('OMSNIC says hours-to-minutes once', async ({ page }) => {
  const t = await page.textContent('main');
  if (t.includes('The process that took hours now takes minutes.')) throw new Error('duplicate Results sentence');
}, p => p === '/work/omsnic/');

test('About stays compact: one entry per side project, no embeds', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h >= 6000) throw new Error(`About is ${h}px tall`);
  const r = await page.evaluate(() => ({ items: document.querySelectorAll('.item').length,
    heavy: document.querySelectorAll('.items iframe, .items .embed-facade, .items figure').length,
    links: [...document.querySelectorAll('.item h3 a')].map(a => a.getAttribute('href')) }));
  if (r.heavy) throw new Error(`${r.heavy} embeds or figures on About`);
  const bad = r.links.filter(h => !/^\.\.\/[a-z0-9-]+\/$/.test(h));
  if (bad.length) throw new Error(`item links leave the site: ${bad[0]}`);
}, p => p === '/work/about/');

test('Figma facades are one-line rows; a loaded one is 16/10', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const tall = await page.$$eval('a.embed-facade', as => as.map(a => a.offsetHeight).filter(x => x > 48));
  if (tall.length) throw new Error(`${tall.length} facades taller than 48px (${tall[0]}px)`);
  await page.locator('a.embed-facade').first().click();
  const box = await page.$eval('iframe.embed-live', f => { const b = f.getBoundingClientRect(); return b.width / b.height; });
  await page.reload();
  if (Math.abs(box - 1.6) > 0.02) throw new Error(`live iframe ratio ${box.toFixed(2)}, want 16/10`);
}, p => p === '/work/murmur/');

const ORDER = ['Impact', 'Context', 'My role', 'Decisions', 'Outcome', 'Reflection'];
test('sections follow the shared case order', async ({ page }) => {
  const labels = await page.$$eval('main h2', hs => hs.map(h => h.textContent.trim()));
  let i = 0;
  for (const l of labels) {
    const at = ORDER.indexOf(l, i);
    if (at < 0) throw new Error(`"${l}" out of order or not allowed in [${labels.join(', ')}]`);
    i = at + 1;
  }
  const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', hs => hs.map(h => Number(h.tagName[1])));
  for (let k = 1; k < levels.length; k++) {
    if (levels[k] > levels[k - 1] + 1) throw new Error(`heading jumps h${levels[k - 1]} → h${levels[k]}`);
  }
  if (levels[0] !== 1) throw new Error(`first heading is h${levels[0]}`);
}, CASE);

test('Decisions are named in readable h3 heads', async ({ page }) => {
  const heads = await page.$$eval('section.part', ss => ss
    .filter(s => s.querySelector('h2')?.textContent.trim() === 'Decisions')
    .flatMap(s => [...s.querySelectorAll('h3')].map(h => ({ text: h.textContent, px: parseFloat(getComputedStyle(h).fontSize) }))));
  if (!heads.length) throw new Error('no h3 under Decisions');
  const small = heads.filter(h => h.px < 20);
  if (small.length) throw new Error(`"${small[0].text}" is ${small[0].px}px`);
  const all = await page.$$eval('main h3', hs => hs.map(h => h.textContent));
  const digit = all.find(t => /\d/.test(t));
  if (digit) throw new Error(`h3 carries a number: ${digit}`);
}, CASE);

const DECISIONS = {
  lede: ['People, not requests', 'The sentence comes first', 'A texture as well as a color'],
  bancor: ['Logical accounts instead of paperwork', 'Listening first, before the redesign', 'Peperina: the design system'],
  veng: ['Familiar e-commerce patterns for unfamiliar SAR imagery'],
  hometown: ['The platform stays in the loop'],
  lavoz: ['We built our own paywall, Wyleex', 'Mobile-first storytelling'],
  infoxel: ['Vlic: real-time news monitoring', 'Welo: live TV clipping'],
  omsnic: ['A quote, not a stack of PDFs', 'Questions as sentences', 'The price moves while you answer'],
  valora: ['The AI suggests, the analyst commits', 'Cap tables and scenarios you can work in', 'One design system for three modules'],
  continental: ['Clarity first, to WCAG', 'Denser screens, not more whitespace', 'One accessible library under everything'],
  'ey-helix': ["Auditors' workflows before patterns", 'Written guidelines for Helix visualizations', 'One architecture for a team of ten'],
  topicflower: ['Keep the flower, put the numbers underneath', 'Pay in credits, share them out', 'From a place you checked to a place you worked', 'One design system for the new platform'],
};
test('decision heads name the decision', async ({ page, path }) => {
  const want = DECISIONS[path.split('/')[2]];
  const got = await page.$$eval('main h3', hs => hs.map(h => h.textContent.trim()));
  if (want.join('|') !== got.join('|')) throw new Error(`h3s are [${got.join('; ')}]`);
}, p => CASE(p) && DECISIONS[p.split('/')[2]]);

test('cases do not repeat themselves', async ({ page, path }) => {
  const main = await page.textContent('main');
  const html = await page.innerHTML('main');
  const context = await page.$$eval('section.part', ss => ss.find(s => s.querySelector('h2')?.textContent.trim() === 'Context')?.textContent || '');
  if (path === '/work/omsnic/' && main.includes('112')) throw new Error('the banned 112 forms claim is back');
  if (path === '/work/bancor/' && context.includes('March 2020')) throw new Error('Context repeats March 2020');
  if (path === '/work/hometown/' && main.split('dead end').length !== 2) throw new Error('"dead end" is not said exactly once');
  const parts = (await page.$$eval('section.part', ss => ss.map(s => s.textContent))).join(' ');
  if (path === '/work/hometown/' && parts.split('phone number').length > 2) throw new Error('the phone-number idea is said twice');
  if (path === '/work/topicflower/') {
    if (/that.s cool/i.test(context)) throw new Error('Context repeats the dek\'s "that\'s cool"');
    if (main.split('prove ROI').length > 2) throw new Error('"prove ROI" said twice');
    if (!main.includes('Nebular Design System (Angular)')) throw new Error('Nebular line lost');
  }
}, p => ['/work/omsnic/', '/work/bancor/', '/work/hometown/', '/work/topicflower/'].includes(p));

test('case h1 is "Client: lowercase line"', async ({ page }) => {
  const h1 = (await page.textContent('h1')).trim();
  if (!/^[^:]+: [a-z0-9]/.test(h1)) throw new Error(`h1 reads "${h1}"`);
}, CASE);

test('links say where they go', async ({ page }) => {
  const vague = await page.$$eval('a', as => as.filter(a => /^project link$/i.test(a.textContent.trim())).length);
  if (vague) throw new Error(`${vague} "Project Link" links`);
  const untitled = await page.$$eval('iframe', fs => fs.filter(f => !f.title.trim()).length);
  if (untitled) throw new Error(`${untitled} iframes without a title`);
}, PORTFOLIO);

test('Bancor promo embed carries a title', async () => {
  const md = await readFile(resolve(ROOT, 'contents/bancor/_.md'), 'utf8');
  if (!/<iframe[^>]*\btitle="Bancón 2.0 promo"/.test(md)) throw new Error('Bancor iframe has no title');
}, p => p === '/work/bancor/');

test('share cards: large image, alt, twitter image', async ({ page }) => {
  const m = await page.evaluate(() => {
    const get = sel => document.querySelector(sel)?.getAttribute('content') || '';
    return { alt: get('meta[property="og:image:alt"]'), card: get('meta[name="twitter:card"]'), img: get('meta[name="twitter:image"]') };
  });
  if (!m.alt) throw new Error('no og:image:alt');
  if (m.card !== 'summary_large_image') throw new Error(`twitter:card is "${m.card}"`);
  if (!m.img) throw new Error('no twitter:image');
}, PORTFOLIO);

test('ledger and About describe themselves', async ({ page, path }) => {
  const d = await page.getAttribute('meta[name="description"]', 'content');
  const og = await page.getAttribute('meta[property="og:description"]', 'content');
  if (path === '/works.html' && /Portfolio$/.test(og)) throw new Error(`og:description is "${og}"`);
  if (path === '/work/about/') {
    if (d === 'About Me' || og === 'About Me') throw new Error('About is described as "About Me"');
    const h1 = (await page.textContent('h1')).trim();
    if (h1 === 'About Me') throw new Error('About h1 is "About Me"');
    const dup = await page.$$eval('main h2', (hs, h1) => hs.some(h => h.textContent.trim() === h1), h1);
    if (dup) throw new Error(`an h2 repeats the h1 "${h1}"`);
    if (await page.locator('.dek').count()) throw new Error('About has a dek');
  }
}, p => p === '/works.html' || p === '/work/about/');

test('first focusable is the skip link', async ({ page }) => {
  const first = await page.evaluate(() => {
    const el = document.querySelector('a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])');
    return el ? el.outerHTML.slice(0, 80) : '';
  });
  if (!/^<a class="skip" href="#main-content"/.test(first)) throw new Error(`first focusable is ${first}`);
  await page.focus('a.skip');
  const visible = await page.$eval('a.skip', a => a.getBoundingClientRect().width > 1 && a.getBoundingClientRect().height > 1);
  await page.evaluate(() => document.activeElement.blur());
  if (!visible) throw new Error('skip link stays hidden on focus');
}, PORTFOLIO);

test('InterVariable is preloaded', async ({ page }) => {
  const ok = await page.$$eval('link[rel="preload"][as="font"][type="font/woff2"][crossorigin]', ls => ls.some(l => l.href.endsWith('/fonts/InterVariable.woff2')));
  if (!ok) throw new Error('no font preload for InterVariable.woff2');
}, PORTFOLIO);

test('a loaded prototype is titled after its project', async ({ page }) => {
  await page.locator('a.embed-facade').first().click();
  const title = await page.$eval('iframe.embed-live', f => f.title);
  await page.reload();
  if (title !== 'Murmur prototype') throw new Error(`iframe title "${title}", want "Murmur prototype"`);
}, p => p === '/work/murmur/');

test('pager ends lead back to All work', async ({ page }) => {
  const r = await page.$eval('.pn', n => ({ empty: [...n.children].filter(c => c.tagName === 'SPAN' && !c.textContent.trim()).length,
    all: !!n.querySelector('a[href*="works.html"]') }));
  if (r.empty) throw new Error('empty slot in the pager');
  if (!r.all) throw new Error('no link to works.html in the pager');
}, p => CLIENT_ENDS.includes(p));

test('pager links show the target case\'s summary', async ({ page, base }) => {
  const links = await page.$$eval('.pn a[rel]', as => as.map(a => ({ slug: a.getAttribute('href').split('/')[1], line: a.querySelector('.pn-line')?.textContent.trim() })));
  if (!links.length) throw new Error('no pager links');
  for (const l of links) {
    const html = await (await page.request.get(`${base}/work/${l.slug}/`)).text();
    const want = html.match(/<p class="dek">([^<]*)<\/p>/)?.[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (!l.line || l.line !== want) throw new Error(`${l.slug}: pager line "${l.line}", dek "${want}"`);
  }
}, p => CASE(p) || SIDE(p));

test('static server answers 404 for a missing path', async ({ base, vp }) => {
  if (vp !== 'desktop') return;
  const res = await fetch(`${base}/nope`).catch(e => ({ status: e.message }));
  if (res.status !== 404) throw new Error(`/nope answered ${res.status}`);
  const again = await fetch(`${base}/works.html`).catch(e => ({ status: e.message }));
  if (again.status !== 200) throw new Error(`server down after /nope: ${again.status}`);
}, p => p === '/works.html');

// ── Side-project pages ────────────────────────────────────────
test('side pages use the case shell', async ({ page, path }) => {
  const r = await page.evaluate(() => ({
    glyph: !!document.querySelector('.case-head .spec .glyph'),
    h1: document.querySelectorAll('h1').length, dek: document.querySelector('.dek')?.textContent.trim(),
    back: document.querySelector('nav.mast a.back')?.getAttribute('href'),
    pn: !!document.querySelector('main + nav.pn'),
    rows: [...document.querySelectorAll('.spec dt')].map(d => d.textContent) }));
  const slug = slugOf(path);
  if (!r.glyph) throw new Error('no glyph in the spec column');
  if (r.h1 !== 1) throw new Error(`${r.h1} h1s`);
  if (!r.dek) throw new Error('no dek');
  if (r.back !== `../../works.html#${slug}`) throw new Error(`back link is ${r.back}`);
  if (!r.pn) throw new Error('no pager after main');
  if (r.rows.includes('Client')) throw new Error('side page lists a Client');
  if (r.rows[0] !== 'Year') throw new Error(`spec opens on ${r.rows[0]}`);
}, SIDE);

test('side rows open their own pages, and rel=next walks them all once', async ({ page, base }) => {
  const rows = await page.$$eval('[aria-labelledby="g-side"] a.row', as => as.map(a => a.href));
  const off = rows.filter(h => !/\/work\/[a-z0-9-]+\/$/.test(h));
  if (off.length) throw new Error(`${off.length} side rows leave the site: ${off[0]}`);
  const seen = [];
  let url = rows[0];
  while (url) {
    if (seen.includes(url)) throw new Error(`loop at ${url}`);
    seen.push(url);
    await page.goto(url);
    url = await page.$eval('a[rel="next"]', a => a.href).catch(() => null);
  }
  if (seen.join() !== rows.join()) throw new Error(`walked ${seen.length}, ledger has ${rows.length}`);
  await page.goto(`${base}/works.html`);
}, p => p === '/works.html');

const SIDE_ORDER = ['What it does', 'Screens', ['Decisions', 'Process']];
test('side sections follow the project order', async ({ page }) => {
  const labels = await page.$$eval('main h2', hs => hs.map(h => h.textContent.trim()));
  let i = 0;
  for (const l of labels) {
    const at = SIDE_ORDER.findIndex((o, k) => k >= i && [o].flat().includes(l));
    if (at < 0) throw new Error(`"${l}" out of order or not allowed in [${labels.join(', ')}]`);
    i = at + 1;
  }
  const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', hs => hs.map(h => Number(h.tagName[1])));
  for (let k = 1; k < levels.length; k++) {
    if (levels[k] > levels[k - 1] + 1) throw new Error(`heading jumps h${levels[k - 1]} → h${levels[k]}`);
  }
}, SIDE);

test('side pages have no How it works or Details heading', async ({ page }) => {
  const how = await page.$$eval('main h2, main h3', hs => hs.map(h => h.textContent.trim()).filter(t => /^(How it works|Details)$/i.test(t)));
  if (how.length) throw new Error(`"${how[0]}" heading on a side page`);
}, SIDE);

test('side Decisions are named in readable h3 heads', async ({ page }) => {
  const heads = await page.$$eval('section.part', ss => ss
    .filter(s => s.querySelector('h2')?.textContent.trim() === 'Decisions')
    .map(s => [...s.querySelectorAll('h3')].map(h => ({ text: h.textContent.trim(), px: parseFloat(getComputedStyle(h).fontSize) }))));
  if (!heads.length) return;
  const n = heads[0].length;
  if (n < 2 || n > 3) throw new Error(`${n} decisions, want 2 to 3`);
  const small = heads[0].find(h => h.px < 20);
  if (small) throw new Error(`"${small.text}" is ${small.px}px`);
  const digit = heads[0].find(h => /\d/.test(h.text));
  if (digit) throw new Error(`h3 carries a number: ${digit.text}`);
}, SIDE);

test('side pages carry no CTA row', async ({ page }) => {
  const n = await page.locator('.case-cta').count();
  if (n) throw new Error(`${n} .case-cta on a side page`);
}, SIDE);

test('screens are framed, captioned figures', async ({ page, path }) => {
  const figs = await page.$$eval('main figure.screen', fs => fs.map(f => {
    const i = f.querySelector('img'), cs = i && getComputedStyle(i);
    return { alt: i?.getAttribute('alt')?.trim(), w: i?.getAttribute('width'), h: i?.getAttribute('height'),
      cap: f.querySelector('figcaption')?.textContent.trim(), border: cs && parseFloat(cs.borderTopWidth),
      portrait: f.classList.contains('portrait'), shown: i?.getBoundingClientRect().width, natural: i?.naturalWidth };
  }));
  const max = CLIENT_SCREENS.includes(slugOf(path)) ? 5 : 3;
  if (figs.length > max) throw new Error(`${figs.length} screens, max ${max}`);
  for (const f of figs) {
    if (!f.alt) throw new Error('screen without alt');
    if (!f.w || !f.h) throw new Error(`"${f.alt}" has no width/height`);
    if (f.border) throw new Error(`"${f.alt}" has a ${f.border}px outline, want none`);
    if (f.portrait && f.shown > 320.5) throw new Error(`portrait "${f.alt}" shown ${f.shown}px wide, max 320`);
    if (!f.natural) throw new Error(`"${f.alt}" did not load`);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  const inverted = await page.$$eval('main figure.screen img', is => is.filter(i => getComputedStyle(i).filter.includes('invert')).length);
  await page.emulateMedia({ colorScheme: 'light' });
  if (inverted) throw new Error(`${inverted} screens inverted in dark mode`);
}, p => SIDE(p) || CASE(p));

async function pairProblems(page, vp) {
  return page.$$eval('main .screen-pair', (ps, vp) => ps.flatMap(p => {
    const [a, b] = [...p.querySelectorAll('figure.screen.portrait')].map(f => f.querySelector('img').getBoundingClientRect());
    if (!a || !b) return ['pair without two portrait screens'];
    const bad = [];
    if (a.width > 320.5 || b.width > 320.5) bad.push(`pair screens ${a.width}px / ${b.width}px wide, max 320`);
    if (vp === 'desktop' && (Math.abs(a.top - b.top) > 0.5 || b.left <= a.right)) bad.push('pair not side by side on desktop');
    if (vp === 'mobile' && b.top < a.bottom) bad.push('pair not stacked on mobile');
    return bad;
  }), vp);
}

test('portrait pairs sit side by side on desktop and stack on mobile', async ({ page, vp }) => {
  const bad = await pairProblems(page, vp);
  if (bad.length) throw new Error(bad.join('; '));
}, SIDE);

test('portrait pair styles, on a probe pair', async ({ page, vp }) => {
  const tall = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1386"><rect width="640" height="1386" fill="#888"/></svg>');
  await page.evaluate(src => {
    const fig = n => `<figure class="screen portrait"><img src="${src}" alt="Probe ${n}" width="640" height="1386"><figcaption>Probe ${n}</figcaption></figure>`;
    const d = document.createElement('div'); d.className = 'screen-pair'; d.id = 'pair-probe';
    d.innerHTML = fig(1) + fig(2);
    document.querySelector('main .part .body').append(d);
  }, tall);
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('#pair-probe img')].every(i => i.complete));
    const bad = await pairProblems(page, vp);
    if (bad.length) throw new Error(bad.join('; '));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) throw new Error(`page overflows by ${over}px`);
  } finally {
    await page.evaluate(() => document.getElementById('pair-probe')?.remove());
  }
}, p => p === '/work/murmur/');

function diagramProblems(svg) {
  const bad = [];
  const root = svg.match(/<svg\b[^>]*>/)?.[0] || '';
  if (!/viewBox="0 0 640 \d+"/.test(root)) bad.push('viewBox is not 0 0 640 H');
  if (/\s(width|height)="/.test(root)) bad.push('width/height on <svg>');
  if (!/^<svg\b[^>]*>\s*<title>[^<]+<\/title>/.test(svg.trim())) bad.push('no <title> first');
  const tag = svg.match(/<(style|script|image|foreignObject|linearGradient|radialGradient|filter|use)\b/);
  if (tag) bad.push(`<${tag[1]}>`);
  if (/\s(style|font-family|opacity|fill-opacity|stroke-opacity|rx|ry)="/.test(svg)) bad.push(svg.match(/\s(style|font-family|opacity|fill-opacity|stroke-opacity|rx|ry)="/)[1] + '=');
  const paints = [...svg.matchAll(/\s(fill|stroke)="([^"]*)"/g)].filter(m => !['currentColor', 'none'].includes(m[2]));
  if (paints.length) bad.push(`${paints[0][1]}="${paints[0][2]}"`);
  const widths = [...svg.matchAll(/stroke-width="([^"]*)"/g)].filter(m => m[1] !== '1.5');
  if (widths.length) bad.push(`stroke-width ${widths[0][1]}`);
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const curves = [...body.matchAll(/\sd="([^"]*)"/g)].map(m => m[1].replace(/[-\d.,\s]+/g, '')).join('');
  if (/[^MLHVZmlhvz]/.test(curves)) bad.push('curved path');
  const nodes = (body.match(/<(rect|circle|ellipse|polygon)\b/g) || []).length;
  if (nodes > 8) bad.push(`${nodes} nodes, max 8`);
  const solid = (body.match(/<(rect|circle)\b[^>]*fill="currentColor"/g) || []).length;
  if (solid > 1) bad.push(`${solid} solid nodes, max 1 (the project)`);
  const sizes = [...svg.matchAll(/font-size="([^"]*)"/g)].filter(m => !['12', '14'].includes(m[1]));
  if (sizes.length) bad.push(`font-size ${sizes[0][1]}`);
  return bad;
}

test('the diagram check accepts the spec example and rejects off-spec drawings', async ({ vp }) => {
  if (vp !== 'desktop') return;
  const ok = await readFile(resolve(ROOT, 'tests/fixtures/contents/02-gallery/items/proj-a/diagram.svg'), 'utf8');
  const clean = ok.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const p = diagramProblems(clean);
  if (p.length) throw new Error(`spec example flagged: ${p.join('; ')}`);
  for (const [name, broken] of [['colour', clean.replace('fill="currentColor"', 'fill="#E94136"')],
    ['rounded', clean.replace('<rect x="8"', '<rect rx="4" x="8"')], ['curve', clean.replace('M168 80H232', 'M168 80C200 60 200 60 232 80')],
    ['thick', clean.replace('stroke-width="1.5"', 'stroke-width="3"')], ['style', clean.replace('<defs>', '<style>x{}</style><defs>')]]) {
    if (!diagramProblems(broken).length) throw new Error(`${name} diagram passed the check`);
  }
}, p => p === '/works.html');

test('diagrams follow the spec', async ({ page }) => {
  const svgs = await page.$$eval('main figure.diagram svg', ss => ss.map(s => s.outerHTML.replace(/ role="img"/, '')));
  if (svgs.length > 1) throw new Error(`${svgs.length} diagrams, max 1`);
  for (const svg of svgs) {
    const p = diagramProblems(svg);
    if (p.length) throw new Error(p.join('; '));
  }
  const caps = await page.$$eval('main figure.diagram', fs => fs.filter(f => !f.querySelector('figcaption')?.textContent.trim()).length);
  if (caps) throw new Error('diagram without caption');
}, SIDE);

// Two inlined diagrams that share a marker id bind to the wrong marker.
test('diagram marker ids are unique on a page', async ({ page }) => {
  const ids = await page.$$eval('main figure.diagram marker[id]', ms => ms.map(m => m.id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`marker id "${dup}" is used twice`);
}, p => CASE(p) || SIDE(p));

test('wide screens break out of the column and zoom on click', async ({ page, vp }) => {
  const r = await page.$$eval('main figure.screen', fs => fs.map(f => {
    const body = f.closest('.body').getBoundingClientRect();
    const img = f.querySelector('img');
    return { wide: f.classList.contains('wide'), natural: img.naturalWidth || +img.getAttribute('width'), w: f.getBoundingClientRect().width, body: body.width };
  }));
  const wide = r.filter(x => x.wide);
  if (!wide.length) throw new Error('no figure.wide on the page');
  for (const x of r) if (x.wide !== (x.natural > 1600)) throw new Error(`a ${x.natural}px screen is ${x.wide ? '' : 'not '}wide`);
  if (vp === 'desktop' && wide.some(x => x.w < x.body * 1.4)) throw new Error(`wide figure ${wide[0].w}px vs body ${wide[0].body}px`);
  if (vp === 'mobile' && wide.some(x => x.w > x.body + 0.5)) throw new Error('wide figure overflows the body on a phone');
  await page.locator('main figure.wide img').first().click();
  await page.waitForTimeout(400);
  const open = await page.$eval('.zoom', z => ({ shown: getComputedStyle(z).opacity === '1', w: z.querySelector('img').getBoundingClientRect().width, nat: z.querySelector('img').naturalWidth })).catch(() => null);
  if (!open || !open.shown) throw new Error('click did not open the zoom');
  if (vp === 'desktop' && open.w < Math.min(open.nat, 1300)) throw new Error(`zoomed image only ${open.w}px`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.$('.zoom')) throw new Error('zoom still open after Escape');
}, p => p === '/work/continental/');

const CLIENT_SCREENS = ['bancor', 'continental', 'ey-helix', 'hometown', 'infoxel', 'lavoz', 'lede', 'omsnic', 'topicflower', 'valora', 'veng'];
test('client case screens sit under the decision they show', async ({ page, path }) => {
  const figs = await page.$$eval('main figure.screen', fs => fs.map(f => {
    const part = f.closest('section.part');
    let h3 = null;
    for (let n = f.closest('section.part > .body > *') || f; n && !h3; n = n.previousElementSibling) if (n.matches('h3')) h3 = n;
    return { h2: part?.querySelector('h2')?.textContent.trim(), h3: h3?.textContent.trim(),
      alt: f.querySelector('img')?.getAttribute('alt')?.trim() || '', cap: f.querySelector('figcaption')?.textContent.trim() || '' };
  }));
  const slug = slugOf(path);
  if (!CLIENT_SCREENS.includes(slug)) {
    if (figs.length) throw new Error(`${slug} has screens: add it to CLIENT_SCREENS`);
    return;
  }
  const bad = [];
  if (figs.length < 2 || figs.length > 5) bad.push(`${figs.length} screens, want 2 to 5`);
  for (const f of figs) {
    if (f.h2 !== 'Decisions' || !f.h3) bad.push(`"${f.alt}" is not under a decision (h2 ${f.h2}, h3 ${f.h3})`);
    if (f.alt.length > 125) bad.push(`alt is ${f.alt.length} characters, max 125: ${f.alt}`);
    if (f.cap.length > 100) bad.push(`caption is ${f.cap.length} characters, max 100: ${f.cap}`);
    if (/\u2014/.test(f.cap + f.alt)) bad.push(`em dash in: ${f.cap}`);
    if (/\.$/.test(f.cap)) bad.push(`caption ends with a period: ${f.cap}`);
  }
  const notes = figs.filter(f => /blurred|for the portfolio/i.test(f.cap)).length;
  if (notes) bad.push(`${notes} captions say the screen was blurred or arranged: say neither`);
  if (bad.length) throw new Error(bad.join('; '));
}, CASE);

// Dropped into a live side page so the real stylesheet applies.
test('diagram styles: ink, Inter, 1.5px hairlines, knockout, no page overflow', async ({ page, vp }) => {
  const raw = await readFile(resolve(ROOT, 'tests/fixtures/contents/02-gallery/items/proj-a/diagram.svg'), 'utf8');
  const svg = raw.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const probe = async () => page.evaluate(() => {
    const s = document.querySelector('#probe svg'), css = getComputedStyle(document.documentElement);
    const rgb = v => { const d = document.createElement('i'); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const line = s.querySelector('g[stroke] rect'), knock = s.querySelector('.knock'), label = s.querySelector('text:not(.knock)');
    const scale = s.getBoundingClientRect().width / s.viewBox.baseVal.width;
    const nonScaling = getComputedStyle(line).vectorEffect === 'non-scaling-stroke';
    return { color: getComputedStyle(s).color, ink: rgb(css.getPropertyValue('--ink')), paper: rgb(css.getPropertyValue('--paper')),
      knock: getComputedStyle(knock).fill, font: getComputedStyle(label).fontFamily,
      stroke: nonScaling ? parseFloat(getComputedStyle(line).strokeWidth) : parseFloat(getComputedStyle(line).strokeWidth) * scale,
      labelPx: 14 * scale, over: document.documentElement.scrollWidth - window.innerWidth };
  });
  await page.evaluate(svg => {
    const f = document.createElement('figure'); f.className = 'diagram'; f.id = 'probe';
    f.innerHTML = svg + '<figcaption>probe</figcaption>';
    document.querySelector('main .part .body').append(f);
  }, svg);
  try {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const r = await probe();
      if (r.color !== r.ink) throw new Error(`${scheme}: diagram is ${r.color}, ink is ${r.ink}`);
      if (r.knock !== r.paper) throw new Error(`${scheme}: knockout label is ${r.knock}, paper is ${r.paper}`);
      if (!r.font.includes('InterVariable')) throw new Error(`labels set in ${r.font}`);
      if (Math.abs(r.stroke - 1.5) > 0.01) throw new Error(`lines are ${r.stroke.toFixed(2)}px`);
      if (r.labelPx < 11) throw new Error(`labels shrink to ${r.labelPx.toFixed(1)}px at ${vp}`);
      if (r.over > 0) throw new Error(`page overflows by ${r.over}px`);
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => document.getElementById('probe')?.remove());
  }
}, p => p === '/work/murmur/');

// Side projects with a UI but no screens yet. A slug here must have none,
// so it leaves the list as soon as its screens land.
const SCREENS_PENDING = ['airnod', 'figma-cdp', 'figma-plugins', 'subi'];
test('side project shows its screens', async ({ page, path }) => {
  const slug = slugOf(path);
  const r = await page.evaluate(() => ({
    screens: [...document.querySelectorAll('main figure.screen')].filter(f =>
      f.querySelector('img')?.getAttribute('alt')?.trim() && f.querySelector('figcaption')?.textContent.trim()).length,
    uncaptioned: [...document.querySelectorAll('main figure.diagram')].filter(f =>
      !f.querySelector('svg') || !f.querySelector('figcaption')?.textContent.trim()).length }));
  if (r.uncaptioned) throw new Error(`${r.uncaptioned} diagrams without an SVG or caption`);
  if (SCREENS_PENDING.includes(slug)) {
    if (r.screens) throw new Error(`${slug} has screens: remove it from SCREENS_PENDING`);
    return;
  }
  if (!r.screens) throw new Error('no captioned screen: add one, or list the slug in SCREENS_PENDING');
}, SIDE);

test('SCREENS_PENDING names only real side projects', async ({ vp }) => {
  if (vp !== 'desktop') return;
  const unknown = SCREENS_PENDING.filter(s => !SIDE_SLUGS.includes(s));
  if (unknown.length) throw new Error(`unknown slugs: ${unknown.join(', ')}`);
}, p => p === '/works.html');

// ── Motion (motion.js) ────────────────────────────────────────
async function parityProbe(page) {
  return page.evaluate(async () => {
    const g = document.querySelector('.spec .glyph'), img = g.querySelector('img'), c = g.querySelector('canvas.parity');
    if (!c) return { canvas: false, img: getComputedStyle(img).opacity };
    const shown = getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden';
    // At rest the canvas must match the img drawn at its size and offset.
    const ref = document.createElement('canvas'); ref.width = c.width; ref.height = c.height;
    const box = g.getBoundingClientRect(), cb = c.getBoundingClientRect(), k = c.width / cb.width;
    const r = ref.getContext('2d');
    const im = new Image(); im.src = img.src; await im.decode();
    r.drawImage(im, (box.left - cb.left) * k, (box.top - cb.top) * k, box.width * k, box.height * k);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = r.getImageData(0, 0, c.width, c.height).data;
    let diff = 0, n = 0, dark = 0, opaque = 0, tinted = 0;
    for (let i = 3; i < a.length; i += 4) {
      diff += Math.abs(a[i] - b[i]); n += Math.max(a[i], b[i]) > 0 ? 1 : 0;
      if (a[i] === 255) { opaque++; dark += Math.max(a[i - 3], a[i - 2], a[i - 1]) < 60 ? 1 : 0; }
      if (a[i] > 64 && Math.max(a[i - 3], a[i - 2], a[i - 1]) - Math.min(a[i - 3], a[i - 2], a[i - 1]) > 60) tinted++;
    }
    return { canvas: true, shown, tinted, diff: diff / 255 / Math.max(1, n), dark: dark / Math.max(1, opaque),
      img: getComputedStyle(img).opacity, vt: g.style.viewTransitionName, canvasVt: getComputedStyle(c).viewTransitionName };
  });
}

test('parity pull: the glyph comes apart near the pointer and keeps its holes', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('.spec .glyph').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // Just inside the pull's reach, 1.5 glyph widths (REACH in motion.js).
  await page.mouse.move(cx + box.width * 1.47, cy);
  await page.waitForTimeout(300);
  let r = await parityProbe(page);
  if (!r.canvas || !r.shown) throw new Error('no parity canvas at the edge of the reach');
  if (r.img !== '0') throw new Error('img still shown under the canvas');
  if (r.diff > 0.06) throw new Error(`at rest the canvas differs from the glyph by ${r.diff.toFixed(3)}: holes lost`);
  if (r.canvasVt !== 'none' || !r.vt.startsWith('g-')) throw new Error(`transition names: glyph "${r.vt}", canvas "${r.canvasVt}"`);
  await page.mouse.move(cx + 4, cy + 3, { steps: 4 });
  await page.waitForTimeout(500);
  r = await parityProbe(page);
  if (!(r.diff > 0.1)) throw new Error(`shapes did not move apart (diff ${r.diff.toFixed(3)})`);
  await page.mouse.move(cx + box.width * 6, cy + box.width * 4, { steps: 4 });
  await page.waitForTimeout(1800);
  r = await parityProbe(page);
  if (r.canvas && r.shown) throw new Error('canvas still shown after the pointer left');
  if (r.img !== '1') throw new Error(`img opacity ${r.img} after the pointer left`);
  // Leaving the page: the canvas goes before the outgoing snapshot.
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('pageswap')));
  r = await parityProbe(page);
  if (r.canvas || r.img !== '1') throw new Error('canvas left in place on pageswap');
  await page.mouse.move(0, 0);
}, p => ['/work/continental/', '/work/posta/', '/work/bancor/', '/work/topicflower/'].includes(p));

test('parity pull draws no coloured outline', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('.spec .glyph').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const r = await parityProbe(page);
  await page.mouse.move(0, 0);
  if (!r.canvas) throw new Error('no parity canvas');
  if (r.tinted > 0) throw new Error(`${r.tinted} coloured pixels on the pulled glyph`);
}, p => p === '/work/continental/');

test('parity pull inks white in dark mode', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  await page.emulateMedia({ colorScheme: 'dark' });
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('.spec .glyph').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const r = await parityProbe(page);
    if (!r.canvas) throw new Error('no parity canvas');
    if (r.dark > 0.01) throw new Error(`${(r.dark * 100).toFixed(0)}% of the ink is black`);
  } finally {
    await page.mouse.move(0, 0);
    await page.emulateMedia({ colorScheme: 'light' });
  }
}, p => p === '/work/continental/');

test('parity pull stays off under reduced motion', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  try {
    const box = await page.locator('.spec .glyph').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const r = await parityProbe(page);
    if (r.canvas) throw new Error('parity canvas under reduced motion');
  } finally {
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
  }
}, p => p === '/work/continental/');

test('hovering ledger rows draws no rope', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const rows = page.locator('[aria-labelledby="g-client"] .row');
  await rows.nth(0).hover(); await page.waitForTimeout(450);
  await rows.nth(3).hover(); await page.waitForTimeout(450);
  if (await page.$('svg.tether')) throw new Error('a tether rope is drawn');
}, p => p === '/works.html');

// ── Runner ────────────────────────────────────────────────────
// Serve over HTTP like GitHub Pages; file:// blocks font loading.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  let body;
  try { body = await readFile(path); }
  catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(body);
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
let failed = 0;
for (const [vp, size] of Object.entries(VIEWPORTS)) {
  for (const path of PAGES) {
    const page = await browser.newPage({ viewport: size });
    // Keep the run hermetic: third-party embeds (Figma, YouTube) aren't loaded.
    await page.route(u => new URL(u).origin !== BASE, r => r.abort());
    const errors = [];
    page.on('console', m => m.type() === 'error' && !/net::ERR_FAILED/.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    const name = path === '/' ? 'index' : path.replace(/^\/|\/$/g, '').replace(/\//g, '-').replace(/\.html$/, '');
    // Lazy images below the fold would shoot as blanks: load them first.
    await page.evaluate(() => Promise.all([...document.images].map(img => {
      img.loading = 'eager';
      return img.complete ? null : new Promise(r => { img.onload = img.onerror = r; });
    })));
    await page.screenshot({ path: resolve(SHOTS, `${name}-${vp}.png`), fullPage: true });
    for (const t of tests.filter(t => t.only(path))) {
      try { await t.fn({ page, errors, vp, base: BASE, path }); console.log(`  ✓ [${vp}] ${path} ${t.name}`); }
      catch (e) { failed++; console.log(`  ✗ [${vp}] ${path} ${t.name}: ${e.message.split('\n')[0]}`); }
    }
    await page.close();
  }
}
await browser.close();
server.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('All site checks passed.');
