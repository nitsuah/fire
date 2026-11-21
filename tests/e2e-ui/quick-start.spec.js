// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissPrivacyModal(page) {
    const continueBtn = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    } catch (err) {
        if (err.name === 'TimeoutError') return;
        throw err;
    }
    await continueBtn.click();
    // Wait for Quick Start to refresh after consent
    await page.waitForFunction(
        () => !document.getElementById('quick-start-card').hidden,
        { timeout: 5000 },
    );
}

test.describe('Quick Start Hub', () => {
    test('hidden before consent; visible after dismiss', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#quick-start-card')).toBeHidden();
        await dismissPrivacyModal(page);
        await expect(page.locator('#quick-start-card')).toBeVisible();
    });

    test('six steps render with progress text and optional labels', async ({
        page,
    }) => {
        await page.goto('/');
        await dismissPrivacyModal(page);

        const stepsList = page.locator('#quick-start-steps');
        await expect(stepsList.locator('li')).toHaveCount(6);

        const progressText = page.locator('#quick-start-progress');
        // Consent completes the privacy step; the seeded demo data can complete
        // more, so check the format rather than a fixed count.
        await expect(progressText).toHaveText(/^[1-6] of 6 done$/);

        const steps = stepsList.locator('li');
        await expect(steps.nth(0)).toContainText(
            'Understand where your data is stored',
        );
        await expect(steps.nth(1)).toContainText('Add or import your accounts');
        await expect(steps.nth(2)).toContainText(
            'Set your retirement assumptions',
        );
        await expect(steps.nth(3)).toContainText(
            'Connect a supported provider',
        );
        await expect(steps.nth(3)).toContainText('Optional');
        await expect(steps.nth(4)).toContainText('Set up a backup');
        await expect(steps.nth(4)).toContainText('Optional');
        await expect(steps.nth(5)).toContainText(
            'Explore insights and Chaos Mode',
        );
        await expect(steps.nth(5)).toContainText('Optional');
    });

    test('step link switches to existing tab; privacy step opens modal', async ({
        page,
    }) => {
        await page.goto('/');
        await dismissPrivacyModal(page);

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(1).click();
        await expect(page.locator('#tab-financial')).toBeVisible();

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(2).click();
        await expect(page.locator('#tab-projections')).toBeVisible();

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(3).click();
        await expect(page.locator('#tab-settings')).toBeVisible();

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(4).click();
        await expect(page.locator('#tab-settings')).toBeVisible();

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(5).click();
        await expect(page.locator('#tab-insights')).toBeVisible();

        await page.locator('#btn-tab-dashboard').click();
        await page.locator('#quick-start-steps li').nth(0).click();
        // After consent the notice opens in review mode (no Continue button).
        await expect(page.locator('#privacy-modal-overlay')).toBeVisible();
    });

    test('dismiss hides card, shows reopen, persists after reload; reopen restores', async ({
        page,
    }) => {
        await page.goto('/');
        await dismissPrivacyModal(page);

        await page.locator('#quick-start-dismiss').click();
        await expect(page.locator('#quick-start-card')).toBeHidden();
        await expect(page.locator('#quick-start-reopen')).toBeVisible();

        await expect(
            page.evaluate(() =>
                localStorage.getItem('fire_quick_start_dismissed'),
            ),
        ).resolves.toBe('1');

        await page.reload();
        await dismissPrivacyModal(page);
        await expect(page.locator('#quick-start-card')).toBeHidden();
        await expect(page.locator('#quick-start-reopen')).toBeVisible();

        await page.locator('#quick-start-reopen').click();
        await expect(page.locator('#quick-start-card')).toBeVisible();
        await expect(page.locator('#quick-start-reopen')).toBeHidden();
        await expect(
            page.evaluate(() =>
                localStorage.getItem('fire_quick_start_dismissed'),
            ),
        ).resolves.toBeNull();
    });

    test('at phone viewport card visible and no horizontal overflow', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await dismissPrivacyModal(page);

        await expect(page.locator('#quick-start-card')).toBeVisible();
        const scrollWidth = await page.evaluate(
            () => document.documentElement.scrollWidth,
        );
        const innerWidth = await page.evaluate(() => window.innerWidth);
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
});
