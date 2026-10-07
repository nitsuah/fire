// Renders a spot's compose.html frame by frame (every frame is a pure
// function of time: window.render(t)). Capture data is injected as
// window.PROMO (and narrate.py's timeline as window.TIMELINE) so the page
// never needs file:// fetches.
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
        tour: fs.existsSync('/out/capture/tour-boxes.json')
            ? JSON.parse(
                  fs.readFileSync('/out/capture/tour-boxes.json', 'utf8'),
              )
            : {},
        // Real MCP tool output, keyed by tool (capture.js → mcp-<tool>.json).
        mcp: Object.fromEntries(
            fs
                .readdirSync('/out/capture')
                .filter(
                    (f) => /^mcp-.+\.json$/.test(f) && f !== 'mcp-status.json',
                )
                .map((f) => [
                    f.slice(4, -5),
                    JSON.parse(fs.readFileSync(`/out/capture/${f}`, 'utf8')),
                ]),
        ),
        chaos: fs.existsSync('/out/capture/chaos.json')
            ? JSON.parse(fs.readFileSync('/out/capture/chaos.json', 'utf8'))
            : null,
    };
    const browser = await chromium.launch({
        args: ['--allow-file-access-from-files'],
    });
    const spotCfg = JSON.parse(
        fs.readFileSync(`/repo/promo/${spot}/spot.json`, 'utf8'),
    );
    // Written by narrate.py: scene timing (tour spots) + captions.
    const timeline = fs.existsSync(`${WORK}/timeline.json`)
        ? JSON.parse(fs.readFileSync(`${WORK}/timeline.json`, 'utf8'))
        : null;
    // render(t) is a pure function of time, so frames can be split across
    // several pages (RENDER_WORKERS, default 4) and rendered in parallel.
    const openPage = async () => {
        const page = await browser.newPage({
            viewport: { width: 1920, height: 1080 },
        });
        page.on('console', (m) => console.log('[page]', m.text()));
        page.on('pageerror', (e) => {
            console.error('[page error]', e.message);
            process.exit(1);
        });
        await page.addInitScript(
            ([p, s, tl]) => {
                window.PROMO = p;
                window.SPOT = s;
                window.TIMELINE = tl;
            },
            [promo, spotCfg, timeline],
        );
        // Served from /out/<spot>/ so relative "crops/..." resolves to the capture.
        await page.goto(`file://${WORK}/compose.html`);
        await page.evaluate(() => window.ready);
        return page;
    };
    const first = await openPage();
    const { duration, fps } = await first.evaluate(() => ({
        duration: window.DURATION,
        fps: window.FPS || 30,
    }));

    const times = stills
        ? stills.split(',').map(Number)
        : Array.from({ length: Math.round(fps * duration) }, (_, i) => i / fps);
    const dir = stills ? `${WORK}/stills` : `${WORK}/frames`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const workers = stills
        ? 1
        : Math.max(1, Number(process.env.RENDER_WORKERS) || 4);
    const pages = [first];
    while (pages.length < workers) pages.push(await openPage());
    let done = 0;
    await Promise.all(
        pages.map(async (page, w) => {
            for (let i = w; i < times.length; i += workers) {
                await page.evaluate((t) => window.render(t), times[i]);
                const name = stills
                    ? `t${times[i].toFixed(2)}.png`
                    : `f${String(i).padStart(4, '0')}.png`;
                await page.screenshot({ path: `${dir}/${name}` });
                if (!stills && ++done % 90 === 0)
                    console.log(`render: frame ${done}/${times.length}`);
            }
        }),
    );
    await browser.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
