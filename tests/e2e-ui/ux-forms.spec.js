// @ts-check
/* global state */
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

test('Settings and Projections start from the same defaults', async ({
    page,
}) => {
    // The shared test server may hold another spec's saved data, so read the
    // untouched markup and the shared object, not the stored settings.
    const result = await page.evaluate(async () => {
        const html = await (await fetch('/index.html')).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const value = (id) =>
            Number(doc.getElementById(id).getAttribute('value'));
        return {
            shared: globalThis.FireQuickStartFacts.DEFAULT_PROJECTION,
            projections: [
                value('proj-savings'),
                value('proj-return'),
                value('proj-inflation'),
            ],
            settings: [
                value('default-annual-savings'),
                value('default-expected-return'),
                value('default-inflation'),
            ],
        };
    });
    const { annualSavings, expectedReturn, inflationRate } = result.shared;
    const expected = [annualSavings, expectedReturn, inflationRate];
    expect(result.projections).toEqual(expected);
    expect(result.settings).toEqual(expected);
});

test('a CD maturing before its start date explains why it was not added', async ({
    page,
}) => {
    await page.locator('#form-cd-entry').evaluate((form) => {
        for (let el = form; el; el = el.parentElement) {
            el.style.setProperty('display', 'block', 'important');
        }
    });
    const before = await page.evaluate(() => state.cds.length);
    await page.locator('#cd-bank').fill('UX Test Bank');
    await page.locator('#cd-principal').fill('1000');
    await page.locator('#cd-rate').fill('4');
    await page.locator('#cd-start').fill('2026-11-01');
    await page.locator('#cd-maturity').fill('2026-10-01');
    await page.locator('#form-cd-entry button[type="submit"]').click();

    const error = page.locator('#cd-form-error');
    await expect(error).toHaveText(
        'Maturity must be on or after the start date.',
    );
    await expect(page.locator('#cd-maturity')).toHaveAttribute(
        'aria-invalid',
        'true',
    );
    expect(await page.evaluate(() => state.cds.length)).toBe(before);

    await page.locator('#cd-maturity').fill('2027-10-01');
    await expect(error).toBeHidden();
});
