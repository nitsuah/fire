// @ts-check
const { test, expect, step, openApp, openTab } = require('./fire');

test(
    'investor reviews positions and every holding',
    {
        tag: [
            '@feature:p-l-table',
            '@feature:collapse-all-toggle',
            '@feature:financial-overview-tab',
            '@feature:custom-accounts',
            '@feature:precious-metals',
            '@feature:vehicle-tracker',
        ],
    },
    async ({ page }) => {
        const positions = page.locator('#table-dashboard-positions');

        await step(page, 'see top positions with P&L', async () => {
            await openApp(page);
            await positions.scrollIntoViewIfNeeded();
            await expect(positions).toContainText('VTI');
            await expect(positions).toContainText('NVDA');
        });

        await step(page, 'collapse all position groups', async () => {
            await page.getByRole('button', { name: 'Collapse All' }).click();
            await expect(
                positions.getByText('NVDA', { exact: true }),
            ).toBeHidden();
        });

        await step(
            page,
            'open every holding in Financial Overview',
            async () => {
                await openTab(page, 'financial');
                const holdings = page.locator('#table-unified-holdings');
                await holdings.scrollIntoViewIfNeeded();
                for (const name of [
                    'High-Yield Savings',
                    'Roth IRA',
                    'Gold Eagles',
                    'Ally',
                ])
                    await expect(holdings).toContainText(name);
            },
        );
    },
);
