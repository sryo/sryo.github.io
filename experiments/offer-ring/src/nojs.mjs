// Shoots the hero with JavaScript off, wide and narrow.
import { chromium } from '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/pw/node_modules/playwright/index.mjs';
const D = '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/r11/offer-ring/';
const b = await chromium.launch();
for (const [w, h, n] of [[1440, 900, 'nojs-desktop'], [390, 844, 'nojs-phone']]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: false });
    const p = await c.newPage();
    await p.goto('http://localhost:8531/offer-ring/', { waitUntil: 'networkidle' });
    await p.screenshot({ path: D + n + '.png' });
}
await b.close();
