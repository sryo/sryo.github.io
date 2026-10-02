// Checks hover intent (rest lights, sweep doesn't), keyboard focus, and phone tap.
import { chromium } from '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/pw/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:8531/offer-ring/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const lit = () => p.evaluate(() => [...document.querySelectorAll('.or-offer')].findIndex(b => b.getAttribute('aria-expanded') === 'true'));
const box = async i => { const r = await p.locator(`.or-offer[data-i="${i}"]`).boundingBox(); return [r.x + 40, r.y + r.height / 2]; };
let [x, y] = await box(0); await p.mouse.move(x, y);
const link = await p.locator('#or-p0 .or-see a').first().boundingBox();
// sweep from offer 0 down to the proof link over ~120ms
for (let k = 1; k <= 8; k++) { await p.mouse.move(x, y + (link.y + 5 - y) * k / 8); await p.waitForTimeout(15); }
await p.waitForTimeout(400);
console.log('after sweep to link, lit =', await lit());
[x, y] = await box(3); await p.mouse.move(x, y); await p.waitForTimeout(400);
console.log('after resting on 3, lit =', await lit());
await p.keyboard.press('Tab'); 
await p.focus('.or-offer[data-i="1"]'); await p.keyboard.press('Tab');
console.log('focused', await p.evaluate(() => document.activeElement.textContent.slice(0, 20)), 'lit =', await lit());
await b.close();
