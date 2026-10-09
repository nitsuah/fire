// @ts-check
const { test, expect, step, settle } = require('./fire');

test(
    'first visit: accept the privacy terms and see my net worth',
    {
        tag: [
            '@feature:privacy-modal',
            '@feature:header-summary-bar',
            '@feature:asset-allocation-drill-down',
            '@feature:cd-tracker',
        ],
    },
    async ({ page }) => {
        const accept = page.getByRole('button', {
            name: /I Understand.*Continue/i,
        });

        await step(
            page,
            'open the app',
            async () => {
                await page.goto('/');
                await expect(accept).toBeVisible();
            },
            { docs: 'privacy-modal' },
        );

        await step(
            page,
            'accept the privacy terms',
            async () => {
                await accept.click();
                await expect(accept).toBeHidden();
                await settle(page);
                await expect(page.locator('#banner-networth')).toHaveText(
                    '$287,897.50',
                );
                await expect(page.locator('#banner-spend')).toHaveText(
                    '$44,640.00',
                );
            },
            { docs: 'header-summary-bar' },
        );

        await step(
            page,
            'drill into equities',
            async () => {
                const alloc = page.locator('#tab-dashboard .card', {
                    has: page.locator('h2, h3', {
                        hasText: 'Asset Allocation',
                    }),
                });
                await alloc
                    .locator('button')
                    .filter({ hasText: /Equit/ })
                    .first()
                    .click();
                await expect(alloc).toContainText('VTI');
            },
            { docs: 'asset-allocation-drill-down' },
        );
    },
);
