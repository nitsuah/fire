import { describe, it, expect, vi } from 'vitest';
import mc from '../../app/lib/multichain-balance.js';

const ADDR = '0x' + 'b'.repeat(40);

const token = (over = {}, value = '1000000') => ({
    value,
    token: {
        type: 'ERC-20',
        symbol: 'USDC',
        decimals: '6',
        exchange_rate: '1',
        holders_count: '1000000',
        reputation: 'ok',
        address_hash: '0xusdc',
        ...over,
    },
});

// Fake explorers: per-host native balances/tokens; RPC hosts answer with a
// hex balance; hosts in `fail` return 503.
function fakeFetch({ natives = {}, tokens = {}, fail = [] } = {}) {
    return vi.fn(async (url) => {
        const u = String(url);
        const host = new URL(u).host;
        if (fail.includes(host)) return new Response('boom', { status: 503 });
        if (u.endsWith('/token-balances'))
            return Response.json(tokens[host] || []);
        if (u.includes('/api/v2/addresses/'))
            return Response.json(
                natives[host] || { coin_balance: '0', exchange_rate: '2000' },
            );
        if (u.includes('finance.yahoo.com'))
            return Response.json({
                chart: { result: [{ meta: { regularMarketPrice: 600 } }] },
            });
        return Response.json({ result: natives[host] || '0x0' });
    });
}

describe('fromUnits', () => {
    it('converts integer strings by decimals without float drift', () => {
        expect(mc.fromUnits('1500000000000000000')).toBe(1.5);
        expect(mc.fromUnits('1000000', 6)).toBe(1);
        expect(mc.fromUnits('5', 0)).toBe(5);
        expect(mc.fromUnits(null)).toBe(0);
    });
});

describe('priceToken', () => {
    it('prices a reputable ERC-20 token', () => {
        expect(mc.priceToken(token({}, '2500000'))).toEqual({
            symbol: 'USDC',
            balance: 2.5,
            usdValue: 2.5,
            contract: '0xusdc',
        });
    });

    it('skips spam: scams, unpriced, few holders, absurd values, NFTs', () => {
        expect(mc.priceToken(token({ reputation: 'scam' }))).toBeNull();
        expect(mc.priceToken(token({ exchange_rate: null }))).toBeNull();
        expect(mc.priceToken(token({ holders_count: '3' }))).toBeNull();
        expect(
            mc.priceToken(token({ exchange_rate: '1e9' }, '1000000000000')),
        ).toBeNull();
        expect(mc.priceToken(token({ type: 'ERC-721' }))).toBeNull();
    });
});

describe('getMultichainValue', () => {
    it('totals native coins and priced tokens across chains', async () => {
        const fetchImpl = fakeFetch({
            natives: {
                'eth.blockscout.com': {
                    coin_balance: '500000000000000000',
                    exchange_rate: '2000',
                },
                // 1 BNB @ $600
                'bsc-rpc.publicnode.com': '0xde0b6b3a7640000',
            },
            tokens: {
                'base.blockscout.com': [
                    token({}, '10000000'),
                    token({ reputation: 'scam' }, '99000000'),
                ],
            },
        });
        const r = await mc.getMultichainValue(ADDR, { fetchImpl });
        expect(r.usdValue).toBe(1000 + 600 + 10);
        expect(r.partial).toBe(false);
        const byId = Object.fromEntries(r.chains.map((c) => [c.chain, c]));
        expect(byId.ethereum).toMatchObject({
            native: 0.5,
            nativeUsd: 1000,
            usdValue: 1000,
        });
        expect(byId.bnb).toMatchObject({ native: 1, nativeUsd: 600 });
        expect(byId.base.tokens).toHaveLength(1);
        expect(byId.base.tokenUsd).toBe(10);
    });

    it('keeps the other chains when one fails, and flags the total as partial', async () => {
        const fetchImpl = fakeFetch({
            natives: {
                'eth.blockscout.com': {
                    coin_balance: '1000000000000000000',
                    exchange_rate: '2000',
                },
            },
            fail: ['polygon.blockscout.com'],
        });
        const r = await mc.getMultichainValue(ADDR, { fetchImpl });
        expect(r.usdValue).toBe(2000);
        expect(r.partial).toBe(true);
        expect(r.chains.find((c) => c.chain === 'polygon')).toMatchObject({
            ok: false,
            warning: expect.stringMatching(/Lookup failed/),
        });
    });

    it('fails outright only when every chain fails', async () => {
        const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
        await expect(
            mc.getMultichainValue(ADDR, { fetchImpl }),
        ).rejects.toMatchObject({ status: 502 });
        await expect(mc.getMultichainValue('nope')).rejects.toMatchObject({
            status: 400,
        });
    });

    it('summarizes chains for storage: non-empty or failed, largest first, top tokens only', () => {
        const s = mc.summarizeChains([
            {
                chain: 'a',
                name: 'A',
                usdValue: 5,
                ok: true,
                tokens: [{ symbol: 'X', usdValue: 4, balance: 1 }],
            },
            { chain: 'b', name: 'B', usdValue: 0, ok: true, tokens: [] },
            { chain: 'c', name: 'C', usdValue: 50, ok: true, tokens: [] },
            { chain: 'd', name: 'D', usdValue: 0, ok: false, tokens: [] },
        ]);
        expect(s.map((c) => c.chain)).toEqual(['c', 'a', 'd']);
        expect(s[1].topTokens).toEqual([{ symbol: 'X', usdValue: 4 }]);
    });
});
