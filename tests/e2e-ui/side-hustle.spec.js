// @ts-check
/* global state, saveState, refreshAllUI */
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
    test('switches between every platform panel', async ({ page }) => {
        const panels = {
            ebay: page.locator('#calc-panel-ebay'),
            etsy: page.locator('#calc-panel-etsy'),
            fb: page.locator('#calc-panel-fb'),
            mercari: page.locator('#calc-panel-mercari'),
            poshmark: page.locator('#calc-panel-poshmark'),
        };
        await expect(panels.ebay).toBeVisible();
        await expect(panels.etsy).toBeHidden();

        for (const name of ['etsy', 'fb', 'mercari', 'poshmark', 'ebay']) {
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

    test('Mercari panel charges 10% of item + buyer shipping', async ({
        page,
    }) => {
        await page
            .locator('.platform-tab-btn[data-platform="mercari"]')
            .click();
        await page.fill('#mercari-price', '45');
        await page.fill('#mercari-shipping-buyer', '5');
        await page.fill('#mercari-shipping-actual', '6');
        await page.fill('#mercari-cost', '10');
        await expect(page.locator('#mercari-res-gross')).toHaveText('$50.00');
        await expect(page.locator('#mercari-res-fees')).toHaveText('$5.00');
        await expect(page.locator('#mercari-res-profit')).toHaveText('$29.00');
        // Opt-in 2.9% + $0.50 processing on the same $50.
        await page.locator('#mercari-processing').check();
        await expect(page.locator('#mercari-res-fees')).toHaveText('$6.95');
    });

    test('Poshmark panel switches from $2.95 flat to 20% at $15', async ({
        page,
    }) => {
        await page
            .locator('.platform-tab-btn[data-platform="poshmark"]')
            .click();
        await page.fill('#poshmark-price', '10');
        await expect(page.locator('#poshmark-res-fees')).toHaveText('$2.95');
        await page.fill('#poshmark-price', '30');
        await expect(page.locator('#poshmark-res-fees')).toHaveText('$6.00');
    });
});

test.describe('Marketplace connections', () => {
    test('Etsy card starts disconnected with Connect showing', async ({
        page,
    }) => {
        await expect(page.locator('#etsy-sync-status')).toHaveText(
            'Status: Disconnected',
        );
        await expect(page.locator('#btn-etsy-connect')).toBeVisible();
        await expect(page.locator('#btn-etsy-sync')).toBeHidden();
        await expect(page.locator('#btn-etsy-disconnect')).toBeHidden();
    });

    test('imports a Mercari export into the ledger once', async ({ page }) => {
        const dialogs = [];
        page.on('dialog', async (d) => {
            dialogs.push(d.message());
            await d.accept();
        });
        const file = require('path').join(
            __dirname,
            '../unit/fixtures/marketplaces/mercari-sales.csv',
        );
        const ledger = page.locator('#table-sidegig-history');
        // The temp DB outlives a local run; start without Mercari rows.
        await page.evaluate(async () => {
            state.sideGigLedger = state.sideGigLedger.filter(
                (e) => e.category !== 'Mercari',
            );
            await saveState();
            refreshAllUI();
        });
        await page.locator('#ebay-report-input').setInputFiles(file);
        await expect(ledger).toContainText('Nintendo DS Lite, Cobalt');
        await expect(ledger).toContainText('Pokemon Yellow cartridge');
        await expect.poll(() => dialogs.at(-1)).toMatch(/Mercari.*2 added/);
        // Same file again: nothing new.
        await page.locator('#ebay-report-input').setInputFiles([]);
        await page.locator('#ebay-report-input').setInputFiles(file);
        await expect
            .poll(() => dialogs.at(-1))
            .toMatch(/0 added, 2 already imported/);
        await expect(
            ledger.locator('tr', { hasText: 'Nintendo DS Lite' }),
        ).toHaveCount(1);
    });
});
