// Runs the real FIRE app against a throwaway demo DB (promo/demo-seed.js)
// and captures the UI pieces the promo spots animate, plus the real MCP
// output. Runs inside the promo Docker image (see promo/build.sh).
//
// Writes to /out/capture/:
//   crops/*.png          2x element screenshots (dashboard, holdings rows, charts…)
//   proj-boxes.json      chart card + scenario button positions (for the cursor)
//   mcp-status.json      fire_status_summary output from the real MCP server
//   demo-db.json         the seeded DB (what the MCP server reads)
const { chromium } = require('/deps/node_modules/playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const SEED = require('./demo-seed.js');

const OUT = '/out/capture';
const C = `${OUT}/crops`;
const PORT = 3011;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Prices/metals are mocked so captures never depend on Yahoo being up.
const PRICES = Object.fromEntries(
    SEED.importedPositions
        .filter((p) => p.lastPrice)
        .map((p) => [p.symbol, p.lastPrice]),
);

(async () => {
    fs.mkdirSync(C, { recursive: true });
    fs.writeFileSync('/tmp/demo-db.json', '{}');
    const server = spawn('node', ['app/server.js'], {
        cwd: '/repo',
        stdio: ['ignore', 'ignore', 'inherit'],
        env: {
            ...process.env,
            PORT: String(PORT),
            FIRE_DB_FILE: '/tmp/demo-db.json',
            FIRE_AUTH_DISABLED: 'true',
        },
    });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) {
        try {
            await fetch(`${BASE}/`);
            up = true;
        } catch {
            await sleep(250);
        }
    }
    if (!up) throw new Error('FIRE server did not start on :' + PORT);

    const r = await fetch(`${BASE}/api/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(SEED),
    });
    if (!r.ok) throw new Error('seeding failed: ' + r.status);
    await sleep(500);
    fs.copyFileSync('/tmp/demo-db.json', `${OUT}/demo-db.json`);

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.route('**/api/prices?*', (route) =>
        route.fulfill({
            json: Object.fromEntries(
                Object.entries(PRICES).map(([k, p]) => [
                    k,
                    { price: p, changePercent: 0.8, fetchedAt: Date.now() },
                ]),
            ),
        }),
    );
    await page.route('**/api/prices/stream*', (route) => route.abort());
    await page.route('**/api/metals', (route) =>
        route.fulfill({
            json: {
                gold: { price: 3800, payoutPct: 0.95, meltPrice: 3610 },
                silver: { price: 44, payoutPct: 0.88, meltPrice: 39 },
            },
        }),
    );
    await page.goto(`${BASE}/`);
    const consent = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await consent.waitFor({ state: 'visible', timeout: 4000 });
        await consent.click();
    } catch {
        // Consent already stored; the modal never renders.
    }
    await sleep(2500);

    // Dashboard
    await page.screenshot({ path: `${C}/dash.png` });
    await page.screenshot({
        path: `${C}/header.png`,
        clip: { x: 260, y: 0, width: 1660, height: 152 },
    });

    // Financial: holdings rows + vehicle row
    await page.click('#btn-tab-financial');
    await sleep(1500);
    const holdings = page
        .locator('#tab-financial .card', {
            has: page.locator('h2, h3', { hasText: /^Holdings$/ }),
        })
        .first();
    await holdings.scrollIntoViewIfNeeded();
    await sleep(400);
    await holdings.screenshot({ path: `${C}/holdings-card.png` });
    const rows = holdings.locator('tr');
    for (let i = 0, n = await rows.count(); i < n; i++)
        await rows.nth(i).screenshot({ path: `${C}/hrow-${i}.png` });
    const veh = page
        .locator('#tab-financial .card', {
            has: page.locator('h2, h3', { hasText: /Vehicle/i }),
        })
        .first();
    await veh.scrollIntoViewIfNeeded();
    await sleep(400);
    await veh.screenshot({ path: `${C}/veh-card.png` });
    const vr = veh.locator('tr');
    for (let i = 0, n = await vr.count(); i < n; i++)
        await vr.nth(i).screenshot({ path: `${C}/vrow-${i}.png` });

    // Projections chart in base / bear / bull
    await page.click('#btn-tab-projections');
    await sleep(1800);
    const chart = page
        .locator('#tab-projections .card', {
            has: page.locator('h2, h3', { hasText: 'Retirement Growth Path' }),
        })
        .first();
    await chart.screenshot({ path: `${C}/proj-base.png` });
    const btns = {};
    for (const [name, re] of [
        ['bear', /Bear/],
        ['base', /Base Rate/],
        ['bull', /Bull/],
    ])
        btns[name] = await chart
            .getByRole('button', { name: re })
            .boundingBox();
    const box = await chart.boundingBox();
    for (const [name, re] of [
        ['bear', /Bear/],
        ['bull', /Bull/],
    ]) {
        await chart.getByRole('button', { name: re }).click();
        await sleep(1600);
        await chart.screenshot({ path: `${C}/proj-${name}.png` });
    }
    fs.writeFileSync(`${OUT}/proj-boxes.json`, JSON.stringify({ box, btns }));
    const sc = page
        .locator('#tab-projections .card', {
            has: page.locator('h2, h3', { hasText: 'Scenario Comparison' }),
        })
        .first();
    await sc.scrollIntoViewIfNeeded();
    await sleep(500);
    await sc.screenshot({ path: `${C}/scenarios.png` });

    // Full-viewport tab shots (for the landing page / longer spots)
    for (const t of ['insights', 'sidegig', 'expenses']) {
        await page.click(`#btn-tab-${t}`);
        await sleep(1500);
        await ctx.pages()[0].screenshot({ path: `${C}/tab-${t}.png` });
    }

    await browser.close();
    server.kill();

    // Real MCP output against the same demo DB
    const status = execFileSync(
        'node',
        ['/repo/promo/mcp.mjs', 'fire_status_summary'],
        {
            env: { ...process.env, FIRE_DB_FILE: `${OUT}/demo-db.json` },
        },
    );
    fs.writeFileSync(`${OUT}/mcp-status.json`, status);
    console.log('capture: ok');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
