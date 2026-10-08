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
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissPrivacyModal(page);
    await page.locator('#btn-tab-sidegig').click();
});

test.describe('Platform Fee Calculator', () => {
    // The Etsy/FB panels start hidden by a CSS class; switching tabs must
    // actually show them (an empty inline display used to leave them hidden).
    test('switches between eBay, Etsy and FB Marketplace panels', async ({
        page,
    }) => {
        const panels = {
            ebay: page.locator('#calc-panel-ebay'),
            etsy: page.locator('#calc-panel-etsy'),
            fb: page.locator('#calc-panel-fb'),
        };
        await expect(panels.ebay).toBeVisible();
        await expect(panels.etsy).toBeHidden();

        for (const name of ['etsy', 'fb', 'ebay']) {
            await page
                .locator(`.platform-tab-btn[data-platform="${name}"]`)
                .click();
            for (const [other, loc] of Object.entries(panels)) {
                if (other === name) await expect(loc).toBeVisible();
                else await expect(loc).toBeHidden();
            }
        }
    });

    test('Etsy panel computes a live profit', async ({ page }) => {
        await page.locator('.platform-tab-btn[data-platform="etsy"]').click();
        await page.fill('#etsy-price', '40');
        await page.fill('#etsy-shipping-charged', '0');
        await page.fill('#etsy-shipping-actual', '0');
        await page.fill('#etsy-cost', '10');
        await page.fill('#etsy-ads-rate', '0');
        // $0.20 listing + 6.5% transaction + 3% + $0.25 processing on $40.
        await expect(page.locator('#etsy-res-gross')).toHaveText('$40.00');
        await expect(page.locator('#etsy-res-fees')).toHaveText('$4.25');
        await expect(page.locator('#etsy-res-profit')).toHaveText('$25.75');
    });
});
