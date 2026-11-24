// @ts-check
/* global state, saveState, refreshAllUI, logCalculatorSale */
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
    // The category select holds fee-rule ids; the fee tiers at the $7,500 cap.
    test('eBay fees resolve the selected rule id and its tiers', async ({
        page,
    }) => {
        await page.locator('#ebay-price').fill('8000');
        await page.locator('#ebay-shipping-charged').fill('0');
        await page.locator('#ebay-ad-rate').fill('0');
        const fees = page.locator('#ebay-res-fees');

        await page.locator('#ebay-category-rate').selectOption('trading-cards');
        // 7,500 x 13.25% + 500 x 2.35% + $0.40 order fee
        await expect(fees).toHaveText('$1,005.90');

        await page.locator('#ebay-category-rate').selectOption('standard');
        // 7,500 x 13.6% + 500 x 2.35% + $0.40
        await expect(fees).toHaveText('$1,032.15');
    });

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

    test('a failed calculator save keeps a sale logged meanwhile', async ({
        page,
    }) => {
        const kept = await page.evaluate(async () => {
            const realSave = saveState;
            let failFirst;
            let calls = 0;
            // eslint-disable-next-line no-global-assign
            saveState = () =>
                ++calls === 1
                    ? new Promise((_, reject) => (failFirst = reject))
                    : Promise.resolve();
            const sale = {
                price: 10,
                gross: 10,
                fees: 1,
                shipping: 0,
                cost: 2,
                net: 7,
            };
            const first = logCalculatorSale('Mercari', sale);
            await logCalculatorSale('Poshmark', sale);
            failFirst(new Error('disk full'));
            await first;
            // eslint-disable-next-line no-global-assign
            saveState = realSave;
            return state.sideGigLedger
                .filter((e) =>
                    /^(Mercari|Poshmark) Sale: \$10 Item$/.test(e.desc),
                )
                .map((e) => e.category);
        });
        expect(kept).toEqual(['Poshmark']);
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
    // The test server has no ETSY_CLIENT_ID/SYNC_MASTER_KEY, so the card must
    // say what is missing instead of offering a Connect that can only fail
    // (#219).
    test('Etsy card says not configured when the server has no credentials', async ({
        page,
    }) => {
        await expect(page.locator('#etsy-sync-status')).toHaveText(
            'Status: Etsy is not configured on this deployment (ETSY_CLIENT_ID / SYNC_MASTER_KEY)',
        );
        await expect(page.locator('#btn-etsy-connect')).toBeHidden();
        await expect(page.locator('#btn-etsy-sync')).toBeHidden();
        await expect(page.locator('#btn-etsy-disconnect')).toBeHidden();
    });

    test('eBay card says not configured when the server has no credentials', async ({
        page,
    }) => {
        await expect(page.locator('#ebay-sync-status')).toHaveText(
            'Status: eBay is not configured on this deployment (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)',
        );
        await expect(page.locator('#btn-ebay-oauth')).toBeHidden();
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

test('manual Side Gig Ledger form reflows on phone and stays within desktop viewport', async ({
    page,
}) => {
    const form = page.locator('#form-sidegig-manual');
    const fieldIds = [
        'sg-desc',
        'sg-cat',
        'sg-revenue',
        'sg-expense',
        'sg-basis',
        'sg-cost',
    ];

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(form).toBeVisible();
    for (const id of fieldIds) {
        await expect(form.locator(`label[for="${id}"]`)).toBeVisible();
        await expect(form.locator(`#${id}`)).toBeVisible();
    }
    await expect(form.locator('button[type="submit"]')).toBeVisible();

    const mobileGroups = await form
        .locator('.form-group')
        .evaluateAll((groups) =>
            groups.map((group) => {
                const rect = group.getBoundingClientRect();
                return { left: rect.left, top: rect.top };
            }),
        );
    expect(mobileGroups).toHaveLength(7);
    for (let index = 1; index < mobileGroups.length; index += 1) {
        expect(
            Math.abs(mobileGroups[index].left - mobileGroups[0].left),
        ).toBeLessThanOrEqual(1);
        expect(mobileGroups[index].top).toBeGreaterThan(
            mobileGroups[index - 1].top,
        );
    }
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(390);

    const summary = page.locator('#sidegig-tax-summary');
    const summaryItems = summary.locator('.sg-tax-summary-items');
    const summaryNote = summary.locator('.sg-tax-summary-note');
    await expect(summary).toBeVisible();
    await expect(summaryItems).toBeVisible();
    await expect(summaryNote).toBeVisible();
    await expect
        .poll(() =>
            summary.evaluate(
                (element) => element.scrollWidth - element.clientWidth,
            ),
        )
        .toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const id of fieldIds) {
        await expect(form.locator(`#${id}`)).toBeVisible();
    }
    await expect(form.locator('button[type="submit"]')).toBeVisible();
    const desktopControlBounds = await form
        .locator('input, select, button')
        .evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            }),
        );
    for (const bounds of desktopControlBounds) {
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(1440);
    }
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(1440);
    await expect
        .poll(() =>
            summary.evaluate(
                (element) => element.scrollWidth - element.clientWidth,
            ),
        )
        .toBeLessThanOrEqual(1);
    await expect
        .poll(() =>
            summary.evaluate(
                (element) => element.getBoundingClientRect().right,
            ),
        )
        .toBeLessThanOrEqual(1440);
});

