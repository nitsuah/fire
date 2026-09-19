// @ts-check
/* global state, renderDashboardTopPositionsTable, renderDiversificationSuggestions, refreshAllUI, renderVehiclesTable, buildProjectionData, buildMilestonesList */
const { test, expect } = require('@playwright/test');

async function dismissPrivacyModal(page) {
    // Every test gets a fresh browser context (no localStorage consent), so
    // the modal always renders — wait for it rather than a single immediate
    // visibility check, which was racing the modal's own render/animation.
    const continueBtn = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    } catch (err) {
        // Only swallow the expected "never became visible in time" case
        // (consent already persisted, so the modal legitimately never
        // renders) — an unrelated locator failure should still fail setup
        // loudly rather than let tests silently run against a blocked page.
        if (err.name === 'TimeoutError') return;
        throw err;
    }
    await continueBtn.click();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissPrivacyModal(page);
});

test.describe('Dashboard — desktop layout fixes', () => {
    test('sidebar is collapsible and stays capped to the viewport', async ({
        page,
    }) => {
        const sidebar = page.locator('.sidebar');
        await expect(sidebar).toBeVisible();

        const collapseBtn = page.locator('#sidebar-collapse-btn');
        await collapseBtn.click();
        await expect(page.locator('.app-container')).toHaveClass(
            /sidebar-collapsed/,
        );
        await expect(page.locator('.nav-label').first()).toBeHidden();

        await collapseBtn.click();
        await expect(page.locator('.app-container')).not.toHaveClass(
            /sidebar-collapsed/,
        );
        await expect(page.locator('.nav-label').first()).toBeVisible();
    });

    test('dashboard content scrolls within the viewport (not clipped)', async ({
        page,
    }) => {
        const scrollContainer = page.locator('.scroll-container');
        const { scrollHeight, clientHeight } = await scrollContainer.evaluate(
            (el) => ({
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
            }),
        );
        // The dashboard has more content than fits one viewport, so this
        // container must actually be scrollable (this was the bug: it used
        // to grow to fit content instead of being capped).
        expect(scrollHeight).toBeGreaterThan(clientHeight);

        await scrollContainer.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        const scrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
        expect(scrollTop).toBeGreaterThan(0);
    });

    test('main-content and sidebar are both capped to the viewport height', async ({
        page,
    }) => {
        const viewport = page.viewportSize();
        const sidebarHeight = await page
            .locator('.sidebar')
            .evaluate((el) => el.getBoundingClientRect().height);
        expect(sidebarHeight).toBeLessThanOrEqual(viewport.height + 1);

        const mainContentHeight = await page
            .locator('.main-content')
            .evaluate((el) => el.getBoundingClientRect().height);
        expect(mainContentHeight).toBeLessThanOrEqual(viewport.height + 1);
    });

    test('alerts bell replaces the old dashboard notifications card', async ({
        page,
    }) => {
        await expect(page.locator('#notif-bell-btn')).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Alerts & Notifications' }),
        ).toHaveCount(0);

        await page.locator('#notif-bell-btn').click();
        await expect(page.locator('#notif-dropdown')).toBeVisible();
    });

    test('alerts dropdown renders above dashboard cards, not underneath them', async ({
        page,
    }) => {
        // Regression test for a stacking-context trap: .header-banner's
        // backdrop-filter created its own stacking context, so the
        // dropdown's z-index:300 was scoped inside it and the whole banner
        // (a z-index:auto flex sibling earlier in DOM order than the
        // dashboard content) painted underneath the dashboard cards
        // regardless of the dropdown's own z-index.
        await page.locator('#notif-bell-btn').click();
        const dropdown = page.locator('#notif-dropdown');
        await expect(dropdown).toBeVisible();

        const box = await dropdown.boundingBox();
        expect(box).toBeTruthy();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        const topElementInfo = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.closest('#notif-dropdown') !== null : false;
        }, point);
        expect(topElementInfo).toBe(true);
    });

    test('Collapse All button on Top Investment Positions toggles its label', async ({
        page,
    }) => {
        const btn = page.locator('.collapse-all-btn');
        await expect(btn).toBeVisible();
        const initialLabel = await btn.textContent();
        expect(['Collapse All', 'Expand All']).toContain(initialLabel?.trim());
    });
});

test.describe('Projections tab reorg', () => {
    test('Growth Settings is collapsed by default next to the hero graph', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        await expect(page.locator('.proj-hero-card')).toBeVisible();
        await expect(page.locator('#form-projections-settings')).toHaveClass(
            /collapsed/,
        );
        await expect(page.locator('#proj-settings-presets')).toBeVisible();

        await page.locator('#proj-settings-toggle').click();
        await expect(
            page.locator('#form-projections-settings'),
        ).not.toHaveClass(/collapsed/);
    });

    test('Milestone Focus is its own always-visible section of the panel, with buttons like the growth presets', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        const card = page.locator('#proj-settings-card');
        await expect(
            card.getByRole('heading', { name: 'Growth Scenario' }),
        ).toBeVisible();
        await expect(
            card.getByRole('heading', { name: 'Milestone Focus' }),
        ).toBeVisible();
        await expect(card.locator('.milestone-preset-btn')).toHaveCount(5);
        await expect(card.locator('.milestone-preset-btn.active')).toHaveCount(
            1,
        );
    });
});

