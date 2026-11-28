// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const accept = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await accept.waitFor({ state: 'visible', timeout: 5000 });
        await accept.click();
    } catch (err) {
        if (err.name !== 'TimeoutError') throw err;
    }
});

test('an empty spending CSV reports in the page, not in an alert box', async ({
    page,
}) => {
    const dialogs = [];
    page.on('dialog', async (d) => {
        dialogs.push(d.message());
        await d.dismiss();
    });
    await page.evaluate(() => {
        // processSpendingCSVFile is a classic-script global.
        const run = /** @type {any} */ (window).processSpendingCSVFile;
        run(new File(['Date'], 'empty.csv', { type: 'text/csv' }));
    });
    await expect(page.locator('#sidegig-toast')).toHaveText(
        'File appears to be empty.',
    );
    expect(dialogs).toEqual([]);
});
