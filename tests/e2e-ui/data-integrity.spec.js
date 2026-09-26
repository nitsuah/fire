// @ts-check
/* global state, syncedRevision, saveState, fetchAndApplyPrices, fetchAndApplyMetals, getAggregateNetWorth, getAllocationBuckets, checkAndNotify */
// End-to-end checks for the data-integrity and dashboard behaviour that
// lives in browser-only code (state.js, prices.js, notifications.js, the
// dashboard renderers) and so isn't reachable from the Vitest suite.
// Market data is mocked at the browser's /api/prices and /api/metals calls
// so these never depend on Yahoo being up.
const { test, expect } = require('@playwright/test');

const SEED = {
    importedPositions: [
        {
            id: 'pos-coin',
            account: 'Brokerage',
            symbol: 'COIN',
            description: 'COINBASE',
            quantity: 10,
            lastPrice: 100,
            value: 1000,
            costBasis: 500,
            pnlDollar: 500,
            pnlPercent: 100,
        },
        {
            id: 'pos-spaxx',
            account: 'Brokerage',
            symbol: 'SPAXX**',
            description: 'HELD IN MONEY MARKET',
            quantity: 0,
            lastPrice: 0,
            value: 2000,
            costBasis: 0,
        },
    ],
    customAccounts: [
        { id: 'hysa', name: 'HYSA', type: 'Savings', value: 10000, apy: 4 },
        { id: 'usdc', name: 'USDC', type: 'Crypto', value: 3000, apy: 5 },
        {
            id: 'gold',
            name: 'Gold',
            type: 'Metal',
            metalType: 'gold',
            weightOz: 1,
            value: 1,
            apy: 0,
        },
    ],
    cds: [
        {
            id: 'cd1',
            bank: 'Bank',
            principal: 20000,
            rate: 5,
            maturity: '2099-01-01',
            startDate: '2026-01-01',
        },
    ],
    realEstate: [],
    vehicles: [
        {
            id: 'car',
            year: 2014,
            make: 'Chevy',
            model: 'Malibu',
            currentValue: 6000,
            loanBalance: 1000,
            condition: 'Good',
        },
    ],
    sideGigLedger: [
        {
            id: 'sg1',
            desc: 'Game',
            category: 'eBay',
            revenue: 50,
            expenses: 10,
            net: 40,
        },
        {
            id: 'sg2',
            desc: 'Phone',
            category: 'eBay',
            revenue: 150,
            expenses: 30,
            net: 120,
        },
    ],
    notificationSettings: {
        enabled: true,
        cdAlerts: true,
        fireMilestones: false,
        rebalanceAlerts: false,
        taxHarvestAlerts: false,
        priceMoveAlerts: true,
        priceMoveThreshold: 5,
    },
    netWorthHistory: [],
};

async function seed(request) {
    // No baseRevision → last-write-wins, so seeding always lands.
    const res = await request.post('/api/state', { data: SEED });
    expect(res.ok()).toBeTruthy();
}

async function mockMarket(page, { price = 120, changePercent = 7 } = {}) {
    await page.route('**/api/prices?*', (route) =>
        route.fulfill({
            json: {
                COIN: { price, changePercent, fetchedAt: Date.now() },
            },
        }),
    );
    await page.route('**/api/metals', (route) =>
        route.fulfill({
            json: {
                gold: { price: 4000, payoutPct: 0.95, meltPrice: 3800 },
                silver: { price: 50, payoutPct: 0.88, meltPrice: 44 },
            },
        }),
    );
}

async function open(page) {
    await page.goto('/');
    const btn = page.getByRole('button', { name: /I Understand.*Continue/i });
    try {
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        await btn.click();
    } catch (err) {
        if (err.name !== 'TimeoutError') throw err;
    }
    // Initial load + first live refresh done.
    await page.waitForFunction(() => typeof syncedRevision === 'number');
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
    await seed(request);
});

