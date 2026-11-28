// @ts-check
const { test, expect } = require('@playwright/test');

// The self-hosted wording is covered in side-hustle.spec.js. Here /api/state
// answers 404, which is how the app recognises a hosted (browser-only) deploy.
test('hosted Etsy card says unavailable without server settings', async ({
    page,
}) => {
    const json = (route, status, body) =>
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
    await page.route('**/api/state', (route) =>
        json(route, 404, { error: 'Not found' }),
    );
    await page.route('**/api/sync/etsy/status', (route) =>
        json(route, 200, { configured: false }),
    );

    await page.goto('/');
    const accept = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    await accept.waitFor({ state: 'visible' });
    await accept.click();
    await page.locator('#btn-tab-sidegig').click();

    await expect(page.locator('#etsy-sync-status')).toHaveText(
        'Status: Etsy is not available on the hosted site',
    );
    await expect(page.locator('#btn-etsy-connect')).toBeHidden();
});
