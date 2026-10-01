// @ts-check
/* global dashboardProjectionsChart, projectionsChart */
const { test, expect } = require('@playwright/test');

async function dismissPrivacyModal(page) {
    const continueBtn = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    } catch (err) {
        if (err.name === 'TimeoutError') return;
        throw err;
    }
    await continueBtn.click();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissPrivacyModal(page);
});

test.describe('Chaos mode', () => {
    test('toggles life events on both charts, survives reload, and rerolls', async ({
        page,
    }) => {
        const dashBtn = page.locator('#dash-card-growth .chaos-btn');
        await expect(dashBtn).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#dash-chaos-timeline')).toBeHidden();

        await dashBtn.click();
        await expect(dashBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#dash-chaos-timeline')).toBeVisible();
        await expect(page.locator('#dash-chaos-timeline')).toContainText(
            /life events? in view/,
        );

        const dash = await page.evaluate(() => ({
            labels: dashboardProjectionsChart.data.datasets.map((d) => d.label),
            markers: Object.keys(
                dashboardProjectionsChart.options.plugins.annotation
                    ?.annotations || {},
            ).filter((k) => k.startsWith('chaos_')).length,
        }));
        expect(dash.labels).toContain('Without chaos');
        expect(dash.markers).toBeGreaterThan(0);

        // Same events drive the Projections chart and its chip timeline.
        await page.locator('#btn-tab-projections').click();
        await expect(
            page.locator('#tab-projections .chaos-btn'),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(
            page.locator('#proj-chaos-timeline .chaos-chip').first(),
        ).toBeVisible();

        // A 1-year window still shows at least one event.
        await page.locator('#btn-tab-dashboard').click();
        await page
            .locator('#dash-period-btns button', { hasText: '1Y' })
            .click();
        const oneYear = await page.evaluate(
            () =>
                Object.keys(
                    dashboardProjectionsChart.options.plugins.annotation
                        ?.annotations || {},
                ).filter((k) => k.startsWith('chaos_')).length,
        );
        expect(oneYear).toBeGreaterThanOrEqual(1);

        const seedBefore = await page.evaluate(
            () => JSON.parse(localStorage.getItem('fire_chaos_mode')).seed,
        );
        await page.reload();
        await expect(
            page.locator('#dash-card-growth .chaos-btn'),
        ).toHaveAttribute('aria-pressed', 'true');

        await page.locator('#dash-card-growth .chaos-reroll-btn').click();
        const seedAfter = await page.evaluate(
            () => JSON.parse(localStorage.getItem('fire_chaos_mode')).seed,
        );
        expect(seedAfter).not.toBe(seedBefore);

        await page.locator('#dash-card-growth .chaos-btn').click();
        await expect(page.locator('#dash-chaos-timeline')).toBeHidden();
        const after = await page.evaluate(() =>
            dashboardProjectionsChart.data.datasets.map((d) => d.label),
        );
        expect(after).not.toContain('Without chaos');
    });

    test('Bear/Bull buttons leave the chaos toggle alone', async ({ page }) => {
        await page.locator('#btn-tab-projections').click();
        const chaos = page.locator('#tab-projections .chaos-btn');
        await chaos.click();
        await page.locator('.scenario-btn[data-offset="-2"]').click();
        await expect(chaos).toHaveClass(/active/);
        const hasMarkers = await page.evaluate(() =>
            Object.keys(
                projectionsChart.options.plugins.annotation?.annotations || {},
            ).some((k) => k.startsWith('chaos_')),
        );
        expect(hasMarkers).toBe(true);
    });
});

test.describe('Customizable layout', () => {
    test('collapse a card by its title and keep it collapsed after reload', async ({
        page,
    }) => {
        const card = page.locator('#dash-card-other');
        await card.locator('.card-title').click();
        await expect(card).toHaveClass(/lm-collapsed/);
        await expect(
            card.locator('#dashboard-other-assets-panel'),
        ).toBeHidden();
        await page.reload();
        await expect(page.locator('#dash-card-other')).toHaveClass(
            /lm-collapsed/,
        );
        await page.locator('#dash-card-other .card-title').click();
        await expect(page.locator('#dash-card-other')).not.toHaveClass(
            /lm-collapsed/,
        );
    });

    test('reorder cards with the arrow controls on any tab and persist', async ({
        page,
    }) => {
        await page.locator('#btn-tab-settings').click();
        const pane = page.locator('#tab-settings');
        await pane.locator('[data-lm-tool="edit"]').click();
        await pane
            .locator('[data-lm-id="settings:danger-zone"] [data-lm-act="up"]')
            .click();
        const order = () =>
            pane
                .locator('[data-lm-id]')
                .evaluateAll((els) => els.map((e) => e.dataset.lmId));
        const before = await order();
        expect(before.indexOf('settings:danger-zone')).toBe(before.length - 2);

        await page.reload();
        await page.locator('#btn-tab-settings').click();
        expect(await order()).toEqual(before);

        page.once('dialog', (d) => d.accept());
        await pane.locator('[data-lm-tool="edit"]').click();
        await pane.locator('[data-lm-tool="reset"]').click();
        const reset = await order();
        expect(reset[reset.length - 1]).toBe('settings:danger-zone');
    });

    test('pin a card from another tab to the Dashboard, then send it back', async ({
        page,
    }) => {
        const dash = page.locator('#tab-dashboard');
        await dash.locator('[data-lm-tool="edit"]').click();
        await dash.locator('[data-lm-tool="add"]').click();
        await page
            .locator('.lm-picker-row', { hasText: 'Scenario Comparison' })
            .getByRole('button', { name: 'Add' })
            .click();
        await page.keyboard.press('Escape');

        const pinned = dash.locator(
            '[data-lm-id="projections:scenario-comparison"]',
        );
        await expect(pinned).toBeVisible();
        await page.reload();
        await expect(
            page.locator(
                '#tab-dashboard [data-lm-id="projections:scenario-comparison"]',
            ),
        ).toHaveCount(1);

        await page.locator('#btn-tab-projections').click();
        const ph = page.locator('#tab-projections .lm-placeholder');
        await expect(ph).toContainText('Scenario Comparison');
        await ph.getByRole('button', { name: 'Move back here' }).click();
        await expect(
            page.locator(
                '#tab-projections [data-lm-id="projections:scenario-comparison"]',
            ),
        ).toBeVisible();
        await expect(page.locator('.lm-placeholder')).toHaveCount(0);
    });

    test('remove a Dashboard card and restore it from the picker', async ({
        page,
    }) => {
        const dash = page.locator('#tab-dashboard');
        await dash.locator('[data-lm-tool="edit"]').click();
        await page
            .locator('#dash-card-nw-history [data-lm-act="remove"]')
            .click();
        await expect(page.locator('#dash-card-nw-history')).toBeHidden();
        await dash.locator('[data-lm-tool="add"]').click();
        await page
            .locator('.lm-picker-row', { hasText: 'Net Worth History' })
            .getByRole('button', { name: 'Add' })
            .click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dash-card-nw-history')).toBeVisible();
    });
});