test('live price refresh updates holdings without touching other data', async ({
    page,
    request,
}) => {
    await mockMarket(page);
    const fullSaves = [];
    page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/state'))
            fullSaves.push(r.url());
    });
    await open(page);
    await page.evaluate(async () => {
        await fetchAndApplyPrices();
        await fetchAndApplyMetals();
    });

    const s = await (await request.get('/api/state')).json();
    const coin = s.importedPositions.find((p) => p.id === 'pos-coin');
    expect(coin.lastPrice).toBe(120);
    expect(coin.value).toBe(1200); // stored quantity × quote
    expect(coin.pnlDollar).toBe(700);
    expect(coin.dayChangePercent).toBe(7);
    const gold = s.customAccounts.find((a) => a.id === 'gold');
    expect(gold.value).toBeCloseTo(3800, 6); // 1oz × spot × 95%
    // The refresh used the narrow PATCH, never a full-state save.
    expect(fullSaves).toHaveLength(0);
    expect(s.sideGigLedger.map((e) => e.net)).toEqual([40, 120]);
});

test('a stale tab is refused (409), re-syncs, and asks to redo the change', async ({
    browser,
}) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await mockMarket(a);
    await mockMarket(b);
    await open(a);
    await open(b);

    // Tab A saves a change first.
    await a.evaluate(async () => {
        state.taxRate = 22;
        await saveState();
    });

    // Tab B still has the old copy; its save must not overwrite A's.
    let dialog = '';
    b.on('dialog', (d) => {
        dialog = d.message();
        d.accept();
    });
    await b.evaluate(async () => {
        state.taxRate = 99;
        await saveState();
    });

    expect(dialog).toMatch(/out of date/i);
    expect(await b.evaluate(() => state.taxRate)).toBe(22);
    const s = await (await a.request.get('/api/state')).json();
    expect(s.taxRate).toBe(22);
    await ctxA.close();
    await ctxB.close();
});

test('allocation buckets, Other Assets and the banner agree with net worth', async ({
    page,
}) => {
    await mockMarket(page);
    await open(page);
    const r = await page.evaluate(() => {
        const buckets = getAllocationBuckets();
        return {
            nw: getAggregateNetWorth(),
            bucketSum: buckets.reduce((s, x) => s + x.amt, 0),
            crypto: buckets.find((x) => x.key === 'Crypto').amt,
            metals: buckets.find((x) => x.key === 'Metals').amt,
        };
    });
    expect(r.bucketSum).toBeCloseTo(r.nw, 6);
    expect(r.crypto).toBe(3000);
    // Side hustle income ($160) is income, not an asset.
    // Cash 2000+10000, CD 20000, equities 1200, crypto 3000, gold 3800, car 5000.
    expect(r.nw).toBeCloseTo(45000, 6);

    const other = page.locator('#dashboard-other-assets-panel');
    await expect(other).toContainText('Gold');
    await expect(other).toContainText('$8,800.00'); // gold 3,800 + car 5,000
    // Annual income banner includes HYSA + CD + staking interest.
    await expect(page.locator('#banner-interest-income')).toContainText(
        '$1,550.00', // 400 + 1,000 + 150
    );
});

test('a big daily move raises a bell alert', async ({ page }) => {
    await mockMarket(page, { changePercent: 7 });
    await open(page);
    await page.evaluate(() => fetchAndApplyPrices());
    const alerts = await page.evaluate(() =>
        checkAndNotify(state, false).map((x) => x.msg),
    );
    expect(alerts.some((m) => /COIN is up 7\.0% today/.test(m))).toBe(true);
    await expect(page.locator('#positions-price-asof')).toContainText('Live');
});

test('side hustle totals, missing-cost filter and bulk tagging', async ({
    page,
    request,
}) => {
    await mockMarket(page);
    await open(page);
    await page.locator('#btn-tab-sidegig').click();
    const totals = page.locator('#sidegig-totals');
    await expect(totals).toContainText('$200.00'); // sales
    await expect(totals).toContainText('(0/2 entered)');
    await expect(totals).toContainText('2 sales still need an item cost');

    await page.locator('#sg-bulk-basis').selectOption('business');
    await page.locator('#btn-sg-bulk-tag').click();
    await expect
        .poll(async () =>
            (await (await request.get('/api/state')).json()).sideGigLedger.map(
                (e) => e.basisType,
            ),
        )
        .toEqual(['business', 'business']);
});
