import { describe, it, expect, vi, afterEach } from 'vitest';
import cb from '../../app/lib/crypto-balance.js';

describe('detectIdentifierType', () => {
    it('detects ETH address with 0x prefix', () => {
        expect(cb.detectIdentifierType('0x' + 'a'.repeat(40))).toBe('address');
    });

    it('detects ENS name (lowercase)', () => {
        expect(cb.detectIdentifierType('you.eth')).toBe('ens');
    });

    it('detects ENS name (mixed case)', () => {
        expect(cb.detectIdentifierType('Sub.You.ETH')).toBe('ens');
    });

    it('detects ticker (uppercase)', () => {
        expect(cb.detectIdentifierType('ETH')).toBe('ticker');
        expect(cb.detectIdentifierType('BTC')).toBe('ticker');
        expect(cb.detectIdentifierType('USDC')).toBe('ticker');
    });

    it('detects ticker (lowercase)', () => {
        expect(cb.detectIdentifierType('btc')).toBe('ticker');
    });

    it('returns null for empty string', () => {
        expect(cb.detectIdentifierType('')).toBeNull();
    });

    it('returns null for null', () => {
        expect(cb.detectIdentifierType(null)).toBeNull();
    });

    it('returns null for number', () => {
        expect(cb.detectIdentifierType(42)).toBeNull();
    });

    it('returns null for invalid string', () => {
        expect(cb.detectIdentifierType('not a thing!')).toBeNull();
    });

    it('trims surrounding whitespace', () => {
        expect(cb.detectIdentifierType('  ETH  ')).toBe('ticker');
        expect(cb.detectIdentifierType('  you.eth  ')).toBe('ens');
        expect(cb.detectIdentifierType('  0x' + 'a'.repeat(40) + '  ')).toBe(
            'address',
        );
    });
});

describe('resolveEns', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns address on successful fetch', async () => {
        const expectedAddress = '0x' + '1'.repeat(40);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ address: expectedAddress }),
            }),
        );

        const address = await cb.resolveEns('you.eth');

        expect(address).toBe(expectedAddress);
        expect(fetch).toHaveBeenCalledWith(
            'https://ensdata.net/you.eth',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('rejects with status 502 on fetch ok: false', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        );

        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 502,
        });
    });

    it('rejects with status 404 when address is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({}),
            }),
        );

        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 404,
        });
    });

    it('rejects with status 404 when address is malformed', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ address: 'not-an-address' }),
            }),
        );

        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 404,
        });
    });

    it('rejects with status 404 when address is empty string', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ address: '' }),
            }),
        );

        await expect(cb.resolveEns('you.eth')).rejects.toMatchObject({
            status: 404,
        });
    });

    it('URL requested ends with /you.eth', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ address: '0x' + '1'.repeat(40) }),
            }),
        );

        await cb.resolveEns('you.eth');

        const calledUrl = fetch.mock.calls[0][0];
        expect(calledUrl).toMatch(/\/you\.eth$/);
    });
});

describe('resolveCryptoValue ticker path', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects with status 400 for unknown identifier', async () => {
        await expect(cb.resolveCryptoValue('???')).rejects.toMatchObject({
            status: 400,
        });
    });

    it('rejects with status 400 when quantity is 0', async () => {
        await expect(cb.resolveCryptoValue('ETH', 0)).rejects.toMatchObject({
            status: 400,
        });
    });

    it('rejects with status 400 when quantity is -1', async () => {
        await expect(cb.resolveCryptoValue('ETH', -1)).rejects.toMatchObject({
            status: 400,
        });
    });

    it('rejects with status 400 when quantity is omitted', async () => {
        await expect(cb.resolveCryptoValue('ETH')).rejects.toMatchObject({
            status: 400,
        });
    });

    it('returns usdValue, price, ticker, source for successful fetch', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    chart: {
                        result: [
                            {
                                meta: { regularMarketPrice: 1500 },
                            },
                        ],
                    },
                }),
            }),
        );

        const result = await cb.resolveCryptoValue('ETH', 2);

        expect(result).toEqual({
            usdValue: 3000,
            price: 1500,
            quantity: 2,
            ticker: 'ETH',
            source: 'yahoo-finance',
        });
    });

    it('returns usdValue 5 and source stablecoin-peg for USDC with fetch failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('network error')),
        );

        const result = await cb.resolveCryptoValue('USDC', 5);

        expect(result).toEqual({
            usdValue: 5,
            price: 1,
            quantity: 5,
            ticker: 'USDC',
            source: 'stablecoin-peg',
        });
    });

    it('returns usdValue 5 and source stablecoin-peg for USDC with ok: false', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        );

        const result = await cb.resolveCryptoValue('USDC', 5);

        expect(result).toEqual({
            usdValue: 5,
            price: 1,
            quantity: 5,
            ticker: 'USDC',
            source: 'stablecoin-peg',
        });
    });

    it('rejects with status 502 for non-stablecoin with ok: false', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 503 }),
        );

        await expect(cb.resolveCryptoValue('ETH', 2)).rejects.toMatchObject({
            status: 502,
        });
    });

    it('rejects with status 404 for empty chart data', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    chart: { result: [] },
                }),
            }),
        );

        await expect(cb.resolveCryptoValue('ETH', 2)).rejects.toMatchObject({
            status: 404,
        });
    });

    it('rejects with status 504 for TimeoutError', async () => {
        const timeoutError = Object.assign(new Error('x'), {
            name: 'TimeoutError',
        });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

        await expect(cb.resolveCryptoValue('ETH', 2)).rejects.toMatchObject({
            status: 504,
        });
    });
});
