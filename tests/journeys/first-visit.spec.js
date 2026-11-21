// @ts-check
const { test, expect, step, settle } = require('./fire');

test(
    'first visit: accept the privacy terms and see my net worth',
    {
        tag: [
            '@feature:privacy-modal',
            '@feature:header-summary-bar',
            '@feature:asset-allocation-drill-down',
            '@feature:cd-tracker',
        ],
    },
    async ({ page }) => {
        const accept = page.getByRole('button', {
            name: /I Understand.*Continue/i,
        });

        await step(
            page,
            'open the app',
            async () => {
                await page.goto('/');
                await expect(accept).toBeVisible();
                const privacyBody = page.locator('#privacy-modal-body');
                await expect(privacyBody).toBeVisible();
                await expect(
                    privacyBody.locator(
                        'a[href^="./"], a[href$=".md"]:not([href^="http"])',
                    ),
                    'privacy modal renders relative docs links that 404 in-app',
                ).toHaveCount(0);
                await expect(
                    privacyBody,
                    'privacy modal renders the GitHub nav row (#166)',
                ).not.toContainText('Features · Roadmap');
            },
            { docs: 'privacy-modal' },
        );

        await step(
            page,
            'accept the privacy terms',
            async () => {
                await accept.click();
                await expect(accept).toBeHidden();
                await settle(page);
                await expect(page.locator('#quick-start-card')).toBeVisible();
                await expect(page.locator('#quick-start-progress')).toHaveText(/^[1-5] of 6 done$/);
                await expect(page.locator('#quick-start-steps li', { hasText: 'Add or import your accounts' })).toHaveClass(/done/);
                await page.locator('#quick-start-dismiss').click();
                await expect(page.locator('#quick-start-card')).toBeHidden();
                await expect(page.locator('#quick-start-reopen')).toBeVisible();
                const dismissed = await page.evaluate(() => localStorage.getItem('fire_quick_start_dismissed'));
                expect(dismissed).toBe('1');
                await page.locator('#quick-start-reopen').click();
                await expect(page.locator('#quick-start-card')).toBeVisible();
                const reopened = await page.evaluate(() => localStorage.getItem('fire_quick_start_dismissed'));
                expect(reopened).toBeNull();
                await page.locator('#compact-fire-bar').hover();
                await expect(page.locator('#alloc-tooltip')).toContainText(
                    'Net Worth',
                );
                await expect(page.locator('#alloc-tooltip')).toContainText(
                    '$287,897.50',
                );
                await expect(page.locator('#banner-spend')).toHaveText(
                    '$44,640.00',
                );
            },
            { docs: 'header-summary-bar' },
        );

        await step(
            page,
            'drill into equities',
            async () => {
                const alloc = page.locator('#tab-dashboard .card', {
                    has: page.locator('h2, h3', {
                        hasText: 'Asset Allocation',
                    }),
                });
                await alloc
                    .locator('button')
                    .filter({ hasText: /Equit/ })
                    .first()
                    .click();
                await expect(alloc).toContainText('VTI');
            },
            { docs: 'asset-allocation-drill-down' },
        );
    },
);