// #172: native selects were narrower than their selected option, so values
// read as "New York (NY - State Progres", "Most Categ", "Business / I".
// Select the longest option of each control and compare the select's width
// with its intrinsic width (a width:auto copy, which the browser sizes to fit
// the longest option plus padding and the native arrow).
test('selected values remain readable', async ({ page }) => {
    const desc = `E2E select-fit sale ${Date.now()}`;
    await page.locator('#sg-desc').fill(desc);
    await page.locator('#sg-revenue').fill('10');
    await page.locator('#sg-basis').selectOption('business');
    await page.locator('#form-sidegig-manual button[type="submit"]').click();
    const ledgerSelect = page
        .locator('tr', { hasText: desc })
        .locator('.sg-basis-select');
    await expect(ledgerSelect).toHaveValue('business');

    const fitOf = (locator) =>
        locator.evaluate((select) => {
            let longest = select.options[0];
            for (const opt of select.options)
                if (opt.text.length > longest.text.length) longest = opt;
            select.selectedIndex = longest.index;
            const probe = select.cloneNode(true);
            Object.assign(probe.style, {
                width: 'auto',
                minWidth: '0',
                maxWidth: 'none',
                position: 'absolute',
                visibility: 'hidden',
            });
            select.parentElement.append(probe);
            const need = probe.getBoundingClientRect().width;
            probe.remove();
            const rect = select.getBoundingClientRect();
            const card = select.closest('.card') || document.body;
            const cardRect = card.getBoundingClientRect();
            return {
                text: longest.text,
                need,
                have: rect.width + 1,
                inCard:
                    rect.left >= cardRect.left - 1 &&
                    rect.right <= cardRect.right + 1,
                inViewport:
                    rect.left >= 0 && rect.right <= window.innerWidth + 1,
            };
        });

    const viewports = [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
    ];
    const controls = {
        sidegig: [
            ledgerSelect,
            page.locator('#sg-basis'),
            page.locator('#ebay-category-rate'),
        ],
        expenses: [page.locator('#tax-filing-state')],
    };
    for (const [tab, selects] of Object.entries(controls)) {
        await page.setViewportSize(viewports[0]);
        await page.locator(`#btn-tab-${tab}`).click();
        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            for (const select of selects) {
                await select.scrollIntoViewIfNeeded();
                const c = await fitOf(select);
                const label = `${viewport.width}px ${c.text}`;
                expect(c.need, label).toBeLessThanOrEqual(c.have);
                expect(c.inCard, label).toBe(true);
                expect(c.inViewport, label).toBe(true);
            }
            await expect
                .poll(() =>
                    page.evaluate(() => document.documentElement.scrollWidth),
                )
                .toBeLessThanOrEqual(viewport.width);
        }
    }
});