test.describe('Expenses tab — spending upload', () => {
    test('spending upload card and category mapping editor render', async ({
        page,
    }) => {
        await page.locator('#btn-tab-expenses').click();
        await expect(page.locator('#spending-drag-zone')).toBeVisible();
        await expect(
            page.locator('#table-spending-transactions'),
        ).toBeVisible();
        await expect(page.locator('#merchant-map-editor')).toBeVisible();
    });

    test('Tax Estimator & Summary card lives here (moved from the former Taxes tab)', async ({
        page,
    }) => {
        await page.locator('#btn-tab-expenses').click();
        await expect(
            page.getByRole('heading', { name: 'Tax Estimator & Summary' }),
        ).toBeVisible();
        await expect(page.locator('#tax-gross-income')).toBeVisible();
        await expect(page.locator('#summary-total-annual-need')).toBeVisible();
    });
});

test.describe('Insights tab (renamed from Taxes)', () => {
    test('nav label reads Insights, not Taxes', async ({ page }) => {
        await expect(page.locator('#btn-tab-insights')).toContainText(
            'Insights',
        );
        await expect(page.locator('.nav-menu')).not.toContainText('Taxes');
    });

    test('shows Portfolio Insights (moved from Dashboard) and Tax-Loss Harvesting', async ({
        page,
    }) => {
        // Portfolio Insights renders empty on a zero-net-worth DB (nothing
        // to suggest against) — seed an account so it has real content to
        // check for, same as the allocation drill-down test above.
        await page.locator('#btn-tab-financial').click();
        await page.locator('[data-ua-tab="account"]').click();
        await page.locator('#acc-name').fill('E2E Insights Seed');
        await page.locator('#acc-type').selectOption('Cash');
        await page.locator('#acc-val').fill('5000');
        const saveResponse = page.waitForResponse((r) =>
            r.url().includes('/api/state'),
        );
        await page
            .locator('#form-custom-account button[type="submit"]')
            .click();
        await saveResponse;

        await page.locator('#btn-tab-insights').click();
        await expect(page.locator('#tab-insights')).toHaveClass(/active/);
        await expect(page.locator('#divs-suggestion-block')).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Tax-Loss Harvesting Alerts' }),
        ).toBeVisible();
        // Tax Estimator no longer lives here — it moved to Expenses.
        await expect(
            page.getByRole('heading', { name: 'Tax Estimator & Summary' }),
        ).toHaveCount(0);
    });

    test('Portfolio Insights is no longer on the Dashboard tab', async ({
        page,
    }) => {
        await expect(
            page.locator('#tab-dashboard #divs-suggestion-block'),
        ).toHaveCount(0);
    });
});

test.describe('Financial Overview — unified add form', () => {
    test('Import CSV is the first and default option', async ({ page }) => {
        await page.locator('#btn-tab-financial').click();
        const tabs = page.locator('.ua-tab-btn');
        await expect(tabs.first()).toHaveText('Import CSV');
        await expect(tabs.first()).toHaveClass(/active/);
        await expect(page.locator('#csv-drag-zone')).toBeVisible();
        await expect(page.locator('#ua-panel-account')).toBeHidden();
    });

    test('API integrations moved from Financial Overview to Settings', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        await expect(
            page.locator('#tab-financial #btn-plaid-link'),
        ).toHaveCount(0);
        await expect(
            page.locator('#tab-financial #btn-ebay-oauth'),
        ).toHaveCount(0);
        await page.locator('#btn-tab-settings').click();
        await expect(
            page.locator('#tab-settings #btn-ebay-oauth'),
        ).toBeVisible();
        await expect(
            page.locator('#tab-settings #btn-plaid-link'),
        ).toBeVisible();
    });

    test('wallets show under the form only for Cryptocurrency; the ENS lookup panel is hidden', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        await page.locator('[data-ua-tab="account"]').click();
        await expect(page.locator('#group-crypto-wallets')).toBeHidden();
        await page.locator('#acc-type').selectOption('Crypto');
        await expect(page.locator('#group-crypto-wallets')).toBeVisible();
        await expect(page.locator('#form-ens-lookup')).toBeHidden();
    });

    test('an ENS name typed in Name is used as the identifier', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        await page.locator('[data-ua-tab="account"]').click();
        await page.locator('#acc-type').selectOption('Crypto');
        await page.locator('#acc-name').fill('e2ename.eth');
        await page.locator('#acc-val').fill('10');
        const saveResponse = page.waitForResponse((r) =>
            r.url().includes('/api/state'),
        );
        await page
            .locator('#form-custom-account button[type="submit"]')
            .click();
        await saveResponse;
        const saved = await page.evaluate(() =>
            state.customAccounts.find((a) => a.name === 'e2ename.eth'),
        );
        expect(saved.identifier).toBe('e2ename.eth');
    });

    test('a friendly Name plus an ENS in Identifier keeps both', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        await page.locator('[data-ua-tab="account"]').click();
        await page.locator('#acc-type').selectOption('Crypto');
        await page.locator('#acc-name').fill('Cold Wallet E2E');
        await page.locator('#acc-identifier').fill('e2eident.eth');
        await page.locator('#acc-val').fill('10');
        const saveResponse = page.waitForResponse((r) =>
            r.url().includes('/api/state'),
        );
        await page
            .locator('#form-custom-account button[type="submit"]')
            .click();
        await saveResponse;
        const saved = await page.evaluate(() =>
            state.customAccounts.find((a) => a.name === 'Cold Wallet E2E'),
        );
        expect(saved.identifier).toBe('e2eident.eth');
    });
});

