// Renders a spot's compose.html frame by frame (every frame is a pure
// function of time: window.render(t)). Capture data is injected as
// window.PROMO so the page never needs file:// fetches.
//
// Usage (inside the promo image): node render.js <spot> [times]
//   times: optional comma list, e.g. "1.8,2.6" → stills only
const { chromium } = require('/deps/node_modules/playwright');
const fs = require('fs');

const spot = process.argv[2];
const stills = process.argv[3];
const WORK = `/out/${spot}`;

(async () => {
    const promo = {
        boxes: JSON.parse(
            fs.readFileSync('/out/capture/proj-boxes.json', 'utf8'),
        ),
        mcpStatus: JSON.parse(
            fs.readFileSync('/out/capture/mcp-status.json', 'utf8'),
        ),
    };
    const browser = await chromium.launch({
        args: ['--allow-file-access-from-files'],
    });
    const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
    });
    page.on('console', (m) => console.log('[page]', m.text()));
    page.on('pageerror', (e) => {
        console.error('[page error]', e.message);
        process.exit(1);
    });
    const spotCfg = JSON.parse(
        fs.readFileSync(`/repo/promo/${spot}/spot.json`, 'utf8'),
    );
    await page.addInitScript(
        ([p, s]) => {
            window.PROMO = p;
            window.SPOT = s;
        },
        [promo, spotCfg],
    );
    // Served from /out/<spot>/ so relative "crops/..." resolves to the capture.
    await page.goto(`file://${WORK}/compose.html`);
    await page.evaluate(() => window.ready);
    const { duration, fps } = await page.evaluate(() => ({
        duration: window.DURATION,
        fps: window.FPS || 30,
    }));

    const times = stills
        ? stills.split(',').map(Number)
        : Array.from({ length: Math.round(fps * duration) }, (_, i) => i / fps);
    const dir = stills ? `${WORK}/stills` : `${WORK}/frames`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < times.length; i++) {
        await page.evaluate((t) => window.render(t), times[i]);
        const name = stills
            ? `t${times[i].toFixed(2)}.png`
            : `f${String(i).padStart(4, '0')}.png`;
        await page.screenshot({ path: `${dir}/${name}` });
        if (!stills && i % 90 === 0)
            console.log(`render: frame ${i}/${times.length}`);
    }
    await browser.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
