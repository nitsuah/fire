import { describe, it, expect } from 'vitest';
import {
    isBondPosition,
    getAggregateBonds,
    getAggregateEquities,
} from '../../app/lib/aggregates.mjs';

describe('isBondPosition', () => {
    it.each([
        [{ symbol: 'BND' }],
        [{ symbol: 'agg' }],
        [{ symbol: 'XYZ', description: 'Acme Total Bond Index' }],
        [{ symbol: 'XYZ', description: 'MUNICIPAL BONDS FUND' }],
    ])('treats %o as a bond fund', (pos) => {
        expect(isBondPosition(pos)).toBe(true);
    });

    it.each([
        [{ symbol: 'VTI', description: 'VANGUARD TOTAL STOCK MARKET' }],
        [{ symbol: 'XYZ', description: 'BONDED LOGISTICS INC' }],
        [{ symbol: 'SPAXX', description: 'MONEY MARKET' }],
        [{}],
    ])('does not treat %o as a bond fund', (pos) => {
        expect(isBondPosition(pos)).toBe(false);
    });

    it('sums bond funds as a subset of the equities aggregate', () => {
        const positions = [
            { symbol: 'BND', value: 400 },
            { symbol: 'VTI', value: 600 },
        ];
        expect(getAggregateBonds(positions)).toBe(400);
        expect(getAggregateEquities(positions, [])).toBe(1000);
        expect(getAggregateBonds(undefined)).toBe(0);
    });
});