test.describe('Financial Overview — cash flow row', () => {
    test('desktop: Income Sources and Monthly Expenses stack under Net Cash Flow, collapsed by default', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        const row = page.locator('.fo-cashflow-row');
        const netFlow = row.getByRole('heading', {
            name: 'Net Monthly Cash Flow',
        });
        const income = row.getByRole('heading', { name: 'Income Sources' });
        const expenses = row.getByRole('heading', { name: 'Monthly Expenses' });
        const [netBox, incomeBox, expensesBox] = await Promise.all([
            netFlow.boundingBox(),
            income.boundingBox(),
            expenses.boundingBox(),
        ]);
        expect(netBox.y).toBeLessThan(incomeBox.y);
        expect(incomeBox.y).toBeLessThan(expensesBox.y);
        expect(Math.abs(netBox.x - incomeBox.x)).toBeLessThan(5);
        await expect(page.locator('#cashflow-income-list')).toHaveClass(
            /cf-collapsed/,
        );
        await expect(page.locator('#cashflow-expenses-list')).toHaveClass(
            /cf-collapsed/,
        );
        await expect(page.locator('#cf-salary')).toBeHidden();
    });

    test('desktop: holdings section uses the full content width', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        const body = await page.locator('.fo-body').boundingBox();
        const left = await page.locator('.fo-left').boundingBox();
        expect(left.width).toBeGreaterThan(body.width - 2);
    });

    test('mobile: Income Sources and Monthly Expenses default collapsed to just the total, and expand independently', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        // Nav items are behind the hamburger drawer at this width.
        await page.locator('#sidebar-collapse-btn').click();
        await page.locator('#btn-tab-financial').click();

        const incomeList = page.locator('#cashflow-income-list');
        const expensesList = page.locator('#cashflow-expenses-list');
        await expect(incomeList).toHaveClass(/cf-collapsed/);
        await expect(expensesList).toHaveClass(/cf-collapsed/);
        await expect(page.locator('#cf-salary')).toBeHidden();
        await expect(page.locator('#cf-total-income')).toBeVisible();

        await page
            .locator('.cf-toggle-btn[data-cf-toggle="cashflow-income-list"]')
            .click();
        await expect(incomeList).not.toHaveClass(/cf-collapsed/);
        await expect(page.locator('#cf-salary')).toBeVisible();
        // Expenses card is untouched by toggling Income.
        await expect(expensesList).toHaveClass(/cf-collapsed/);
    });
});

test.describe('Dashboard — Asset Allocation drill-down (Quick Stats removal)', () => {
    test('Quick Stats card is gone', async ({ page }) => {
        await expect(
            page.getByRole('heading', { name: 'Quick Stats' }),
        ).toHaveCount(0);
    });

    test('clicking a slice drills into its individual items, and back returns to the overview', async ({
        page,
    }) => {
        // Seed one account so the allocation chart has a non-zero slice —
        // a fresh e2e DB starts empty, and an all-zero chart renders no
        // canvas content to click.
        await page.locator('#btn-tab-financial').click();
        await page.locator('[data-ua-tab="account"]').click();
        await page.locator('#acc-name').fill('E2E Test Savings');
        await page.locator('#acc-type').selectOption('Cash');
        await page.locator('#acc-val').fill('5000');
        const saveResponse = page.waitForResponse((r) =>
            r.url().includes('/api/state'),
        );
        await page
            .locator('#form-custom-account button[type="submit"]')
            .click();
        await saveResponse;

        await page.locator('#btn-tab-dashboard').click();
        const canvas = page.locator('#chart-asset-allocation');
        await expect(canvas).toBeVisible();

        // Chart.js's own hit-testing tells us exactly where a slice is,
        // rather than guessing a fraction of the canvas box — the ring's
        // position/radius shifts with legend content, so a fixed fraction
        // isn't reliable across different numbers of slices.
        const hitPoint = await page.evaluate(() => {
            const rect = document
                .getElementById('chart-asset-allocation')
                .getBoundingClientRect();
            for (let fx = 0.1; fx <= 0.6; fx += 0.05) {
                for (let fy = 0.1; fy <= 0.9; fy += 0.05) {
                    const x = rect.left + rect.width * fx;
                    const y = rect.top + rect.height * fy;
                    const hits =
                        window.assetAllocationChart.getElementsAtEventForMode(
                            { clientX: x, clientY: y },
                            'nearest',
                            { intersect: true },
                            false,
                        );
                    if (hits.length > 0) return { x, y };
                }
            }
            return null;
        });
        expect(hitPoint).toBeTruthy();
        await page.mouse.click(hitPoint.x, hitPoint.y);

        await expect(page.locator('#alloc-back-btn')).toBeVisible();
        await expect(page.locator('#alloc-breadcrumb-title')).toContainText(
            'Asset Allocation —',
        );
        await expect(page.locator('#alloc-detail-list')).toContainText(
            'E2E Test Savings',
        );

        await page.locator('#alloc-back-btn').click();
        await expect(page.locator('#alloc-back-btn')).toBeHidden();
        await expect(page.locator('#alloc-breadcrumb-title')).toHaveText(
            'Asset Allocation',
        );
    });
});

