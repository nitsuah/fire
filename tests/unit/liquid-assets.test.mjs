import { describe, it, expect } from 'vitest';
import { getLiquidAssets } from '../../app/lib/aggregates.mjs';

describe('getLiquidAssets', () => {
    it('sums Cash + Savings accounts + SPAXX position + CDs', () => {
        const importedPositions = [
            { symbol: 'SPAXX', description: '', value: 5000 },
            { symbol: 'AAPL', description: 'Apple Inc', value: 10000 },
        ];
        const customAccounts = [
            { type: 'Cash', value: 25000 },
            { type: 'Savings', value: 15000 },
            { type: 'Brokerage', value: 50000 },
        ];
        const cds = [
            { principal: 10000, rate: 5 },
            { principal: 5000, rate: 4.5 },
        ];
        expect(getLiquidAssets(importedPositions, customAccounts, cds)).toBe(
            60000,
        );
    });

    it('excludes Real Estate / Vehicle / Brokerage custom accounts', () => {
        const importedPositions = [
            { symbol: 'SPAXX', description: '', value: 5000 },
        ];
        const customAccounts = [
            { type: 'Real Estate', value: 100000 },
            { type: 'Vehicle', value: 30000 },
            { type: 'Brokerage', value: 50000 },
            { type: 'Cash', value: 10000 },
        ];
        const cds = [{ principal: 10000, rate: 5 }];
        expect(getLiquidAssets(importedPositions, customAccounts, cds)).toBe(
            25000,
        );
    });

    it('returns 0 for empty or undefined inputs', () => {
        expect(getLiquidAssets([], [], [])).toBe(0);
        expect(getLiquidAssets(undefined, undefined, undefined)).toBe(0);
        expect(getLiquidAssets(null, null, null)).toBe(0);
    });
});
