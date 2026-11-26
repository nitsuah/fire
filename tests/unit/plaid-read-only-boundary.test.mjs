import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

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
        // Collect every first argument of plaidPost( calls (ignore the function definition)
        const plaidPostCalls = Array.from(
            serviceSource.matchAll(/plaidPost\(['"]([^'"]+)['"]/g),
            ([, path]) => path,
        );
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
        // Assert body.products = ['investments'] and no other products assignment
        expect(serviceSource).toMatch(/body\.products\s*=\s*\['investments'\]/);
        // No other products assignment
        const otherProducts = serviceSource.match(/body\.products\s*=/g) || [];
        expect(otherProducts).toHaveLength(1);
    });

    it('does not call transfer, payment, processor or signal endpoints', () => {
        const plaidPostCalls = Array.from(
            serviceSource.matchAll(/plaidPost\(['"]([^'"]+)['"]/g),
            ([, path]) => path,
        );
        const forbidden = plaidPostCalls.filter((p) =>
            /transfer|payment|processor|signal/i.test(p),
        );
        expect(forbidden).toEqual([]);
    });

    it('Express routes and Netlify function do not call Plaid directly', () => {
        expect(routesSource).not.toMatch(/plaid\.com\//);
        expect(netlifySource).not.toMatch(/plaid\.com\//);
    });
});