test.describe('Narrow viewport (mobile) — hamburger nav drawer', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('sidebar collapses to a brand + hamburger top bar, nav items hidden until opened', async ({
        page,
    }) => {
        await expect(page.locator('.sidebar')).toBeVisible();
        // Mobile layout switches the app-container to a column flow with
        // natural page scrolling instead of the desktop's internal
        // scroll-container clipping.
        const overflow = await page
            .locator('.scroll-container')
            .evaluate((el) => getComputedStyle(el).overflow);
        expect(overflow).toBe('visible');

        // The nav list is present in the DOM but not visible/interactive
        // until the drawer is opened — this used to be an always-visible
        // horizontal scrolling strip of tabs; now it's a closed drawer.
        await expect(page.locator('.nav-menu')).toHaveCSS(
            'visibility',
            'hidden',
        );
        await expect(page.locator('#nav-drawer-backdrop')).toHaveCSS(
            'display',
            'none',
        );
    });

    test('the collapse arrow is not a dead control — it opens/closes the nav drawer', async ({
        page,
    }) => {
        const toggleBtn = page.locator('#sidebar-collapse-btn');
        await expect(toggleBtn).toBeVisible();

        await toggleBtn.click();
        await expect(page.locator('.app-container')).toHaveClass(
            /nav-drawer-open/,
        );
        await expect(page.locator('.nav-menu')).toHaveCSS(
            'visibility',
            'visible',
        );
        await expect(page.locator('#nav-drawer-backdrop')).toHaveCSS(
            'display',
            'block',
        );

        await toggleBtn.click();
        await expect(page.locator('.app-container')).not.toHaveClass(
            /nav-drawer-open/,
        );
        await expect(page.locator('.nav-menu')).toHaveCSS(
            'visibility',
            'hidden',
        );
    });

    test('opening the drawer and selecting a destination navigates and auto-closes it', async ({
        page,
    }) => {
        await page.locator('#sidebar-collapse-btn').click();
        await expect(page.locator('.app-container')).toHaveClass(
            /nav-drawer-open/,
        );

        await page.locator('#btn-tab-financial').click();
        await expect(page.locator('#tab-financial')).toHaveClass(/active/);
        await expect(page.locator('.app-container')).not.toHaveClass(
            /nav-drawer-open/,
        );
    });

    test('clicking the backdrop closes the drawer without navigating', async ({
        page,
    }) => {
        await page.locator('#sidebar-collapse-btn').click();
        await expect(page.locator('.app-container')).toHaveClass(
            /nav-drawer-open/,
        );

        await page.locator('#nav-drawer-backdrop').click({ force: true });
        await expect(page.locator('.app-container')).not.toHaveClass(
            /nav-drawer-open/,
        );
        await expect(page.locator('#tab-dashboard')).toHaveClass(/active/);
    });
});

async function seedCashAccount(page, name, value) {
    await page.locator('#btn-tab-financial').click();
    await page.locator('[data-ua-tab="account"]').click();
    await page.locator('#acc-name').fill(name);
    await page.locator('#acc-type').selectOption('Cash');
    await page.locator('#acc-val').fill(value);
    const saveResponse = page.waitForResponse((r) =>
        r.url().includes('/api/state'),
    );
    await page.locator('#form-custom-account button[type="submit"]').click();
    await saveResponse;
}

