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
            await expect(page.locator('#stripe-status')).toHaveText(
                'Not connected',
            );
            await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
            await expect(page.locator('#stripe-hint')).toHaveText(
                'Store a Stripe restricted key via POST /api/sync/stripe/credentials (see docs/integrations.md).',
            );
            await expect(page.locator('#stripe-last-sync')).toHaveText(
                'Never synced',
            );
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
            await expect(page.locator('#stripe-status')).toHaveText(
                'Connected',
            );
            await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
            await expect(page.locator('#stripe-hint')).toBeHidden();
            await expect(page.locator('#stripe-last-sync')).toHaveText(
                'Never synced',
            );
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
            await expect(page.locator('#stripe-last-sync')).toContainText(
                'Last sync:',
            );
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
            await expect(page.locator('#stripe-status')).toHaveText(
                'Connected',
            );
            await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
            await expect(page.locator('#stripe-hint')).toBeHidden();
            await expect(page.locator('#stripe-last-sync')).toContainText(
                'Last sync:',
            );
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
                'Set SYNC_MASTER_KEY (64 hex characters) on your self-hosted server to enable Stripe sync.',
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
        await expect(page.locator('#stripe-status')).toHaveText(
            'Not connected',
        );
        await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
        await expect(page.locator('#stripe-hint')).toHaveText(
            'Store a Stripe restricted key via POST /api/sync/stripe/credentials (see docs/integrations.md).',
        );
        await expect(page.locator('#stripe-last-sync')).toHaveText(
            'Never synced',
        );
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

    test('disconnect: error shows message in hint, keeps connected state', async ({
        page,
    }) => {
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

        // Verify initial connected state
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
        await expect(page.locator('#stripe-last-sync')).toContainText(
            'Last sync:',
        );
        await expect(page.locator('#stripe-hint')).toBeHidden();

        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });

        await page.locator('#btn-stripe-disconnect').click();

        // Status, last-sync, and button should remain exactly as they were (connected state)
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();
        await expect(page.locator('#stripe-last-sync')).toContainText(
            'Last sync:',
        );
        // Error message appears in hint element
        await expect(page.locator('#stripe-hint')).toHaveText(
            'Disconnect failed: Internal server error',
        );
        await expect(page.locator('#stripe-hint')).toBeVisible();
    });

    test('stale status response after disconnect is ignored', async ({
        page,
    }) => {
        // Initial status: connected
        let statusResponse = {
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
        };

        await page.route('**/api/sync/stripe/status', async (route) => {
            // Add delay to simulate slow response
            await new Promise((r) => setTimeout(r, 500));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(statusResponse),
            });
        });

        // Disconnect returns disconnected state
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

        // Verify initial connected state
        await expect(page.locator('#stripe-status')).toHaveText('Connected');
        await expect(page.locator('#btn-stripe-disconnect')).toBeVisible();

        // Accept confirm and click disconnect
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });

        await page.locator('#btn-stripe-disconnect').click();

        // Wait for disconnect to complete (status should show Not connected)
        await expect(page.locator('#stripe-status')).toHaveText(
            'Not connected',
        );
        await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();

        // Now let the delayed status response resolve - it should be ignored
        // Card should still show disconnected state
        await new Promise((r) => setTimeout(r, 1000));
        await expect(page.locator('#stripe-status')).toHaveText(
            'Not connected',
        );
        await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
    });

    test('500 response shows load failure message', async ({ page }) => {
        await page.route('**/api/sync/stripe/status', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal server error' }),
            });
        });

        await openSettings(page);

        await expect(page.locator('#stripe-status')).toHaveText(
            'Unable to load Stripe status',
        );
        await expect(page.locator('#stripe-hint')).toHaveText(
            'Check the server is running, then reopen Settings to retry.',
        );
        await expect(page.locator('#stripe-hint')).toBeVisible();
        await expect(page.locator('#stripe-last-sync')).toBeHidden();
        await expect(page.locator('#btn-stripe-disconnect')).toBeHidden();
    });
});
