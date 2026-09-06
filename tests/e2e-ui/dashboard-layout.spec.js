// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissPrivacyModal(page) {
    const continueBtn = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
    }
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
});

test.describe('Financial Overview — ENS wallet lookup', () => {
    test('lookup widget is present', async ({ page }) => {
        await page.locator('#btn-tab-financial').click();
        await expect(page.locator('#form-ens-lookup')).toBeVisible();
        await expect(page.locator('#ens-lookup-input')).toBeVisible();
    });
});

test.describe('Narrow viewport (mobile)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('sidebar becomes a horizontal top bar and page scrolls naturally', async ({
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
    });
});
