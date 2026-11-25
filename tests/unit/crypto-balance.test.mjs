import cb from '../../app/lib/crypto-balance.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const address = `0x${'1'.repeat(40)}`;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('detectIdentifierType', () => {
    it.each([
        [`0x${'a'.repeat(40)}`, 'address'],
        ['you.eth', 'ens'],
        ['Sub.You.ETH', 'ens'],
        ['ETH', 'ticker'],
        ['btc', 'ticker'],
        ['USDC', 'ticker'],
        ['  ETH  ', 'ticker'],
        ['', null],
        [null, null],
        [42, null],
        ['not a thing!', null],
    ])('classifies %s as %s', (id, expected) => {
        expect(cb.detectIdentifierType(id)).toBe(expected);
    });
});

describe('resolveEns', () => {
    it('returns the address and requests the normalized name', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ address }),
        });
        await expect(cb.resolveEns('You.ETH')).resolves.toBe(address);
        expect(fetch.mock.calls[0][0]).toMatch(/\/you\.eth$/);
    });

    it('maps HTTP errors to 502', async () => {
        fetch.mockResolvedValue({ ok: false, status: 500 });
        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 502,
        });
    });

    it.each([
        {},
        { address: 'not-an-address' },
    ])('maps invalid addresses to 404', async (data) => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => data,
        });
        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 404,
        });
    });
});

describe('resolveCryptoValue ticker path', () => {
    it('rejects unknown identifiers and invalid quantities', async () => {
        await expect(cb.resolveCryptoValue('???', 1)).rejects.toMatchObject({
            status: 400,
        });
        for (const quantity of [undefined, 0, -1]) {
            await expect(
                cb.resolveCryptoValue('ETH', quantity),
            ).rejects.toMatchObject({ status: 400 });
        }
    });

    it('returns the Yahoo price multiplied by quantity', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                chart: {
                    result: [{ meta: { regularMarketPrice: 1500 } }],
                },
            }),
        });
        await expect(cb.resolveCryptoValue('ETH', 2)).resolves.toMatchObject({
            usdValue: 3000,
            price: 1500,
            quantity: 2,
            ticker: 'ETH',
            source: 'yahoo-finance',
        });
    });

    it.each(['reject', 'http-error'])(
        'uses the stablecoin peg when fetch %s',
        async (failure) => {
            if (failure === 'reject') {
                fetch.mockRejectedValue(new Error('network unavailable'));
            } else {
                fetch.mockResolvedValue({ ok: false, status: 503 });
            }
            await expect(
                cb.resolveCryptoValue('USDC', 5),
            ).resolves.toMatchObject({
                usdValue: 5,
                price: 1,
                ticker: 'USDC',
                source: 'stablecoin-peg',
            });
        },
    );

    it('maps non-stablecoin HTTP errors to 502', async () => {
        fetch.mockResolvedValue({ ok: false, status: 503 });
        await expect(cb.resolveCryptoValue('ETH', 1)).rejects.toMatchObject({
            status: 502,
        });
    });

    it('maps empty chart data to 404', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ chart: { result: [] } }),
        });
        await expect(cb.resolveCryptoValue('ETH', 1)).rejects.toMatchObject({
            status: 404,
        });
    });

    it('maps timeouts to 504', async () => {
        fetch.mockRejectedValue(
            Object.assign(new Error('x'), { name: 'TimeoutError' }),
        );
        await expect(cb.resolveCryptoValue('ETH', 1)).rejects.toMatchObject({
            status: 504,
        });
    });
});
