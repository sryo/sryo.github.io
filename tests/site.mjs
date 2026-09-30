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

// Use a local playwright if installed, else the global one.
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
// Side projects (contents/about/items/<slug>) get pages in the case shell.
const SIDE_SLUGS = readdirSync(resolve(ROOT, 'contents/about/items')).filter(s => existsSync(resolve(ROOT, 'contents/about/items', s, '_.md'))).sort();
const slugOf = p => p.split('/')[2];
const SIDE = p => p.startsWith('/work/') && SIDE_SLUGS.includes(slugOf(p));

const tests = [];
// only(path) limits a test to the pages it applies to.
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
  // Any Argentine number or tel: link, without spelling Mateo's digits here.
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

test('accent is one of LINE_COLORS', async ({ page }) => {
  const LINE_COLORS = ['#FF2D55', '#00C7BE', '#FFCC00', '#007AFF', '#FF9500', '#AF52DE', '#34C759'];
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  if (!LINE_COLORS.includes(accent.toUpperCase())) throw new Error(`--accent is ${accent}`);
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

test('masthead end year is the newest row year', async ({ page }) => {
  const meta = await page.$eval('.intro .mast .meta', e => e.textContent);
  const end = Number(meta.match(/(\d{4})\D*$/)?.[1]);
  const years = await page.$$eval('.row time', ts => ts.map(t => Number(t.textContent)).filter(Boolean));
  const max = Math.max(...years);
  if (end !== max) throw new Error(`masthead ends ${end}, newest row is ${max}`);
}, p => p === '/works.html');

test('email sits in the header line and the footer', async ({ page }) => {
  const r = await page.evaluate(() => ({ all: document.querySelectorAll('a[href="mailto:mateo@yadarola.com.ar"]').length,
    avail: document.querySelectorAll('p.avail a[href="mailto:mateo@yadarola.com.ar"]').length,
    footer: document.querySelectorAll('footer.contact a[href="mailto:mateo@yadarola.com.ar"]').length }));
  if (r.avail !== 1 || r.footer !== 1 || r.all !== 2) throw new Error(`mailto links: ${r.avail} in p.avail, ${r.footer} in the footer, ${r.all} in all`);
}, p => p === '/works.html');

// The span runs from the oldest row (Taller, 2009) to the newest (the side
// projects, 2026). Change it together with "masthead end year is the newest
// row year" when the dates move.
test('masthead reads Work, 2009–2026', async ({ page }) => {
  const meta = (await page.$eval('.intro .mast .meta', e => e.textContent)).trim();
  if (meta !== 'Work, 2009–2026') throw new Error(`masthead reads "${meta}"`);
}, p => p === '/works.html');

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

// Side-project glyphs follow the original grammar: a few
// primitives XORed in one evenodd path; straight lines and circular arcs only.
const SIDE_GLYPHS = ['chanchan', 'stow', 'avis', 'figma-cdp', 'murmur', 'dirpad', 'when', 'trueframe', 'fin', 'subi',
  'posta', 'apptidy', 'airnod', 'lineandform', 'spoons', 'gmailtidy', 'zentrate', 'figma-plugins', 'chronomouse'];
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

test('client roles fit on one line at 1440', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const tall = await page.$$eval('[aria-labelledby="g-client"] .row .role', rs => rs
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
  for (let i = 0; i < 15 && !href; i++) {
    await page.keyboard.press('Tab');
    href = await page.evaluate(() => document.activeElement?.matches('a.row') ? document.activeElement.getAttribute('href') : null);
  }
  if (!href) throw new Error('no a.row reachable by Tab');
  await Promise.all([page.waitForURL(u => u.pathname.endsWith('/' + href.replace(/#.*/, ''))), page.keyboard.press('Enter')]);
  await page.goBack();
}, p => p === '/works.html');

test('rel=next walks every client case once', async ({ page, base }) => {
  const rows = await page.$$eval('[aria-labelledby="g-client"] a.row', as => as.map(a => a.href));
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

const CASE = p => p.startsWith('/work/') && !p.endsWith('/about/') && !SIDE(p);
const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

// Client cases: newest
// first, each with its CV year and role, a My role section and one or two
// diagrams. A slug leaves CV_PENDING when its CV update lands; that is the
// case's red → green step. The test fails if a pending case already passes.
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
  taller: [2009, 'UX/UI designer'],
};
const CV_PENDING = [];
const CV_DONE = p => CASE(p) && !CV_PENDING.includes(slugOf(p));
// The client rows of the ledger as built, for the pager's two ends.
const CLIENT_ROWS = (() => {
  const html = existsSync(resolve(ROOT, 'works.html')) ? readFileSync(resolve(ROOT, 'works.html'), 'utf8') : '';
  const group = html.match(/aria-labelledby="g-client"[\s\S]*?<\/section>/)?.[0] || '';
  return [...group.matchAll(/<a class="row[^"]*" href="work\/([a-z0-9-]+)\/"/g)].map(m => m[1]);
})();
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

// SPEC-projects.md §4, as it applies to client cases: one or two diagrams
// (under a decision, not "How it works"), each on the glyph grammar, circle
// labels inside when they fit (≤ 5 characters) else centred below or above,
// node labels in sentence case unless they are code names, and a caption
// of one line (≤ 95 characters) at column width.
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
  if (figs.length < 1 || figs.length > 2) bad.push(`${figs.length} diagrams, want 1 or 2`);
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

test('every client case has one or two diagrams, on spec', async ({ page, vp }) => {
  const bad = await clientDiagramProblems(page, vp);
  if (bad.length) throw new Error(bad.join('; '));
}, CV_DONE);

test('CV_PENDING holds only cases still to update', async ({ page, path, vp }) => {
  const slug = slugOf(path);
  if (!CV[slug]) throw new Error(`${slug} is not in the CV map`);
  const bad = [...await cvFactProblems(page, slug), ...await myRoleProblems(page), ...await clientDiagramProblems(page, vp)];
  if (!bad.length) throw new Error(`${slug} is done: remove it from CV_PENDING`);
}, p => CASE(p) && CV_PENDING.includes(slugOf(p)));

test('client ledger is the CV, newest first', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const rows = await page.$$eval('[aria-labelledby="g-client"] a.row', as => as.map(a => a.getAttribute('href')));
  const want = Object.keys(CV).filter(s => !CV_PENDING.includes(s)).map(s => `work/${s}/`);
  const got = rows.filter(h => want.includes(h));
  if (got.join() !== want.join()) throw new Error(`client rows [${got.join(', ')}], want [${want.join(', ')}]`);
  const stray = rows.filter(h => !CV[h.split('/')[1]]);
  if (stray.length) throw new Error(`client rows not in the CV: ${stray.join(', ')}`);
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
  bancor: ['Logical accounts instead of paperwork', 'Peperina: the design system'],
  veng: ['Familiar e-commerce patterns for unfamiliar SAR imagery'],
  hometown: ['The platform stays in the loop'],
  lavoz: ['We built our own paywall, Wyleex', 'Mobile-first storytelling'],
  infoxel: ['Vlic: real-time news monitoring', 'Welo: live TV clipping'],
  omsnic: ['Progressive disclosure', 'Branching logic stays invisible'],
  valora: ['The AI suggests, the analyst commits', 'Cap tables and scenarios you can work in', 'One design system for three modules'],
  continental: ['Clarity first, to WCAG', 'Denser screens, not more whitespace', 'One accessible library under everything'],
  'ey-helix': ["Auditors' workflows before patterns", 'Written guidelines for Helix visualizations', 'One architecture for a team of ten'],
  taller: ['Interactive apps for digital TV', 'An in-cabin console for precision agriculture', 'Leading web publishing on Agilent'],
  topicflower: ['Keep the flower, put the numbers underneath', 'From a place you checked to a place you worked', 'One design system for the new platform'],
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
  if (path === '/work/omsnic/' && /<strong>[^<]*112/.test(html)) throw new Error('112 is bolded in the body');
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

test('Bancor walkthrough embed carries a title', async () => {
  const md = await readFile(resolve(ROOT, 'contents/bancor/_.md'), 'utf8');
  if (!/<iframe[^>]*\btitle="Bancor crisis features walkthrough"/.test(md)) throw new Error('Bancor iframe has no title');
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

test('pager links show the target case\'s ledger line', async ({ page, base }) => {
  const ledger = await (await page.request.get(`${base}/works.html`)).text();
  const links = await page.$$eval('.pn a[rel]', as => as.map(a => ({ slug: a.getAttribute('href').split('/')[1], line: a.querySelector('.pn-line')?.textContent.trim() })));
  if (!links.length) throw new Error('no pager links');
  for (const l of links) {
    const row = ledger.match(new RegExp(`href="work/${l.slug}/".*?<span class="line">([^<]*)</span>`));
    const want = row?.[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (!l.line || l.line !== want) throw new Error(`${l.slug}: pager line "${l.line}", ledger "${want}"`);
  }
}, p => CASE(p) || SIDE(p));

test('static server answers 404 for a missing path', async ({ base, vp }) => {
  if (vp !== 'desktop') return;
  const res = await fetch(`${base}/nope`).catch(e => ({ status: e.message }));
  if (res.status !== 404) throw new Error(`/nope answered ${res.status}`);
  const again = await fetch(`${base}/works.html`).catch(e => ({ status: e.message }));
  if (again.status !== 200) throw new Error(`server down after /nope: ${again.status}`);
}, p => p === '/works.html');

// ── Side-project pages ─────────────
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

const SIDE_ORDER = ['What it does', 'Screens', 'How it works', 'Details'];
test('side sections follow the project order', async ({ page }) => {
  const labels = await page.$$eval('main h2', hs => hs.map(h => h.textContent.trim()));
  let i = 0;
  for (const l of labels) {
    const at = SIDE_ORDER.indexOf(l, i);
    if (at < 0) throw new Error(`"${l}" out of order or not allowed in [${labels.join(', ')}]`);
    i = at + 1;
  }
  const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', hs => hs.map(h => Number(h.tagName[1])));
  for (let k = 1; k < levels.length; k++) {
    if (levels[k] > levels[k - 1] + 1) throw new Error(`heading jumps h${levels[k - 1]} → h${levels[k]}`);
  }
}, SIDE);

test('side pages carry no CTA row', async ({ page }) => {
  const n = await page.locator('.case-cta').count();
  if (n) throw new Error(`${n} .case-cta on a side page`);
}, SIDE);

test('screens are framed, captioned figures', async ({ page }) => {
  const figs = await page.$$eval('main figure.screen', fs => fs.map(f => {
    const i = f.querySelector('img'), cs = i && getComputedStyle(i);
    return { alt: i?.getAttribute('alt')?.trim(), w: i?.getAttribute('width'), h: i?.getAttribute('height'),
      cap: f.querySelector('figcaption')?.textContent.trim(), border: cs && parseFloat(cs.borderTopWidth),
      portrait: f.classList.contains('portrait'), shown: i?.getBoundingClientRect().width, natural: i?.naturalWidth };
  }));
  if (figs.length > 3) throw new Error(`${figs.length} screens, max 3`);
  for (const f of figs) {
    if (!f.alt) throw new Error('screen without alt');
    if (!f.cap) throw new Error(`"${f.alt}" has no caption`);
    if (!f.w || !f.h) throw new Error(`"${f.alt}" has no width/height`);
    if (f.border !== 1) throw new Error(`"${f.alt}" frame is ${f.border}px, want a 1px hairline`);
    if (f.portrait && f.shown > 320.5) throw new Error(`portrait "${f.alt}" shown ${f.shown}px wide, max 320`);
    if (!f.natural) throw new Error(`"${f.alt}" did not load`);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  const inverted = await page.$$eval('main figure.screen img', is => is.filter(i => getComputedStyle(i).filter.includes('invert')).length);
  await page.emulateMedia({ colorScheme: 'light' });
  if (inverted) throw new Error(`${inverted} screens inverted in dark mode`);
}, SIDE);

// Two portrait screens in a row (a .screen-pair, see build.sh) sit side
// by side on desktop, each at most 320px, and stack on a phone. Checked on
// every pair a page has, and on a probe pair dropped into Murmur's page.
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

// Diagrams: the glyph grammar as boxes and lines.
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

// Client work is under NDA: diagrams, not screens.
test('client cases show no screens', async ({ page }) => {
  const r = await page.evaluate(() => ({ screens: document.querySelectorAll('main figure.screen').length,
    imgs: document.querySelectorAll('main section.part img').length }));
  if (r.screens) throw new Error(`${r.screens} figure.screen`);
  if (r.imgs) throw new Error(`${r.imgs} <img> in the parts`);
}, CASE);

// The stylesheet's side of the diagram contract, checked on a live side
// page with the spec example dropped in: ink in both schemes, Inter labels,
// 1.5px lines at any scale, the project's label knocked out, and on a phone
// the diagram scrolls inside its figure instead of shrinking.
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

// The per-project goal: real screens where the
// project has a UI, and always one diagram of how it works. A slug leaves
// PENDING when its content lands; that is the project's red → green step.
const PENDING = [
  'subi'];
test('side project shows its screens and a diagram', async ({ page, path }) => {
  const slug = slugOf(path);
  const r = await page.evaluate(() => ({
    screens: [...document.querySelectorAll('main figure.screen')].filter(f =>
      f.querySelector('img')?.getAttribute('alt')?.trim() && f.querySelector('figcaption')?.textContent.trim()).length,
    diagrams: [...document.querySelectorAll('main figure.diagram')].filter(f =>
      f.querySelector('svg') && f.querySelector('figcaption')?.textContent.trim()).length }));
  const meets = (r.screens >= 1 || r.diagrams >= 1) && r.diagrams >= 1;
  if (PENDING.includes(slug)) {
    if (meets) throw new Error(`${slug} is done: remove it from PENDING`);
    return;
  }
  if (!meets) throw new Error(`${r.screens} captioned screens, ${r.diagrams} captioned diagrams: needs a diagram (and screens if it has a UI)`);
}, SIDE);

test('PENDING names only real side projects', async ({ vp }) => {
  if (vp !== 'desktop') return;
  const unknown = PENDING.filter(s => !SIDE_SLUGS.includes(s));
  if (unknown.length) throw new Error(`unknown slugs in PENDING: ${unknown.join(', ')}`);
}, p => p === '/works.html');

// ── Toys ───────────────────────
// A TOY: line mounts toys/<name>.js inside its diagram figure. The SVG
// stays in the figure (hidden from sight, kept for screen readers) and is
// what no-JS and reduced-motion visitors see. A toy is captioned an
// illustration and rests on its end state.
async function toyState(page, name) {
  return page.$eval(`figure.diagram[data-toy="${name}"]`, f => {
    const svg = f.querySelector(':scope > svg'), toy = f.querySelector('.toy');
    const box = e => e ? e.getBoundingClientRect() : null;
    return { svg: !!svg, svgShown: (box(svg)?.width || 0) > 100, toy: !!toy, toyShown: (box(toy)?.width || 0) > 100,
      note: toy?.querySelector('.toy-note')?.textContent.trim(), cap: f.querySelector('figcaption')?.textContent.trim(),
      state: toy?.dataset.state, shown: Number(toy?.dataset.rows || 0),
      buttons: [...(toy?.querySelectorAll('button') || [])].map(b => ({ text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed'), h: box(b).height })) };
  });
}

async function reducedMotionProblems(page, name) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  try {
    const r = await toyState(page, name);
    const bad = [];
    if (r.toy) bad.push('toy mounted under reduced motion');
    if (!r.svgShown) bad.push('diagram hidden under reduced motion');
    return bad;
  } finally {
    // Reload restores the scroll position: leave the page at the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
  }
}

test('Airy / Dense toy flips between the first design and the dense one', async ({ page, vp }) => {
  const settle = () => page.waitForTimeout(1400);
  await page.locator('figure.diagram[data-toy="airy-dense"]').scrollIntoViewIfNeeded();
  let r = await toyState(page, 'airy-dense');
  if (!r.toy || !r.toyShown) throw new Error('toy not mounted');
  if (!r.svg || r.svgShown) throw new Error('diagram SVG missing or still shown beside the toy');
  if (r.note !== 'Illustration') throw new Error(`toy note reads "${r.note}"`);
  if (r.state !== 'dense') throw new Error(`toy rests on "${r.state}", want dense`);
  const want = vp === 'mobile' ? ['Before', 'After'] : ['First design', 'After agent research'];
  if (r.buttons.map(b => b.text).join('|') !== want.join('|')) throw new Error(`buttons read [${r.buttons.map(b => b.text).join(', ')}]`);
  if (r.buttons.map(b => b.pressed).join() !== 'false,true') throw new Error('After is not the pressed button');
  if (vp === 'mobile' && r.buttons.some(b => b.h < 44)) throw new Error('switch buttons under 44px on a phone');
  const dense = r.shown;
  await page.locator('figure.diagram[data-toy="airy-dense"] .toy button').first().click();
  await settle();
  r = await toyState(page, 'airy-dense');
  if (r.state !== 'airy' || r.buttons.map(b => b.pressed).join() !== 'true,false') throw new Error('first click did not switch to the first design');
  if (!(r.shown < dense)) throw new Error(`first design shows ${r.shown} rows, dense shows ${dense}`);
  await page.locator('figure.diagram[data-toy="airy-dense"] .toy button').last().click();
  await settle();
  r = await toyState(page, 'airy-dense');
  if (r.state !== 'dense' || r.shown !== dense) throw new Error(`back on dense shows ${r.shown} rows, want ${dense}`);
  const accent = await page.evaluate(() => {
    const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    document.body.append(d); const c = getComputedStyle(d).color; d.remove();
    const thumb = document.querySelector('figure.diagram[data-toy="airy-dense"] .toy [data-live]');
    return { accent: c, thumb: thumb && getComputedStyle(thumb).fill };
  });
  if (accent.thumb !== accent.accent) throw new Error(`scroll thumb is ${accent.thumb}, accent is ${accent.accent}`);
}, p => p === '/work/continental/');

test('Airy / Dense falls back to the diagram under reduced motion', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const bad = await reducedMotionProblems(page, 'airy-dense');
  if (bad.length) throw new Error(bad.join('; '));
}, p => p === '/work/continental/');

// The approval gate, played: the AI's suggestions land in four generic
// fields, and Commit stays shut until each is confirmed or overridden.
async function gateState(page) {
  return page.$eval('figure.diagram[data-toy="review-gate"]', f => {
    const toy = f.querySelector('.toy');
    const commit = toy?.querySelector('.tr-commit');
    return { toy: !!toy, svgShown: (f.querySelector(':scope > svg')?.getBoundingClientRect().width || 0) > 100,
      note: toy?.querySelector('.toy-note')?.textContent.trim(), state: toy?.dataset.state,
      names: [...(toy?.querySelectorAll('.tr-name') || [])].map(n => n.textContent.trim()),
      fields: [...(toy?.querySelectorAll('.tr-field') || [])].map(l => l.dataset.state),
      words: [...(toy?.querySelectorAll('.tr-state') || [])].map(w => w.textContent.trim()),
      count: toy?.querySelector('.tr-count')?.textContent.trim(),
      disabled: commit?.getAttribute('aria-disabled'), committed: Number(toy?.dataset.committed || 0),
      small: [...(toy?.querySelectorAll('button') || [])].filter(b => b.getBoundingClientRect().height < 44).length };
  });
}

test('Valora toy: nothing commits until every figure is reviewed', async ({ page, vp }) => {
  const fig = page.locator('figure.diagram[data-toy="review-gate"]');
  await fig.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('figure.diagram[data-toy="review-gate"] .toy')?.dataset.state === 'review', null, { timeout: 6000 })
    .catch(() => {});
  let r = await gateState(page);
  if (!r.toy) throw new Error('toy not mounted');
  if (r.svgShown) throw new Error('diagram SVG still shown beside the toy');
  if (r.note !== 'Illustration') throw new Error(`toy note reads "${r.note}"`);
  if (r.names.join() !== 'Figure 1,Figure 2,Figure 3,Figure 4') throw new Error(`field names [${r.names.join(', ')}]`);
  if (r.state !== 'review' || r.fields.some(s => s !== 'suggested')) throw new Error(`after the scan: ${r.state}, fields [${r.fields.join(', ')}]`);
  if (r.disabled !== 'true' || r.count !== '0 of 4 reviewed') throw new Error(`commit disabled=${r.disabled}, count "${r.count}"`);
  if (vp === 'mobile' && r.small) throw new Error(`${r.small} buttons under 44px on a phone`);
  const field = n => fig.locator('.tr-field').nth(n);
  await field(0).getByRole('button', { name: /^Confirm/ }).click();
  // aria-disabled keeps Commit focusable; Playwright won't press it unforced.
  await fig.locator('.tr-commit').click({ force: true });
  r = await gateState(page);
  if (r.committed || r.state !== 'review') throw new Error('committed with figures unreviewed');
  if (r.fields[0] !== 'confirmed' || r.words[0] !== 'Confirmed' || r.count !== '1 of 4 reviewed') throw new Error(`after confirm: ${r.fields[0]}, "${r.words[0]}", "${r.count}"`);
  await field(1).getByRole('button', { name: /^Override/ }).click();
  await page.waitForTimeout(1200);
  await field(2).getByRole('button', { name: /^Confirm/ }).click();
  await field(3).getByRole('button', { name: /^Confirm/ }).click();
  r = await gateState(page);
  if (r.fields[1] !== 'overridden' || r.words[1] !== 'Overridden') throw new Error(`after override: ${r.fields[1]}, "${r.words[1]}"`);
  if (r.disabled !== 'false' || r.count !== '4 of 4 reviewed') throw new Error(`all reviewed, commit disabled=${r.disabled}, count "${r.count}"`);
  await fig.locator('.tr-commit').click();
  await page.waitForTimeout(1200);
  r = await gateState(page);
  if (r.state !== 'committed' || r.committed !== 4) throw new Error(`after commit: ${r.state}, ${r.committed} committed`);
}, p => p === '/work/valora/');

test('Valora toy falls back to the diagram under reduced motion', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  const bad = await reducedMotionProblems(page, 'review-gate');
  if (bad.length) throw new Error(bad.join('; '));
}, p => p === '/work/valora/');

// ── Motion (motion.js) ─────────────────────────────────────
// Parity pull: near the pointer, the spec glyph's shapes drift apart on a
// canvas that XORs them (globalCompositeOperation "xor"), so overlaps stay
// holes in every frame. The <img> keeps its place and its transition name.
// R, the reach of the pull, is 1.5 glyph widths from the glyph's centre.
async function parityProbe(page) {
  return page.evaluate(async () => {
    const g = document.querySelector('.spec .glyph'), img = g.querySelector('img'), c = g.querySelector('canvas.parity');
    if (!c) return { canvas: false, img: getComputedStyle(img).opacity };
    const shown = getComputedStyle(c).display !== 'none' && getComputedStyle(c).visibility !== 'hidden';
    // The img drawn at the canvas's size and offset: at rest the two match.
    const ref = document.createElement('canvas'); ref.width = c.width; ref.height = c.height;
    const box = g.getBoundingClientRect(), cb = c.getBoundingClientRect(), k = c.width / cb.width;
    const r = ref.getContext('2d');
    const im = new Image(); im.src = img.src; await im.decode();
    r.drawImage(im, (box.left - cb.left) * k, (box.top - cb.top) * k, box.width * k, box.height * k);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = r.getImageData(0, 0, c.width, c.height).data;
    let diff = 0, n = 0, dark = 0, opaque = 0;
    for (let i = 3; i < a.length; i += 4) {
      diff += Math.abs(a[i] - b[i]); n += Math.max(a[i], b[i]) > 0 ? 1 : 0;
      if (a[i] === 255) { opaque++; dark += Math.max(a[i - 3], a[i - 2], a[i - 1]) < 60 ? 1 : 0; }
    }
    return { canvas: true, shown, diff: diff / 255 / Math.max(1, n), dark: dark / Math.max(1, opaque),
      img: getComputedStyle(img).opacity, vt: g.style.viewTransitionName, canvasVt: getComputedStyle(c).viewTransitionName };
  });
}

test('parity pull: the glyph comes apart near the pointer and keeps its holes', async ({ page, vp }) => {
  if (vp !== 'desktop') return;
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('.spec .glyph').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
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
}, p => p === '/work/continental/' || p === '/work/lineandform/');

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
    // Ink is white (the accent outline aside): no black pixels left.
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
