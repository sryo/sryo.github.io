// Shoots the offer ring: rest, two mid-interaction moments, phone, reduced motion (plus extras on demand).
import { chromium } from '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/pw/node_modules/playwright/index.mjs';
const U = 'http://localhost:8531/offer-ring/';
const D = '/private/tmp/claude-501/-Users-mateoyadarola-Documents-sryo-github-io/df32551f-00c5-4524-bd8e-393515a95703/scratchpad/r11/offer-ring/';
const only = process.argv[2];
const want = k => !only || only.split(',').includes(k);
const b = await chromium.launch();
const errs = [];
async function pg(opts, wait = 'networkidle') {
    const c = await b.newContext(opts);
    const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(U, { waitUntil: wait });
    return p;
}
let p;
if (want('desktop')) {
    p = await pg({ viewport: { width: 1440, height: 900 } });
    await p.mouse.move(1430, 20);
    await p.waitForTimeout(2900);
    await p.screenshot({ path: D + 'desktop-rest.png' });
    // hover an offer: mid-swing, then settled with pieces apart
    const r = await p.locator('.or-offer[data-i="2"]').boundingBox();
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 5 });
    await p.waitForTimeout(160 + 260);
    await p.screenshot({ path: D + 'desktop-swing.png' });
    const r2 = await p.locator('.or-offer[data-i="1"]').boundingBox();
    await p.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 2, { steps: 5 });
    await p.waitForTimeout(1600);
    await p.screenshot({ path: D + 'desktop-offer.png' });
    // pointer on a front glyph
    const g = await p.evaluate(() => { const a = [...document.querySelectorAll('.or-g')].sort((x, y) => +y.style.zIndex - +x.style.zIndex)[0].getBoundingClientRect(); return [a.x + a.width / 2, a.y + a.height / 2]; });
    await p.mouse.move(g[0] + 30, g[1] - 10, { steps: 6 });
    await p.waitForTimeout(700);
    await p.screenshot({ path: D + 'desktop-glyph.png' });
    await p.mouse.wheel(0, 420);
    await p.waitForTimeout(700);
    await p.screenshot({ path: D + 'desktop-scroll.png' });
}
if (want('arrive')) {
    for (const t of [250, 600]) {
        p = await pg({ viewport: { width: 1440, height: 900 } }, 'commit');
        await p.waitForFunction(() => document.querySelector('.or-g'));
        await p.waitForTimeout(t);
        await p.screenshot({ path: D + 'desktop-arrive-' + t + '.png' });
    }
}
if (want('phone')) {
    p = await pg({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.waitForTimeout(3600);
    await p.screenshot({ path: D + 'phone-rest.png' });
    await p.locator('.or-offer[data-i="2"]').tap();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: D + 'phone.png' });
}
if (want('reduced')) {
    p = await pg({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await p.waitForTimeout(500);
    await p.screenshot({ path: D + 'desktop-reduced.png' });
}
if (want('dark')) {
    p = await pg({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await p.waitForTimeout(4200);
    await p.screenshot({ path: D + 'desktop-dark.png' });
}
if (want('widths')) {
    for (const [w, h] of [[1024, 768], [1920, 1080], [768, 1024]]) {
        p = await pg({ viewport: { width: w, height: h } });
        await p.waitForTimeout(4200);
        await p.screenshot({ path: D + 'check-' + w + '.png' });
    }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
