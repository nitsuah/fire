// fire-specific journey fixture: every journey starts from the fictional
// promo demo portfolio, mocked prices and a frozen clock, so a step's
// screenshot only changes when the UI does.
const { test: base, expect, step: baseStep } = require('./journey');
const SEED = require('../../promo/demo-seed.js');
const { mockPrices } = require('../../promo/demo-mocks.js');

// The demo seed's "today" (its history ends 2026-09-27).
const NOW = '2026-09-27T16:00:00Z';

// Server-stamped regions that follow the real date even with the browser
// clock frozen (today's net-worth snapshot).
const volatile = (page) => [
    page.locator('#dash-card-nw-history'),
    page.locator('#positions-price-asof'),
];

const test = base.extend({
    page: async ({ page, request }, use) => {
        const res = await request.post('/api/state', { data: SEED });
        expect(res.ok(), 'seeding the demo portfolio').toBeTruthy();
        await page.clock.setFixedTime(new Date(NOW));
        // Chart.js animates on canvas, which toHaveScreenshot's
        // animations:'disabled' can't stop; turn it off as the CDN script
        // defines window.Chart.
        await page.addInitScript(() => {
            let chart;
            Object.defineProperty(window, 'Chart', {
                configurable: true,
                get: () => chart,
                set: (v) => {
                    chart = v;
                    if (v && v.defaults) v.defaults.animation = false;
                },
            });
        });
        await mockPrices(page, { fetchedAt: Date.parse(NOW) });
        await use(page);
        // Let this page's debounced saves land before the next journey
        // reseeds, or they overwrite the fresh demo state.
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(500);
    },
});

function step(page, title, fn, opts = {}) {
    return baseStep(page, title, fn, {
        ...opts,
        mask: [...volatile(page), ...(opts.mask || [])],
    });
}

async function openApp(page) {
    await page.goto('/');
    await page.getByRole('button', { name: /I Understand.*Continue/i }).click();
    await expect(page.locator('#banner-networth')).not.toHaveText(/^\s*$/);
    // Startup fetches (prices, status checks, live-value saves) re-render
    // cards; screenshot only once they're done.
    await page.waitForLoadState('networkidle');
}

async function openTab(page, name) {
    await page.locator(`#btn-tab-${name}`).click();
    await expect(page.locator(`#tab-${name}`)).toBeVisible();
}

module.exports = { test, expect, step, openApp, openTab, SEED };
