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

// Neither test saves state: the test server's database is shared by all specs.
test('adding an account is confirmed in the page', async ({ page }) => {
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.saveState = async () => {};
        const form = document.getElementById('acc-name').closest('form');
        document.getElementById('acc-name')['value'] = 'UX Test Savings';
        document.getElementById('acc-val')['value'] = '100';
        form.requestSubmit();
    });
    await expect(page.locator('#sidegig-toast')).toHaveText(
        'Added UX Test Savings.',
    );
});

test.describe('in December', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-12-15T12:00:00Z'));
    });

    test('the tax-loss alert opens the card on Insights', async ({ page }) => {
        await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            w.checkAndNotify(
                {
                    notificationSettings: {},
                    importedPositions: [
                        { symbol: 'UXT', costBasis: 100, value: 50 },
                    ],
                    cds: [],
                },
                false,
            );
        });
        await page.locator('#notif-bell-btn').click();
        await expect(page.locator('#notif-alerts-list')).toContainText(
            'on the Insights tab',
        );
        await page.locator('.notif-link-btn').click();
        await expect(page.locator('#btn-tab-insights')).toHaveClass(/active/);
        await expect(page.locator('#tax-harvest-card')).toBeFocused();
        await expect(page.locator('#notif-dropdown')).toBeHidden();
    });
});
