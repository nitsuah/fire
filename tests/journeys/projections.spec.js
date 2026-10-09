// @ts-check
const { test, expect, step, openApp, openTab } = require('./fire');

test(
    'planner stress-tests the retirement date',
    {
        tag: [
            '@feature:growth-presets',
            '@feature:bull-bear-scenario-bands',
            '@feature:time-period-filters',
            '@feature:cd-maturity-markers',
        ],
    },
    async ({ page }) => {
        const presets = page.locator('#proj-settings-presets');
        const summary = page.locator('#proj-settings-summary');

        await step(
            page,
            'open Projections',
            async () => {
                await openApp(page);
                await openTab(page, 'projections');
                await expect(
                    page.locator('#chart-networth-projections'),
                ).toBeVisible();
            },
            { docs: 'projection-engine' },
        );

        await step(
            page,
            'pick the Aggressive growth preset',
            async () => {
                const before = await summary.innerText();
                await presets
                    .getByRole('button', { name: 'Aggressive' })
                    .click();
                await expect(summary).not.toHaveText(before);
            },
            { docs: 'growth-presets' },
        );

        await step(
            page,
            'apply the bear-market scenario',
            async () => {
                const bear = page.locator(
                    '#scenario-row .scenario-btn[data-offset="-2"]',
                );
                await bear.click();
                await expect(bear).toHaveClass(/active/);
            },
            { docs: 'bull-bear-scenario-bands' },
        );
    },
);
