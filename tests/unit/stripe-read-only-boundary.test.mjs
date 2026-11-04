import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = readFileSync(
    new URL('../../app/lib/stripe-connector.js', import.meta.url),
    'utf8',
);

describe('Stripe read-only HTTP boundary', () => {
    it('uses only GET on the allowlisted balance-transactions endpoint', () => {
        const stripeUrls = [
            ...source.matchAll(
                /https:\/\/api\.stripe\.com\/v1\/[A-Za-z0-9_/-]+/g,
            ),
        ].map(([url]) => url);

        expect(stripeUrls).toEqual([
            'https://api.stripe.com/v1/balance_transactions',
        ]);
        expect(source).toMatch(/method:\s*['"]GET['"]/);
        expect(source).not.toMatch(
            /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
        );
    });

    it('does not access token storage or log keys/provider payloads', () => {
        expect(source).not.toMatch(
            /\b(?:getTokenFile|loadTokens|saveTokens|token-store)\b/,
        );
        expect(source).not.toMatch(/console\.(?:log|warn|error)/);
    });
});
