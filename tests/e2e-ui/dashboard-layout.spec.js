// @ts-check
/* global state, renderDashboardTopPositionsTable */
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

    test('Milestone preset selector sits inline in the card title row', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        const mount = page.locator('#milestone-preset-mount');
        await expect(mount.locator('.milestone-preset-selector')).toBeVisible();
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

test.describe('Financial Overview — ENS wallet lookup', () => {
    test('lookup widget is present', async ({ page }) => {
        await page.locator('#btn-tab-financial').click();
        await expect(page.locator('#form-ens-lookup')).toBeVisible();
        await expect(page.locator('#ens-lookup-input')).toBeVisible();
    });
});

test.describe('Financial Overview — cash flow row', () => {
    test('desktop: Net Cash Flow, Income Sources, and Monthly Expenses sit left-to-right', async ({
        page,
    }) => {
        await page.locator('#btn-tab-financial').click();
        const netFlow = page.locator('.fo-cashflow-row').getByRole('heading', {
            name: 'Net Monthly Cash Flow',
        });
        const income = page.locator('.fo-cashflow-row').getByRole('heading', {
            name: 'Income Sources',
        });
        const expenses = page
            .locator('.fo-cashflow-row')
            .getByRole('heading', { name: 'Monthly Expenses' });
        await expect(netFlow).toBeVisible();
        await expect(income).toBeVisible();
        await expect(expenses).toBeVisible();

        const [netBox, incomeBox, expensesBox] = await Promise.all([
            netFlow.boundingBox(),
            income.boundingBox(),
            expenses.boundingBox(),
        ]);
        // Left-to-right order, same row (not stacked).
        expect(netBox.x).toBeLessThan(incomeBox.x);
        expect(incomeBox.x).toBeLessThan(expensesBox.x);
        expect(Math.abs(netBox.y - incomeBox.y)).toBeLessThan(5);
        expect(Math.abs(incomeBox.y - expensesBox.y)).toBeLessThan(5);
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
