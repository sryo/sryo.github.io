// Checks the frame loop sleeps between tour steps and after the tour ends.
import { chromium } from '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/pw/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.addInitScript(() => { window.__f = 0; const r = window.requestAnimationFrame; window.requestAnimationFrame = f => { window.__f++; return r(f); }; });
await p.goto('http://localhost:8531/offer-ring/');
const sample = async (t) => { await p.waitForTimeout(t); const a = await p.evaluate(() => __f); await p.waitForTimeout(400); const c = await p.evaluate(() => __f); return c - a; };
console.log('frames in 400ms at ~4.3s:', await sample(3900));
console.log('pressed:', await p.evaluate(() => [...document.querySelectorAll('.or-offer')].findIndex(b => b.getAttribute('aria-expanded') === 'true')));
console.log('frames at ~34s:', await sample(29000));
console.log('pressed after tour:', await p.evaluate(() => [...document.querySelectorAll('.or-offer')].findIndex(b => b.getAttribute('aria-expanded') === 'true')));
await b.close();
