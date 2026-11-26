import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { createLinkToken } = require('../../app/lib/plaid-service.js');

const serviceSource = readFileSync(
    new URL('../../app/lib/plaid-service.js', import.meta.url),
    'utf8',
);

const routesSource = readFileSync(
    new URL('../../app/routes/plaid.js', import.meta.url),
    'utf8',
);

const netlifySource = readFileSync(
    new URL('../../netlify/functions/plaid.mjs', import.meta.url),
    'utf8',
);

describe('Plaid read-only boundary', () => {
    it('calls only the allowlisted Plaid endpoints', () => {
        // Inspect each plaidPost call, including multiline calls.
        const callCount = [
            ...serviceSource.matchAll(/(?<!function )\bplaidPost\s*\(/g),
        ].length;
        const plaidPostCalls = Array.from(
            serviceSource.matchAll(/\bplaidPost\s*\(\s*(['"])([^'"]+)\1/g),
            ([, , path]) => path,
        );
        expect(plaidPostCalls).toHaveLength(callCount);
        expect([...new Set(plaidPostCalls)].sort()).toEqual([
            '/accounts/balance/get',
            '/investments/holdings/get',
            '/item/get',
            '/item/public_token/exchange',
            '/link/token/create',
            '/transactions/sync',
        ]);
    });

    it('requests only the investments product', () => {
        // Assert the requested Link product is fixed.
        expect(serviceSource).toMatch(/body\.products\s*=\s*\['investments'\]/);
        // No other products assignment
        const otherProducts = serviceSource.match(/body\.products\s*=/g) || [];
        expect(otherProducts).toHaveLength(1);
    });

    it('pins Link products in create and update modes', async () => {
        const originalFetch = globalThis.fetch;
        const originalClientId = process.env.PLAID_CLIENT_ID;
        const originalSecret = process.env.PLAID_SECRET;
        const requests = [];
        process.env.PLAID_CLIENT_ID = 'test-client';
        process.env.PLAID_SECRET = 'test-secret';
        globalThis.fetch = async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ link_token: 'link-test' }),
            };
        };
        try {
            await createLinkToken();
            expect(requests[0].body.products).toEqual(['investments']);

            await createLinkToken({
                item: { accessToken: 'existing-access-token' },
            });
            expect(requests[1].body.access_token).toBe(
                'existing-access-token',
            );
            expect(requests[1].body).not.toHaveProperty('products');
        } finally {
            globalThis.fetch = originalFetch;
            if (originalClientId === undefined) {
                delete process.env.PLAID_CLIENT_ID;
            } else {
                process.env.PLAID_CLIENT_ID = originalClientId;
            }
            if (originalSecret === undefined) {
                delete process.env.PLAID_SECRET;
            } else {
                process.env.PLAID_SECRET = originalSecret;
            }
        }
    });

    it('does not call transfer, payment, processor or signal endpoints', () => {
        const callCount = [
            ...serviceSource.matchAll(/(?<!function )\bplaidPost\s*\(/g),
        ].length;
        const plaidPostCalls = Array.from(
            serviceSource.matchAll(/\bplaidPost\s*\(\s*(['"])([^'"]+)\1/g),
            ([, , path]) => path,
        );
        expect(plaidPostCalls).toHaveLength(callCount);
        const forbidden = plaidPostCalls.filter((p) =>
            /transfer|payment|processor|signal/i.test(p),
        );
        expect(forbidden).toEqual([]);
    });

    it('Express routes and Netlify function do not call Plaid directly', () => {
        expect(routesSource).not.toMatch(
            /\bplaid\.com\b/i,
        );
        expect(netlifySource).not.toMatch(
            /\bplaid\.com\b/i,
        );
    });
});