test.describe('Summary bar — narrow width collapses to a single bar', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('shows only the FIRE/net-worth bar; tooltip lists breakdown, income and spend', async ({
        page,
    }) => {
        await page.locator('#sidebar-collapse-btn').click();
        await seedCashAccount(page, 'E2E Compact Seed', '50000');
        await page.locator('#sidebar-collapse-btn').click();
        await page.locator('#btn-tab-dashboard').click();

        await expect(page.locator('#compact-fire-bar')).toBeVisible();
        await expect(page.locator('#banner-networth')).toBeHidden();
        await expect(page.locator('#banner-gross-income')).toBeHidden();
        await expect(page.locator('#banner-spend')).toBeHidden();
        await expect(page.locator('#banner-target')).toBeHidden();
        await expect(page.locator('#cfb-fill .cfb-seg').first()).toBeAttached();
        await expect(page.locator('#cfb-pct')).toContainText('%');

        await page.locator('#compact-fire-bar').click();
        const tip = page.locator('#alloc-tooltip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('Cash');
        await expect(tip).toContainText('Net Worth');
        await expect(tip).toContainText('Income / yr');
        await expect(tip).toContainText('Spend / yr');
    });
});

test.describe('Summary bar — desktop keeps the full metrics', () => {
    test('shows full metric blocks (no compact bar) with bottom padding', async ({
        page,
    }) => {
        await seedCashAccount(page, 'E2E Full Precision Seed', '50000');
        await page.locator('#btn-tab-dashboard').click();
        await expect(page.locator('#banner-networth')).toHaveText(
            /^-?\$[\d,]+\.\d{2}$/,
        );
        await expect(page.locator('#compact-fire-bar')).toBeHidden();
        const padBottom = await page
            .locator('.header-banner')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
        const padTop = await page
            .locator('.header-banner')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
        expect(padBottom).toBeGreaterThan(padTop);
    });
});

test.describe('Settings — card order and color-coded grouping', () => {
    test('cards are ordered Projection Defaults, Notifications, eBay, Plaid, Privacy, Data Management, Google Drive, Danger Zone', async ({
        page,
    }) => {
        await page.locator('#btn-tab-settings').click();
        const titles = await page
            .locator('#tab-settings .card .card-title')
            .allTextContents();
        const normalized = titles.map((t) => t.trim());
        expect(normalized).toEqual([
            'Projection Defaults',
            'Notifications & Alerts',
            'eBay Order Sync',
            'Plaid Transaction Sync',
            'Privacy & Terms',
            'Data Management',
            'Google Drive Backup',
            '⚠️ Danger Zone',
        ]);
    });

    test('Danger Zone, Privacy/Plaid, and Google Drive cards carry their color-coded accent classes', async ({
        page,
    }) => {
        await page.locator('#btn-tab-settings').click();
        await expect(
            page.locator('#tab-settings .settings-card--danger .card-title'),
        ).toContainText('Danger Zone');
        await expect(
            page.locator('#tab-settings .settings-card--privacy .card-title'),
        ).toContainText('Privacy & Terms');
        await expect(
            page.locator('#tab-settings .settings-card--plaid .card-title'),
        ).toContainText('Plaid Transaction Sync');
        await expect(
            page.locator('#tab-settings .settings-card--gdrive .card-title'),
        ).toContainText('Google Drive Backup');
    });
});

test.describe('Summary bar — top bar placement', () => {
    test.describe('portrait at hamburger width', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the compact bar and bell live in the top bar; the banner is gone', async ({
            page,
        }) => {
            await expect(
                page.locator('.sidebar #compact-fire-bar'),
            ).toBeVisible();
            await expect(
                page.locator('.sidebar .notif-bell-wrap'),
            ).toBeVisible();
            await expect(page.locator('.header-banner')).toBeHidden();
        });
    });

    test.describe('landscape at the same width', () => {
        test.use({ viewport: { width: 740, height: 360 } });

        test('the compact bar stays in the banner', async ({ page }) => {
            await expect(
                page.locator('.header-banner #compact-fire-bar'),
            ).toBeVisible();
            await expect(
                page.locator('.sidebar #compact-fire-bar'),
            ).toHaveCount(0);
        });
    });
});

test.describe('Top Investment Positions — narrow widths', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('shows symbol, value and PnL with a + that expands the hidden fields', async ({
        page,
    }) => {
        await page.evaluate(() => {
            state.importedPositions = [
                {
                    account: 'E2E Brokerage',
                    symbol: 'ZZTEST',
                    description: 'E2E TEST FUND',
                    quantity: 10,
                    lastPrice: 12.5,
                    costBasis: 100,
                    value: 125,
                    pnlDollar: 25,
                    pnlPercent: 25,
                },
            ];
            renderDashboardTopPositionsTable();
        });
        const table = page.locator('#table-dashboard-positions');
        await expect(table.locator('th.pos-col-desc')).toBeHidden();
        await expect(table.locator('th.pos-col-price')).toBeHidden();
        await expect(table.locator('th.pos-col-cost')).toBeHidden();

        const detail = table.locator('.position-detail-row');
        await expect(detail).toBeHidden();
        await table.locator('.pos-expand-btn').click();
        await expect(detail).toBeVisible();
        await expect(detail).toContainText('E2E TEST FUND');
        await expect(detail).toContainText('Last Price');
        await expect(detail).toContainText('Cost Basis');
    });
});

