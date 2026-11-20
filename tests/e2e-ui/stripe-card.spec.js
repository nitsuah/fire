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

function openSettings(page) {
    return page.locator('#btn-tab-settings').click();
}

const statusScenarios = [
    {
        name: 'not configured',
        response: {
            configured: false,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
            lastSyncedAt: null,
            lastSyncOutcome: null,
        },
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText(
                'Stripe sync is available on self-hosted deployments only',
            );
            await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
            await expect(page.locator('#stripe-hint')).toBeVisible();
        },
    },
    {
        name: 'configured but not connected',
        response: {
            configured: true,
            connected: false,
            webhookConfigured: false,
            lastUpdated: new Date().toISOString(),
            lastSyncedAt: null,
            lastSyncOutcome: null,
        },
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText('Not connected');
            await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
            await expect(page.locator('#stripe-hint')).toHaveText(
                'Click Connect to link your Stripe account.',
            );
            await expect(page.locator('#stripe-last-sync')).toHaveText('Never synced');
        },
    },
    {
        name: 'connected never synced',
        response: {
            configured: true,
            connected: true,
            webhookConfigured: true,
            lastUpdated: new Date().toISOString(),
            lastSyncedAt: null,
            lastSyncOutcome: null,
        },
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText('Connected');
            await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
            await expect(page.locator('#stripe-hint')).toBeHidden();
            await expect(page.locator('#stripe-last-sync')).toHaveText('Never synced');
        },
    },
    {
        name: 'connected with failed outcome',
        response: {
            configured: true,
            connected: true,
            webhookConfigured: true,
            lastUpdated: new Date().toISOString(),
            lastSyncedAt: '2025-01-15T10:30:00.000Z',
            lastSyncOutcome: {
                ok: false,
                partial: false,
                errorCode: 'stripe_auth',
                at: '2025-01-15T10:30:00.000Z',
            },
        },
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText(
                'Last sync failed (stripe_auth)',
            );
            await expect(page.locator('#stripe-hint')).toHaveText(
                'Last sync failed. Check your connection and try syncing again.',
            );
            await expect(page.locator('#stripe-last-sync')).toContainText('Last sync:');
            // Ensure no provider message is shown
            const hintText = await page.locator('#stripe-hint').textContent();
            expect(hintText).not.toContain('stripe_auth');
            expect(hintText).not.toContain('invalid_grant');
        },
    },
    {
        name: 'connected with good sync',
        response: {
            configured: true,
            connected: true,
            webhookConfigured: true,
            lastUpdated: new Date().toISOString(),
            lastSyncedAt: '2025-01-15T10:30:00.000Z',
            lastSyncOutcome: {
                ok: true,
                partial: false,
                at: '2025-01-15T10:30:00.000Z',
            },
        },
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText('Connected');
            await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
            await expect(page.locator('#stripe-hint')).toBeHidden();
            await expect(page.locator('#stripe-last-sync')).toContainText('Last sync:');
        },
    },
    {
        name: '404 self-hosted only',
        response: null,
        status: 404,
        assert: async (page) => {
            await expect(page.locator('#stripe-status')).toHaveText(
                'Stripe sync is available on self-hosted deployments only',
            );
            await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
            await expect(page.locator('#stripe-hint')).toHaveText(
                'Set STRIPE_SECRET_KEY in the Netlify environment to enable Stripe sync.',
            );
        },
    },
];

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissPrivacyModal(page);
});

test.describe('Stripe connection card', () => {
    for (const scenario of statusScenarios) {
        test(`status: ${scenario.name}`, async ({ page }) => {
            await page.route('**/api/sync/stripe/status', async (route) => {
                if (scenario.response === null) {
                    await route.fulfill({
                        status: scenario.status || 404,
                        body: 'Not Found',
                    });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(scenario.response),
                    });
                }
            });

            await openSettings(page);
            await scenario.assert(page);
        });
    }

    test('disconnect: confirms, calls DELETE, re-renders not-connected', async ({
        page,
    }) => {
        // Initial: connected
        await page.route('**/api/sync/stripe/status', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    configured: true,
                    connected: true,
                    webhookConfigured: true,
                    lastUpdated: new Date().toISOString(),
                    lastSyncedAt: '2025-01-15T10:30:00.000Z',
                    lastSyncOutcome: {
                        ok: true,
                        partial: false,
                        at: '2025-01-15T10:30:00.000Z',
                    },
                }),
            });
        });

        // Disconnect returns not-connected
        await page.route('**/api/sync/stripe/disconnect', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    configured: true,
                    connected: false,
                    webhookConfigured: false,
                    lastUpdated: new Date().toISOString(),
                    lastSyncedAt: null,
                    lastSyncOutcome: null,
                }),
            });
        });

        await openSettings(page);
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();

        // Accept the confirm dialog
        page.on('dialog', async (dialog) => {
            expect(dialog.message()).toContain('Delete the stored Stripe key');
            await dialog.accept();
        });

        await page.locator('#btn-stripe-disconnect').click();

        // After disconnect, status should show "Not connected"
        await expect(page.locator('#stripe-status')).toHaveText('Not connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
        await expect(page.locator('#stripe-hint')).toHaveText(
            'Click Connect to link your Stripe account.',
        );
        await expect(page.locator('#stripe-last-sync')).toHaveText('Never synced');
    });

    test('disconnect: cancel keeps connected', async ({ page }) => {
        await page.route('**/api/sync/stripe/status', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    configured: true,
                    connected: true,
                    webhookConfigured: true,
                    lastUpdated: new Date().toISOString(),
                    lastSyncedAt: '2025-01-15T10:30:00.000Z',
                    lastSyncOutcome: {
                        ok: true,
                        partial: false,
                        at: '2025-01-15T10:30:00.000Z',
                    },
                }),
            });
        });

        await openSettings(page);
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();

        // Dismiss the confirm dialog
        page.on('dialog', async (dialog) => {
            await dialog.dismiss();
        });

        await page.locator('#btn-stripe-disconnect').click();

        // Should still be connected
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
    });

    test('disconnect: error shows message, keeps button', async ({ page }) => {
        await page.route('**/api/sync/stripe/status', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    configured: true,
                    connected: true,
                    webhookConfigured: true,
                    lastUpdated: new Date().toISOString(),
                    lastSyncedAt: '2025-01-15T10:30:00.000Z',
                    lastSyncOutcome: {
                        ok: true,
                        partial: false,
                        at: '2025-01-15T10:30:00.000Z',
                    },
                }),
            });
        });

        await page.route('**/api/sync/stripe/disconnect', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal server error' }),
            });
        });

        await openSettings(page);

        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });

        await page.locator('#btn-stripe-disconnect').click();

        await expect(page.locator('#stripe-status')).toHaveText(/Disconnect failed:/);
        await expect(page.locator('#stripe-status')).toHaveCSS('color', 'rgb(244, 63, 94)');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
    });
});