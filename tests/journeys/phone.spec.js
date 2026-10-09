// @ts-check
const { test, expect, step, openApp } = require('./fire');

test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
});

test(
    'phone user opens the menu and checks side income',
    {
        tag: [
            '@feature:responsive-navigation',
            '@feature:mobile-responsive-layout',
            '@feature:phone-width-positions',
        ],
    },
    async ({ page }) => {
        await step(page, 'open the app on a phone', async () => {
            await openApp(page);
            await expect(page.locator('#btn-tab-sidegig')).toBeHidden();
        });

        await step(page, 'open the menu', async () => {
            await page.locator('#sidebar-collapse-btn').click();
            await expect(page.locator('#btn-tab-sidegig')).toBeVisible();
        });

        await step(page, 'go to Side Hustle Hub', async () => {
            await page.locator('#btn-tab-sidegig').click();
            await expect(page.locator('#tab-sidegig')).toBeVisible();
            await expect(page.locator('#btn-tab-sidegig')).toBeHidden();
        });
    },
);
