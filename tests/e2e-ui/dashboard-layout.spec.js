// @ts-check
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
});

test.describe('Financial Overview — ENS wallet lookup', () => {
    test('lookup widget is present', async ({ page }) => {
        await page.locator('#btn-tab-financial').click();
        await expect(page.locator('#form-ens-lookup')).toBeVisible();
        await expect(page.locator('#ens-lookup-input')).toBeVisible();
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
