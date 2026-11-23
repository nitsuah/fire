// @ts-check
const { test, expect } = require('@playwright/test');

// Smoke coverage for the Plaid Investments card: connect, reconnect and the
// empty / not-configured states read the same on a self-hosted server and on
// the hosted deploy (where /api/state answers 404 and the Netlify function
// serves /api/sync/plaid/*). Status is stubbed; no Plaid call is made.

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

const base = {
    configured: true,
    connected: false,
    itemCount: 0,
    lastTransactionsSync: null,
    lastSync: null,
    reauthRequired: false,
    syncEnabled: true,
};

const scenarios = [
    {
        name: 'not configured',
        status: { ...base, configured: false },
        text: /not configured on this deployment/,
        button: null,
    },
    {
        name: 'not linked',
        status: base,
        text: 'Status: Not Linked',
        button: 'Link Investment Account via Plaid',
    },
    {
        name: 'linked',
        status: {
            ...base,
            connected: true,
            itemCount: 1,
            lastSync: { at: '2026-11-01T00:00:00.000Z', ok: true },
        },
        text: 'Status: Linked (1 account)',
        button: 'Link Another Account via Plaid',
    },
    {
        name: 're-link required',
        status: {
            ...base,
            connected: true,
            itemCount: 1,
            reauthRequired: true,
            lastSync: {
                at: '2026-11-01T00:00:00.000Z',
                ok: false,
                errorCode: 'ITEM_LOGIN_REQUIRED',
            },
        },
        text: /Re-link required \(1 account\)/,
        button: 'Re-link Investment Account via Plaid',
    },
];

for (const hosted of [false, true]) {
    test.describe(`Plaid card (${hosted ? 'hosted' : 'self-hosted'})`, () => {
        for (const scenario of scenarios) {
            test(`status: ${scenario.name}`, async ({ page }) => {
                if (hosted) {
                    await page.route('**/api/state', (route) =>
                        route.fulfill({
                            status: 404,
                            contentType: 'application/json',
                            body: JSON.stringify({ error: 'Not found' }),
                        }),
                    );
                }
                await page.route('**/api/sync/plaid/status', (route) =>
                    route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(
                            hosted
                                ? { ...scenario.status, hosted: true }
                                : scenario.status,
                        ),
                    }),
                );
                await page.goto('/');
                await dismissPrivacyModal(page);
                await page.locator('#btn-tab-settings').click();

                const status = page.locator('#plaid-sync-status');
                await expect(status).toHaveText(scenario.text);
                const linkBtn = page.locator('#btn-plaid-link');
                if (scenario.button === null) {
                    await expect(linkBtn).toBeHidden();
                } else {
                    await expect(linkBtn).toBeVisible();
                    await expect(linkBtn).toHaveText(scenario.button);
                }
            });
        }
    });
}
