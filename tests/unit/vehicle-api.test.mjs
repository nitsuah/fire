import { vi, describe, it, expect, afterEach } from 'vitest';
import {
    decodeVin,
    estimateDepreciation,
    estimateVehicleValue,
} from '../../app/lib/vehicle-api.js';

const VALID_VIN = '1HGCM82633A004352';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.VINAUDIT_API_KEY;
    delete process.env.VEHICLE_VALUE_API_KEY;
    delete process.env.VEHICLE_VALUE_PROVIDER;
});

describe('decodeVin', () => {
    it('rejects a missing VIN with status 400', async () => {
        await expect(decodeVin()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a malformed VIN with status 400', async () => {
        await expect(decodeVin('not-a-vin')).rejects.toMatchObject({
            status: 400,
        });
    });

    it('rejects a VIN containing excluded letters (I/O/Q) with status 400', async () => {
        await expect(decodeVin('1HGCM82633A00435I')).rejects.toMatchObject({
            status: 400,
        });
    });

    it('decodes a valid VIN via the NHTSA API', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    Results: [
                        {
                            Make: 'Honda',
                            Model: 'Accord',
                            ModelYear: '2003',
                            Trim: 'EX',
                            BodyClass: 'Sedan',
                            FuelTypePrimary: 'Gasoline',
                            DisplacementL: '2.4',
                            ErrorCode: '0',
                        },
                    ],
                }),
            }),
        );
        const info = await decodeVin(VALID_VIN);
        expect(info).toMatchObject({
            make: 'Honda',
            model: 'Accord',
            year: 2003,
            trim: 'EX',
            engineSize: '2.4L',
        });
    });

    it('throws status 502 when NHTSA returns no results', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ Results: [] }),
            }),
        );
        await expect(decodeVin(VALID_VIN)).rejects.toMatchObject({
            status: 502,
        });
    });

    it('throws status 502 when the NHTSA response is not ok', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        );
        await expect(decodeVin(VALID_VIN)).rejects.toMatchObject({
            status: 502,
        });
    });

    it('throws status 504 when the request times out', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
        );
        await expect(decodeVin(VALID_VIN)).rejects.toMatchObject({
            status: 504,
        });
    });
});

describe('estimateDepreciation', () => {
    it('returns null without a purchase price', () => {
        expect(estimateDepreciation(2020, 0, 10000, 'Good')).toBeNull();
        expect(estimateDepreciation(2020, null, 10000, 'Good')).toBeNull();
    });

    it('returns null with an invalid year', () => {
        expect(estimateDepreciation('n/a', 20000, 10000, 'Good')).toBeNull();
    });

    it('returns full retention for a brand-new vehicle at average mileage', () => {
        const currentYear = new Date().getFullYear();
        const result = estimateDepreciation(currentYear, 10000, 0, 'Good');
        expect(result.value).toBe(10000);
        expect(result.age).toBe(0);
        expect(result.low).toBe(Math.round(10000 * 0.88));
        expect(result.high).toBe(Math.round(10000 * 1.12));
    });

    it('applies the year-1 retention curve and condition/mileage adjustments', () => {
        const currentYear = new Date().getFullYear();
        const result = estimateDepreciation(
            currentYear - 1,
            10000,
            12000,
            'Good',
        );
        // age=1 -> retention 0.8; mileage matches the 12k/yr expectation so
        // there's no mileage adjustment; 'Good' has no condition adjustment.
        expect(result.value).toBe(8000);
        expect(result.retentionPct).toBe(80);
    });

    it('reduces the estimate for poor condition and excess mileage', () => {
        const currentYear = new Date().getFullYear();
        const good = estimateDepreciation(currentYear - 1, 10000, 12000, 'Good');
        const poor = estimateDepreciation(currentYear - 1, 10000, 50000, 'Poor');
        expect(poor.value).toBeLessThan(good.value);
    });
});

describe('estimateVehicleValue', () => {
    it('computes depreciation only when there is no VIN or API key', async () => {
        const currentYear = new Date().getFullYear();
        const result = await estimateVehicleValue({
            year: currentYear - 2,
            purchasePrice: 20000,
            mileage: 24000,
            condition: 'Good',
        });
        expect(result.depreciation).not.toBeNull();
        expect(result.market).toBeNull();
        expect(result.vinInfo).toBeNull();
        expect(result.suggestedValue).toBe(result.depreciation.value);
    });

    it('blends depreciation and market data when a VinAudit key + VIN are present', async () => {
        process.env.VINAUDIT_API_KEY = 'test-key';
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.includes('vinaudit.com')) {
                    return {
                        ok: true,
                        json: async () => ({
                            success: true,
                            prices: { average: 9000, below: 8000, above: 10000 },
                            count: 12,
                        }),
                    };
                }
                if (u.includes('vpic.nhtsa.dot.gov')) {
                    return {
                        ok: true,
                        json: async () => ({
                            Results: [
                                {
                                    Make: 'Honda',
                                    Model: 'Accord',
                                    ModelYear: '2020',
                                    ErrorCode: '0',
                                },
                            ],
                        }),
                    };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        const currentYear = new Date().getFullYear();
        const result = await estimateVehicleValue({
            vin: VALID_VIN,
            year: currentYear - 1,
            purchasePrice: 10000,
            mileage: 12000,
            condition: 'Good',
        });
        expect(result.market.estimated).toBe(true);
        expect(result.market.value).toBe(9000);
        // suggestedValue averages depreciation (8000) and market (9000)
        expect(result.suggestedValue).toBe(8500);
        expect(result.vinInfo).toMatchObject({ make: 'Honda' });
        expect(result.range).toEqual({
            low: Math.min(Math.round(8000 * 0.88), 8000),
            high: Math.max(Math.round(8000 * 1.12), 10000),
        });
    });

    it('falls back to depreciation-only with a market warning when the provider errors', async () => {
        process.env.VINAUDIT_API_KEY = 'test-key';
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.includes('vinaudit.com')) {
                    return { ok: false, status: 500 };
                }
                if (u.includes('vpic.nhtsa.dot.gov')) {
                    return { ok: false, status: 500 };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        const currentYear = new Date().getFullYear();
        const result = await estimateVehicleValue({
            vin: VALID_VIN,
            year: currentYear - 1,
            purchasePrice: 10000,
            mileage: 12000,
            condition: 'Good',
        });
        expect(result.market.estimated).toBe(false);
        expect(result.market.error).toBeTruthy();
        expect(result.suggestedValue).toBe(result.depreciation.value);
    });
});
