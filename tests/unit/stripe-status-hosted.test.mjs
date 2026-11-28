import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { loadFacts } = require('../../app/lib/managers/quick-start.js');
const stripeCardSource = readFileSync(
    new URL('../../app/lib/managers/stripe-card.js', import.meta.url),
    'utf8',
);

afterEach(() => {
    delete globalThis.FireDeployMode;
    delete globalThis.FireQuickStartFacts;
    delete globalThis.state;
    delete globalThis.localStorage;
    delete globalThis.fetch;
});

describe('hosted Stripe status requests', () => {
    it('quick-start omits Stripe when deployment mode is hosted', async () => {
        const requested = [];
        globalThis.FireDeployMode = { whenKnown: async () => true };
        globalThis.FireQuickStartFacts = {
            buildQuickStartFacts: (facts) => facts,
        };
        globalThis.localStorage = { getItem: () => '1' };
        globalThis.state = {};
        globalThis.fetch = async (url) => {
            requested.push(url);
            return { ok: true, json: async () => ({ connected: false }) };
        };

        await loadFacts();

        expect(requested).not.toContain('/api/sync/stripe/status');
        expect(requested).toContain('/api/sync/ebay/status');
        expect(requested).toContain('/api/backup/drive/status');
    });

    it.each([false, null, undefined])(
        'quick-start retains Stripe when deployment mode is %s',
        async (mode) => {
            const requested = [];
            if (mode !== undefined) {
                globalThis.FireDeployMode = { whenKnown: async () => mode };
            }
            globalThis.FireQuickStartFacts = {
                buildQuickStartFacts: (facts) => facts,
            };
            globalThis.localStorage = { getItem: () => '1' };
            globalThis.state = {};
            globalThis.fetch = async (url) => {
                requested.push(url);
                return { ok: true, json: async () => ({ connected: false }) };
            };

            await loadFacts();

            expect(requested).toContain('/api/sync/stripe/status');
        },
    );

    it('Stripe card renders hosted-only status without fetching', async () => {
        const status = { textContent: '', style: {} };
        const document = {
            addEventListener() {},
            getElementById: (id) => (id === 'stripe-status' ? status : null),
        };
        const context = {
            document,
            FireDeployMode: { whenKnown: async () => true },
            fetch: async () => {
                throw new Error(
                    'hosted deployment must not fetch Stripe status',
                );
            },
        };
        vm.runInNewContext(stripeCardSource, context);

        await context.loadStripeCard();

        expect(status.textContent).toMatch(/self-hosted deployments only/);
    });

    it('Stripe card retains the status request for self-hosted deployments', async () => {
        const status = { textContent: '', style: {} };
        const requested = [];
        const document = {
            addEventListener() {},
            getElementById: (id) => (id === 'stripe-status' ? status : null),
        };
        const context = {
            document,
            FireDeployMode: { whenKnown: async () => false },
            stripeStatusBadge: () => ({
                label: 'Not connected',
                color: 'gray',
            }),
            stripeRecoveryHint: () => '',
            fetch: async (url) => {
                requested.push(url);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ configured: true, connected: false }),
                };
            },
        };
        vm.runInNewContext(stripeCardSource, context);

        await context.loadStripeCard();

        expect(requested).toEqual(['/api/sync/stripe/status']);
        expect(status.textContent).toBe('Not connected');
    });
});
