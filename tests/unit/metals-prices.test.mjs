import { vi, describe, it, expect, afterEach } from 'vitest';
import { resolveMetalValue } from '../../app/lib/metals-prices.js';

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.METALS_API_KEY;
});

describe('resolveMetalValue', () => {
    it('rejects an unsupported metal', async () => {
        await expect(resolveMetalValue('platinum', 5)).rejects.toThrow(
            /Unsupported metal/,
        );
    });

    it('rejects a missing/non-positive weightOz', async () => {
        await expect(resolveMetalValue('gold', 0)).rejects.toThrow(/weightOz/);
        await expect(resolveMetalValue('gold', -1)).rejects.toThrow(/weightOz/);
        await expect(resolveMetalValue('gold', undefined)).rejects.toThrow(
            /weightOz/,
        );
    });

    it('uses the Yahoo fallback when METALS_API_KEY is not set', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                chart: { result: [{ meta: { regularMarketPrice: 2400 } }] },
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await resolveMetalValue('gold', 3);
        // 3oz × $2400 spot × 95% gold payout
        expect(result.usdValue).toBeCloseTo(6840, 6);
        expect(result.pricePerOz).toBe(2400);
        expect(result.payoutPct).toBe(0.95);
        expect(result.source).toBe('yahoo-finance');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('GC%3DF'),
            expect.any(Object),
        );
    });

    it('uses the silver symbol for silver', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                chart: { result: [{ meta: { regularMarketPrice: 30 } }] },
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await resolveMetalValue('silver', 10);
        // 10oz × $30 spot × 88% silver payout
        expect(result.usdValue).toBeCloseTo(264, 6);
        expect(result.payoutPct).toBe(0.88);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('SI%3DF'),
            expect.any(Object),
        );
    });

    it('prefers metals.dev when METALS_API_KEY is set', async () => {
        process.env.METALS_API_KEY = 'test-key';
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ metals: { gold: 2500 } }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await resolveMetalValue('gold', 2);
        expect(result.usdValue).toBeCloseTo(4750, 6); // 2oz × $2500 × 95%
        expect(result.source).toBe('metals.dev');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('api.metals.dev'),
            expect.any(Object),
        );
    });

    it('falls back to Yahoo when metals.dev fails', async () => {
        process.env.METALS_API_KEY = 'test-key';
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 500 })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    chart: {
                        result: [{ meta: { regularMarketPrice: 2200 } }],
                    },
                }),
            });
        vi.stubGlobal('fetch', fetchMock);

        const result = await resolveMetalValue('gold', 1);
        expect(result.usdValue).toBeCloseTo(2090, 6); // 1oz × $2200 × 95%
        expect(result.source).toBe('yahoo-finance');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when Yahoo returns no usable price', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ chart: { result: [] } }),
            }),
        );
        await expect(resolveMetalValue('gold', 1)).rejects.toThrow(/no price/);
    });

    it('throws when Yahoo responds with a non-ok status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 503 }),
        );
        await expect(resolveMetalValue('silver', 1)).rejects.toThrow(
            /failed \(503\)/,
        );
    });
});
