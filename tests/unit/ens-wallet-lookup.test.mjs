import { describe, it, expect } from 'vitest';
import {
    mapEnsErrorToResponse,
    aggregateEvmWalletValue,
} from '../../app/lib/ens-wallet-lookup.js';

describe('mapEnsErrorToResponse', () => {
    it('maps NOT_FOUND to 404', () => {
        const { status, body } = mapEnsErrorToResponse({
            code: 'NOT_FOUND',
            message: 'No address is set for nobody.eth.',
        });
        expect(status).toBe(404);
        expect(body.error).toMatch(/nobody\.eth/);
    });

    it('maps INVALID_NAME to 400', () => {
        const { status } = mapEnsErrorToResponse({ code: 'INVALID_NAME' });
        expect(status).toBe(400);
    });

    it('maps anything else (e.g. RESOLVE_FAILED) to 502', () => {
        const { status } = mapEnsErrorToResponse({
            code: 'RESOLVE_FAILED',
            message: 'network down',
        });
        expect(status).toBe(502);
    });

    it('falls back to a generic message when the error has none', () => {
        const { body } = mapEnsErrorToResponse({});
        expect(body.error).toBe('ENS lookup failed.');
    });
});

const EVM_CHAINS = [
    { id: 'ethereum', name: 'Ethereum', nativeSymbol: 'ETH' },
    { id: 'bnb', name: 'BNB Smart Chain', nativeSymbol: 'BNB' },
    { id: 'polygon', name: 'Polygon', nativeSymbol: 'MATIC' },
];

describe('aggregateEvmWalletValue', () => {
    it('sums usdValue across chains that succeed', async () => {
        const refreshFn = async ({ chain }) => {
            if (chain === 'ethereum')
                return { lastBalance: 2, lastUsdValue: 6000, lastPrice: 3000 };
            if (chain === 'polygon')
                return { lastBalance: 500, lastUsdValue: 400, lastPrice: 0.8 };
            return { warning: 'BSCSCAN_API_KEY not set' };
        };
        const { chains, totalUsdValue } = await aggregateEvmWalletValue(
            '0xabc',
            EVM_CHAINS,
            refreshFn,
        );
        expect(totalUsdValue).toBe(6400);
        expect(chains).toHaveLength(3);
        expect(chains.find((c) => c.chain === 'ethereum')).toMatchObject({
            ok: true,
            usdValue: 6000,
            nativeSymbol: 'ETH',
        });
        expect(chains.find((c) => c.chain === 'bnb')).toMatchObject({
            ok: false,
            usdValue: 0,
            warning: 'BSCSCAN_API_KEY not set',
        });
    });

    it('treats a rejected chain lookup as a warning, not a hard failure', async () => {
        const refreshFn = async ({ chain }) => {
            if (chain === 'ethereum') throw new Error('Explorer timeout');
            return { lastBalance: 1, lastUsdValue: 100 };
        };
        const { chains, totalUsdValue } = await aggregateEvmWalletValue(
            '0xabc',
            EVM_CHAINS,
            refreshFn,
        );
        const eth = chains.find((c) => c.chain === 'ethereum');
        expect(eth.ok).toBe(false);
        expect(eth.warning).toBe('Explorer timeout');
        // The other two chains still contributed to the total.
        expect(totalUsdValue).toBe(200);
    });

    it('returns a zero total for an empty chain list', async () => {
        const { chains, totalUsdValue } = await aggregateEvmWalletValue(
            '0xabc',
            [],
            async () => ({}),
        );
        expect(chains).toEqual([]);
        expect(totalUsdValue).toBe(0);
    });
});
