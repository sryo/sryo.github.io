// Browser tests for index.html. Run: node tests/site.mjs
// Screenshots go to $SHOTS_DIR (default: tests/shots, gitignored).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS_DIR || resolve(ROOT, 'tests/shots');
mkdirSync(SHOTS, { recursive: true });

// Use a local playwright if installed, else the global one.
const req = createRequire(import.meta.url);
let playwright;
try { playwright = req('playwright'); }
catch { playwright = req(resolve(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = playwright;

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── Tests ─────────────────────────────────────────────────────
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

test('images have alt text', async ({ page }) => {
  const n = await page.locator('img:not([alt])').count();
  if (n) throw new Error(`${n} <img> without alt`);
});

// ── Runner ────────────────────────────────────────────────────
// Serve over HTTP like GitHub Pages; file:// blocks font loading.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
let failed = 0;
for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.screenshot({ path: resolve(SHOTS, `index-${vp}.png`), fullPage: true });
  for (const t of tests) {
    try { await t.fn({ page, errors, vp }); console.log(`  ✓ [${vp}] ${t.name}`); }
    catch (e) { failed++; console.log(`  ✗ [${vp}] ${t.name}: ${e.message}`); }
  }
  await page.close();
}
await browser.close();
server.close();
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('All site checks passed.');