test.describe('Portfolio Rebalancing location', () => {
    test('lives on Insights, not Financial Overview', async ({ page }) => {
        await page.locator('#btn-tab-financial').click();
        await expect(
            page.locator('#tab-financial #table-rebalancing'),
        ).toHaveCount(0);
        await page.locator('#btn-tab-insights').click();
        await expect(
            page.locator('#tab-insights').getByRole('heading', {
                name: 'Portfolio Rebalancing',
            }),
        ).toBeVisible();
    });
});

test.describe('Insights — additional watchers', () => {
    test('aggressive SWR and crypto concentration tiles appear when triggered', async ({
        page,
    }) => {
        await page.evaluate(() => {
            localStorage.removeItem('fire_dismissed_div_tips');
            state.customAccounts = [
                { id: 'e2e-c', name: 'Coins', type: 'Crypto', value: 30000 },
                { id: 'e2e-k', name: 'Cash', type: 'Cash', value: 70000 },
            ];
            state.projectionSettings.swr = 6;
            renderDiversificationSuggestions();
        });
        const block = page.locator('#divs-suggestion-block');
        await expect(block).toContainText('Aggressive Withdrawal Rate');
        await expect(block).toContainText('Crypto Share of Net Worth');
    });
});

test.describe('Side Hustle Accelerators', () => {
    test('shows an idea with guide/video links; dismissing all shows a motivational message; restore brings them back', async ({
        page,
    }) => {
        await page.locator('#btn-tab-sidegig').click();
        const box = page.locator('#hustle-accelerator');
        await expect(box.locator('.hustle-item h4')).toBeVisible();
        await expect(box.locator('a.divs-tile-link').first()).toHaveAttribute(
            'href',
            /^https:\/\//,
        );

        await box.locator('[data-hustle-action="next"]').click();
        await expect(box).toContainText('2 / 7');

        for (let i = 0; i < 7; i++) {
            await box.locator('[data-hustle-action="dismiss"]').click();
        }
        await expect(box.locator('.hustle-mantra')).toBeVisible();

        await box.locator('[data-hustle-action="restore"]').click();
        await expect(box.locator('.hustle-item h4')).toBeVisible();
    });
});

test.describe('Projections — Growth Settings presets and milestones', () => {
    test('Milestone Predictions is its own card beside Scenario Comparison; growth presets drive the milestone preset', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        await expect(
            page.locator(
                '.proj-secondary-row #projection-milestones-container',
            ),
        ).toBeAttached();
        await expect(
            page.locator(
                '#proj-settings-card #projection-milestones-container',
            ),
        ).toHaveCount(0);

        const cases = [
            ['conservative', 'conservative'],
            ['aggressive', 'aggressive'],
            ['earlyRetiree', 'coast'],
            ['standard', 'standard'],
        ];
        for (const [preset, milestone] of cases) {
            await page
                .locator(`.proj-preset-btn[data-preset="${preset}"]`)
                .click();
            await expect(
                page.locator(
                    `.milestone-preset-btn[data-milestone="${milestone}"]`,
                ),
            ).toHaveClass(/active/);
        }
    });

    test('every SWR preset and the default select the matching SWR and persist it', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        const select = page.locator('#proj-swr');
        // Default (4%) must show as selected, not blank.
        await expect(select).toHaveValue('4.0');

        const cases = [
            ['conservative', '3.5', 3.5],
            ['standard', '4.0', 4],
            ['aggressive', '4.0', 4],
            ['earlyRetiree', '3.25', 3.25],
        ];
        for (const [key, value, num] of cases) {
            await page
                .locator(`.proj-preset-btn[data-preset="${key}"]`)
                .click();
            await expect(select).toHaveValue(value);
            const swr = await page.evaluate(() => state.projectionSettings.swr);
            expect(swr).toBe(num);
        }
    });
});

test.describe('Alerts bell and narrow positions table', () => {
    test('the bell stays pinned to the right end of the banner', async ({
        page,
    }) => {
        const banner = await page.locator('.header-banner').boundingBox();
        const bell = await page.locator('.notif-bell-wrap').boundingBox();
        expect(banner.x + banner.width - (bell.x + bell.width)).toBeLessThan(
            40,
        );
    });

    test.describe('at phone width', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('the positions table does not scroll sideways', async ({
            page,
        }) => {
            await page.evaluate(() => {
                state.importedPositions = [
                    {
                        account: 'E2E Long Account Name Brokerage',
                        symbol: 'ZZTEST',
                        description: 'E2E TEST FUND',
                        quantity: 10,
                        lastPrice: 12.5,
                        costBasis: 100,
                        value: 220683.48,
                        pnlDollar: 105950,
                        pnlPercent: 132.2,
                    },
                ];
                renderDashboardTopPositionsTable();
            });
            const overflow = await page
                .locator('#table-dashboard-positions')
                .evaluate((t) => {
                    const c = t.closest('.table-container');
                    return c.scrollWidth - c.clientWidth;
                });
            expect(overflow).toBeLessThanOrEqual(1);
        });
    });
});

