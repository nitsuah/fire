// Extra captures for the narrated tour spots (promo/*/spot.json with
// "type": "tour"). Called by capture.js after its own shots, on the same
// seeded demo app. Every crop is a real card from the real UI.
//
// Writes crops/card-*.png (one card), crops/hero-*.png (Projections hero
// row per growth preset) and a few interaction shots.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function captureTour(page, C) {
    // Click targets for the composer: centre of each target in CSS px from
    // the top-left of the crop it sits in (tour-boxes.json → PROMO.tour).
    const boxes = {};
    // Returns null (and the named point is skipped) if either box is missing.
    const frac = async (loc, rect) => {
        const b = await loc.boundingBox();
        if (!b || !rect) return null;
        return {
            px: b.x + b.width / 2 - rect.x,
            py: b.y + b.height / 2 - rect.y,
        };
    };
    const tab = async (name) => {
        await page.click(`#btn-tab-${name}`);
        await sleep(1300);
    };
    const top = () =>
        page.evaluate(() =>
            document.querySelector('.scroll-container').scrollTo(0, 0),
        );
    const card = (pane, title) =>
        page
            .locator(`#tab-${pane} .card`, {
                has: page.locator('h2, h3', { hasText: title }),
            })
            .first();
    const shoot = async (loc, name) => {
        await loc.scrollIntoViewIfNeeded();
        await sleep(450);
        await loc.screenshot({ path: `${C}/${name}.png` });
    };
    const tryShoot = async (loc, name) => {
        try {
            await shoot(loc, name);
        } catch (e) {
            console.warn(`capture-tour: skipped ${name}: ${e.message}`);
        }
    };

    // capture.js leaves the Dashboard customized (pinned/collapsed cards);
    // start from the default layout.
    // Chaos mode off too, so the Projections shots show the plain plan.
    await page.evaluate(() =>
        ['fire_layout_v2', 'fire_chaos_mode', 'fire_chaos_mitigations'].forEach(
            (k) => localStorage.removeItem(k),
        ),
    );
    await page.reload();
    await sleep(2500);

    // ── Dashboard ──
    await tab('dashboard');
    await top();
    for (const [title, name] of [
        ['Top Investment Positions', 'positions'],
        [/^Asset Allocation/, 'allocation'],
        ['Cash & Fixed Income', 'cash'],
        ['Net Worth History', 'nw-history'],
        ['Other Assets', 'other-assets'],
    ])
        await tryShoot(card('dashboard', title), `card-${name}`);
    // Allocation drill-down: click the first category button.
    try {
        const alloc = card('dashboard', /Asset Allocation|›/);
        const btn = alloc
            .locator('button')
            .filter({ hasText: /Stocks|Equit|Invest/i })
            .first();
        await btn.click({ timeout: 2000 });
        await sleep(900);
        await shoot(alloc, 'card-allocation-drill');
    } catch (e) {
        console.warn('capture-tour: no allocation drill-down:', e.message);
    }

    // ── Financial overview ──
    await tab('financial');
    await top();
    for (const [title, name] of [
        ['Net Monthly Cash Flow', 'cashflow'],
        ['Properties', 'properties'],
        ['Vehicles', 'vehicles'],
        ['CD Ladder', 'cd-ladder'],
    ])
        await tryShoot(card('financial', title), `card-${name}`);
    // Unified add form, one shot per tab.
    const addCard = page
        .locator('#tab-financial .card', { has: page.locator('[data-ua-tab]') })
        .first();
    for (const t of ['csv', 'account', 'cd', 'realestate', 'vehicle']) {
        try {
            await addCard.locator(`[data-ua-tab="${t}"]`).click();
            await sleep(500);
            if (t === 'account') {
                // Show the crypto identifier fields (ENS / 0x / ticker).
                await page
                    .selectOption('#acc-type', { label: /crypto/i })
                    .catch(() => page.selectOption('#acc-type', 'Crypto'));
                await page.fill('#acc-name', 'Main wallet');
                await page.fill('#acc-identifier', 'vitalik.eth');
                await sleep(400);
            }
            if (t === 'vehicle') {
                await page.fill('#veh-vin', '1G1ZD5ST0EF123456');
                await sleep(300);
            }
            await shoot(addCard, `card-add-${t}`);
        } catch (e) {
            console.warn(`capture-tour: add form ${t}:`, e.message);
        }
    }
    await page.fill('#acc-name', '').catch(() => {});
    await page.fill('#acc-identifier', '').catch(() => {});
    await page.fill('#veh-vin', '').catch(() => {});

    // ── Expenses ──
    await tab('expenses');
    await top();
    for (const [title, name] of [
        ['Basic Budget & Expenses', 'budget'],
        ['Tax Estimator & Summary', 'tax'],
        ['Spending Upload', 'spending'],
    ])
        await tryShoot(card('expenses', title), `card-${name}`);

    // ── Insights ──
    await tab('insights');
    await top();
    await tryShoot(
        page
            .locator('#tab-insights .card', { hasText: 'Portfolio Insights' })
            .first(),
        'card-insights',
    );
    const reb = card('insights', 'Portfolio Rebalancing');
    await tryShoot(reb, 'card-rebalance');
    try {
        await reb
            .getByRole('button', { name: /Recalculate|Calculate/i })
            .first()
            .click({ timeout: 2000 });
        await sleep(900);
        await shoot(reb, 'card-rebalance-trades');
    } catch (e) {
        console.warn('capture-tour: rebalance recalc:', e.message);
    }
    await tryShoot(card('insights', 'Tax-Loss Harvesting Alerts'), 'card-tlh');

    // ── Side Hustle Hub ──
    await tab('sidegig');
    await top();
    const fee = card('sidegig', 'Platform Fee Calculator');
    await tryShoot(fee, 'card-fee-ebay');
    for (const [label, name] of [
        ['Etsy', 'etsy'],
        ['FB Marketplace', 'fb'],
        ['Mercari', 'mercari'],
        ['Poshmark', 'poshmark'],
    ]) {
        try {
            await fee.getByRole('button', { name: label, exact: true }).click();
            await sleep(600);
            await shoot(fee, `card-fee-${name}`);
        } catch (e) {
            console.warn(`capture-tour: fee ${name}:`, e.message);
        }
    }
    await fee
        .getByRole('button', { name: 'eBay', exact: true })
        .click()
        .catch(() => {});
    for (const [title, name] of [
        ['Side Hustle Accelerators', 'accelerators'],
        ['eBay Sales Sync', 'ebay-sync'],
        ['Etsy Sales Sync', 'etsy-sync'],
        ['Side Gig Ledger', 'ledger'],
    ])
        await tryShoot(card('sidegig', title), `card-${name}`);

    // ── Settings ──
    await tab('settings');
    await top();
    for (const [title, name] of [
        ['Projection Defaults', 'defaults'],
        ['Notifications & Alerts', 'alerts'],
        ['Plaid Transaction Sync', 'plaid'],
        ['CoinTracker Wallets', 'cointracker'],
        ['Marketplace Connections', 'marketplaces'],
        ['Data Management', 'data'],
        ['Google Drive Backup', 'drive'],
        ['Privacy & Terms', 'privacy'],
    ])
        await tryShoot(card('settings', title), `card-${name}`);

    // ── Projections: milestones, line toggles, growth presets ──
    await tab('projections');
    await top();
    await tryShoot(
        card('projections', 'Milestone Predictions'),
        'card-milestones',
    );
    const chart = card('projections', 'Retirement Growth Path');
    for (const line of ['coast', 'benchmark'])
        await chart.locator(`[data-line="${line}"]`).click();
    await sleep(1200);
    await shoot(chart, 'proj-lines');
    {
        const r = await chart.boundingBox();
        for (const line of ['coast', 'benchmark', 'lean', 'fat']) {
            const p = await frac(chart.locator(`[data-line="${line}"]`), r);
            if (p) boxes[`line-${line}`] = p;
            else console.warn(`capture-tour: no box for line-${line}`);
        }
    }
    for (const line of ['coast', 'benchmark'])
        await chart.locator(`[data-line="${line}"]`).click();
    await sleep(600);
    // Growth Settings + the chart side by side, once per growth preset. The
    // layout manager moves cards into sections, so clip their union.
    const settings = page.locator('#proj-settings-card');
    const presets = page.locator('#proj-settings-presets button');
    const n = await presets.count();
    const names = [];
    for (let i = 0; i < n; i++)
        names.push((await presets.nth(i).innerText()).trim());
    console.log('capture-tour: growth presets:', names.join(' | '));
    await top();
    await sleep(500);
    const heroShot = async (name) => {
        const a = await settings.boundingBox();
        const b = await chart.boundingBox();
        if (!a || !b)
            throw new Error(
                'Growth Settings or the growth chart is not visible',
            );
        const x = Math.min(a.x, b.x),
            y = Math.min(a.y, b.y);
        const clip = {
            x,
            y,
            width: Math.max(a.x + a.width, b.x + b.width) - x,
            height: Math.min(
                1080 - y,
                Math.max(a.y + a.height, b.y + b.height) - y,
            ),
        };
        await page.screenshot({ path: `${C}/${name}.png`, clip });
        return clip;
    };
    // A layout change here skips the preset shots but keeps the run going,
    // so tour-boxes.json and capture.js's MCP outputs are still written.
    try {
        const heroClip = await heroShot('hero-seeded');
        for (let i = 0; i < n; i++) {
            const p = await frac(presets.nth(i), heroClip);
            if (p) boxes[`preset-${i}`] = p;
        }
        await shoot(settings, 'card-growth');
        for (let i = 0; i < n; i++) {
            await presets.nth(i).click();
            await sleep(1400);
            await top();
            await sleep(300);
            await heroShot(`hero-preset-${i}`);
        }
    } catch (e) {
        console.warn('capture-tour: skipped growth presets:', e.message);
    }
    require('fs').writeFileSync(
        `${C}/../tour-boxes.json`,
        JSON.stringify(boxes),
    );
    console.log('capture-tour: ok');
};
