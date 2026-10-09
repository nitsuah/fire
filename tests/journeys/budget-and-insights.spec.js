// @ts-check
const { test, expect, step, openApp, openTab } = require('./fire');

test(
    'saver trims the budget and the spend rate drops',
    { tag: ['@feature:header-summary-bar', '@feature:financial-overview'] },
    async ({ page }) => {
        const spend = page.locator('#banner-spend');

        await step(page, 'open Expenses', async () => {
            await openApp(page);
            await openTab(page, 'expenses');
            await expect(spend).toHaveText('$44,640.00');
        });

        // $200/mo less housing → $2,400/yr, grossed up by the 20% tax drag.
        await step(page, 'cut housing by $200 a month', async () => {
            await page.fill('#exp-housing', '1450');
            await page.locator('#exp-housing').blur();
            await expect(spend).toHaveText('$41,760.00');
        });
    },
);

test(
    'investor reads and dismisses portfolio insights',
    {
        tag: [
            '@feature:insights-tab',
            '@feature:diversification-tip-tiles',
            '@feature:smart-triggers',
        ],
    },
    async ({ page }) => {
        const tile = page
            .locator('#tab-insights')
            .getByText('Missing Real Estate');

        await step(
            page,
            'open Insights',
            async () => {
                await openApp(page);
                await openTab(page, 'insights');
                await expect(page.locator('#tab-insights')).toContainText(
                    'Equity Concentration Risk',
                );
                await expect(tile).toBeVisible();
            },
            { docs: 'insights-tab' },
        );

        await step(page, 'dismiss a tip', async () => {
            const card = page.locator('#tab-insights .divs-tile', {
                hasText: 'Missing Real Estate',
            });
            await card.getByRole('button', { name: 'Dismiss' }).click();
            await expect(tile).toBeHidden();
        });
    },
);
