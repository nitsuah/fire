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
    await page.locator('#btn-tab-financial').click();
});

test('the account form shows only the fields for the chosen type', async ({
    page,
}) => {
    await page.locator('[data-ua-tab="account"]').click();
    const crypto = page.locator('#group-crypto-fields');
    const metal = page.locator('#group-metal-fields');
    await expect(page.locator('#acc-type')).toHaveValue('Cash');
    await expect(crypto).toBeHidden();
    await expect(metal).toBeHidden();

    await page.locator('#acc-type').selectOption('Crypto');
    await expect(crypto).toBeVisible();
    await expect(metal).toBeHidden();

    await page.locator('#acc-type').selectOption('Metal');
    await expect(crypto).toBeHidden();
    await expect(metal).toBeVisible();
});

for (const field of ['tax-gross-income', 'exp-housing', 'ins-car-amt']) {
    test(`the Edit link for ${field} focuses that input`, async ({ page }) => {
        await page.locator(`[data-csp-click-value="${field}"]`).click();
        await expect(page.locator(`#${field}`)).toBeFocused();
        await expect(page.locator(`#${field}`)).toBeInViewport();
    });
}

test('Spending Upload says uploads do not change the budget', async ({
    page,
}) => {
    await page.locator('#btn-tab-expenses').click();
    await expect(page.locator('#spending-budget-note')).toContainText(
        'do not change Base Monthly Expenses',
    );
});
