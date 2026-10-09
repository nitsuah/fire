// @ts-check
const { test, expect, step, openApp, openTab } = require('./fire');

test(
    'reseller prices an eBay sale and logs it',
    { tag: ['@feature:fee-calculator', '@feature:income-logs'] },
    async ({ page }) => {
        await step(page, 'open Side Hustle Hub', async () => {
            await openApp(page);
            await openTab(page, 'sidegig');
        });

        await step(
            page,
            'price an eBay sale',
            async () => {
                await page.fill('#ebay-price', '100');
                await page.fill('#ebay-cost', '30');
                await page.fill('#ebay-shipping-charged', '0');
                await page.fill('#ebay-shipping-actual', '8.50');
                await expect(page.locator('#ebay-res-profit')).toHaveText(
                    '$45.50',
                );
            },
            { docs: 'fee-calculator' },
        );

        await step(
            page,
            'log the sale to side income',
            async () => {
                const ledger = page.locator('#table-sidegig-history');
                const rows = await ledger.locator('tbody tr').count();
                await page.locator('#btn-save-ebay-sale').click();
                await expect(ledger.locator('tbody tr')).toHaveCount(rows + 1);
                await expect(ledger).toContainText('eBay Sale');
            },
            { docs: 'income-logs' },
        );
    },
);