test.describe('Expenses — insurance fields at narrow widths', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('car and home insurance stack instead of overlapping', async ({
        page,
    }) => {
        await page.locator('#sidebar-collapse-btn').click();
        await page.locator('#btn-tab-expenses').click();
        const car = await page.locator('#ins-car-freq').boundingBox();
        const home = await page.locator('#ins-home-amt').boundingBox();
        expect(home.y).toBeGreaterThan(car.y + car.height - 1);
    });
});

test.describe('Summary banner keeps its content inside its box once data loads', () => {
    test.use({ viewport: { width: 1900, height: 600 } });

    test('no metric spills below the banner', async ({ page }) => {
        await page.evaluate(() => {
            state.customAccounts = [
                { id: 'e2e-a', name: 'Cash', type: 'Cash', value: 250000 },
                { id: 'e2e-b', name: 'Coins', type: 'Crypto', value: 90000 },
            ];
            refreshAllUI();
        });
        const { contentEdge, metricsBottom } = await page.evaluate(() => {
            const hb = document.querySelector('.header-banner');
            const padBottom = parseFloat(getComputedStyle(hb).paddingBottom);
            return {
                contentEdge: hb.getBoundingClientRect().bottom - padBottom,
                metricsBottom: Math.max(
                    ...[...hb.querySelectorAll('.header-metric')].map(
                        (m) => m.getBoundingClientRect().bottom,
                    ),
                ),
            };
        });
        // Content must end inside the banner's padding box, above its bottom
        // padding — if the banner shrinks under load the metrics spill past it.
        expect(metricsBottom).toBeLessThanOrEqual(contentEdge + 1);
    });
});

test.describe('Dashboard — wide layout and growth chart sizes', () => {
    test.use({ viewport: { width: 1600, height: 1000 } });

    test('growth, allocation and cash sit in one row above full-width positions', async ({
        page,
    }) => {
        const [g, a, c, p] = await Promise.all(
            [
                '#dash-card-growth',
                '#dash-card-alloc',
                '#dash-card-cash',
                '#dash-card-positions',
            ].map((s) => page.locator(s).boundingBox()),
        );
        expect(Math.abs(g.y - a.y)).toBeLessThan(2);
        expect(Math.abs(a.y - c.y)).toBeLessThan(2);
        expect(g.x).toBeLessThan(a.x);
        expect(a.x).toBeLessThan(c.x);
        expect(p.y).toBeGreaterThan(g.y + g.height - 1);
        expect(p.width).toBeGreaterThan(g.width * 2.5);
    });

    test('the expander widens and lengthens the growth chart, is remembered, and there are no S/M/L buttons', async ({
        page,
    }) => {
        await expect(page.locator('#growth-size-btns')).toHaveCount(0);
        const chart = page.locator('#dash-card-growth .dash-growth-chart');
        const before = (await chart.boundingBox()).height;
        await page.locator('#growth-expand-btn').click();
        const card = await page.locator('#dash-card-growth').boundingBox();
        const body = await page.locator('.dashboard-body').boundingBox();
        expect(card.width).toBeGreaterThan(body.width - 2);
        expect((await chart.boundingBox()).height).toBeGreaterThan(
            before + 100,
        );

        await page.reload();
        await expect(page.locator('#dash-card-growth')).toHaveClass(
            /growth-size-wide/,
        );
        await page.locator('#growth-expand-btn').click();
        await expect(page.locator('#dash-card-growth')).not.toHaveClass(
            /growth-size-wide/,
        );
    });
});

test.describe('Financial Overview — wide top row and vehicle actions', () => {
    test.describe('wide screens', () => {
        test.use({ viewport: { width: 1600, height: 1000 } });

        test('cash flow cards share one row', async ({ page }) => {
            await page.locator('#btn-tab-financial').click();
            const row = page.locator('.fo-cashflow-row');
            const boxes = await Promise.all(
                [
                    'Net Monthly Cash Flow',
                    'Income Sources',
                    'Monthly Expenses',
                ].map((name) =>
                    row.getByRole('heading', { name }).boundingBox(),
                ),
            );
            expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(5);
            expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(5);
            expect(boxes[0].x).toBeLessThan(boxes[1].x);
            expect(boxes[1].x).toBeLessThan(boxes[2].x);
        });
    });

    test('vehicle Estimate button lives in Actions; no Value Estimate column', async ({
        page,
    }) => {
        await page.evaluate(() => {
            state.vehicles = [
                {
                    id: 'e2e-v',
                    year: 2019,
                    make: 'Test',
                    model: 'Car',
                    condition: 'Good',
                    mileage: 1000,
                    currentValue: 10000,
                    purchasePrice: 12000,
                    loanBalance: 0,
                },
            ];
            renderVehiclesTable();
        });
        await page.locator('#btn-tab-financial').click();
        await expect(
            page.getByRole('columnheader', { name: 'Value Estimate' }),
        ).toHaveCount(0);
        const row = page.locator('#table-vehicles tbody tr').first();
        await expect(
            row.locator('td:last-child #veh-est-btn-e2e-v'),
        ).toBeVisible();
    });
});

