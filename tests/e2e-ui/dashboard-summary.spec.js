// @ts-check
/* global state */
const { test, expect } = require('@playwright/test');

test('net worth shows and confirming the example figures clears the markers', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
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
    await expect(page.locator('#dash-net-worth')).toHaveText(
        /^-?\$[\d,]+\.\d\d$/,
    );

    // Earlier specs share the server's data, so start from the shipped
    // figures. Nothing is saved until the button is clicked.
    await page.evaluate(() => {
        state.assumptionsConfirmed = false;
        state.taxGrossIncome = 100000;
        window.refreshAllUI();
    });
    await expect(page.locator('#example-note')).toBeVisible();
    await expect(page.locator('#banner-income-example')).toBeVisible();

    await page
        .getByRole('button', { name: 'These figures are right for me' })
        .click();
    await expect(page.locator('#example-note')).toBeHidden();
    await expect(page.locator('#banner-income-example')).toBeHidden();
    expect(await page.evaluate(() => state.assumptionsConfirmed)).toBe(true);
    expect(errors).toEqual([]);

    // Leave the shared data as it was found for later specs.
    await page.evaluate(async () => {
        delete state.assumptionsConfirmed;
        await window.saveState();
    });
});