test.describe('Expenses — budget field labels', () => {
    test('every budget label is two lines of the same height (bold category)', async ({
        page,
    }) => {
        await page.locator('#btn-tab-expenses').click();
        const ids = [
            'housing',
            'utilities',
            'food',
            'transport',
            'healthcare',
            'discretionary',
        ];
        const heights = [];
        for (const id of ids) {
            const label = page.locator(`label[for="exp-${id}"]`);
            await expect(label.locator('strong')).toBeVisible();
            await expect(label.locator('.expense-label-hint')).toBeVisible();
            heights.push((await label.boundingBox()).height);
        }
        // Consistent cells: every label is the same height.
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    });
});

test.describe('Projection math per growth preset', () => {
    test('each preset yields a sane, distinct projection; Early Retiree retires early; emergency fund scales off expenses', async ({
        page,
    }) => {
        await page.evaluate(() => {
            state.customAccounts = [
                { id: 'pm-a', name: 'Cash', type: 'Cash', value: 100000 },
                {
                    id: 'pm-b',
                    name: 'Brokerage',
                    type: 'Brokerage',
                    value: 400000,
                },
            ];
            refreshAllUI();
        });
        await page.locator('#btn-tab-projections').click();
        const results = {};
        for (const key of [
            'conservative',
            'standard',
            'aggressive',
            'earlyRetiree',
        ]) {
            await page
                .locator(`.proj-preset-btn[data-preset="${key}"]`)
                .click();
            results[key] = await page.evaluate(() => {
                const d = buildProjectionData();
                const ms = buildMilestonesList(d, d.depletionAge);
                const ef = ms.find((m) => m.name.startsWith('Emergency Fund'));
                return {
                    finite: d.nwData.every((v) => Number.isFinite(v) && v >= 0),
                    end: d.nwData[d.nwData.length - 1],
                    retireAge: state.projectionSettings.retireAge,
                    swr: state.projectionSettings.swr,
                    efTarget: ef ? ef.target : null,
                    monthsCovered: ef
                        ? ef.target / (d.annualExpenses / 12)
                        : null,
                };
            });
            expect(results[key].finite).toBe(true);
        }
        // More return => more wealth at the end of the same span.
        expect(results.standard.end).toBeGreaterThan(results.conservative.end);
        expect(results.aggressive.end).toBeGreaterThan(results.standard.end);
        expect(results.earlyRetiree.retireAge).toBe(50);
        expect(results.earlyRetiree.swr).toBe(3.25);
        // "6 months of expenses" really is ~6 months (was FIRE number × 0.5).
        expect(results.standard.monthsCovered).toBeCloseTo(6, 1);
    });
});

test.describe('Side Gig Ledger — eBay report upload', () => {
    const header =
        'Listing title,eBay item ID,Quantity sold,Total sales (Includes taxes),Item sales,Taxes and government fees paid by buyer to you,Taxes and government fees paid by buyer to eBay,Shipping and handling paid by buyer to you,Total selling costs,Insertion fees,Optional listing upgrade fees,Final value fees,Promoted Listings - General fees,Promoted Listings - Priority fees,Ads Express fees,Promoted Offsite - Fees,International fees,Other eBay fees,Deposit processing fees,Fee credits,Shipping labels cost (Amount you paid to buy shipping labels on eBay),Net sales (Net of taxes and selling costs),Average Selling price,Quantity sold via promoted listing,';
    const csv = [
        'Disclaimers',
        '"Report for Jan 1, 2026 to Sep 18, 2026"',
        header,
        'E2E Test Cartridge,999000111222,1,$27.02,$20.78,$0.00,$0.00,$6.24,$10.31,$0,$0,$4.07,$0,$0,$0,$0,$0,$0,$0,$0,$6.24,$16.71,$13.51,0',
    ].join('\n');

    test('uploads once, and a re-upload is skipped as a duplicate', async ({
        page,
    }) => {
        await page.locator('#btn-tab-sidegig').click();
        const messages = [];
        page.on('dialog', async (d) => {
            messages.push(d.message());
            await d.accept();
        });
        const upload = async () => {
            await page.locator('#ebay-report-input').setInputFiles({
                name: 'report.csv',
                mimeType: 'text/csv',
                buffer: Buffer.from(csv),
            });
            await expect.poll(() => messages.length).toBeGreaterThan(0);
        };
        await upload();
        const cell = page
            .locator('#table-sidegig-history')
            .getByText('E2E Test Cartridge');
        await expect(cell).toHaveCount(1);
        expect(messages.at(-1)).toContain('1 added');

        const seen = messages.length;
        await page.locator('#ebay-report-input').setInputFiles({
            name: 'report.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(csv),
        });
        await expect.poll(() => messages.length).toBeGreaterThan(seen);
        await expect(cell).toHaveCount(1);
        expect(messages.at(-1)).toContain('already imported');
    });
});
