import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    normalizeSpanYears,
    MAX_SPAN_YEARS,
} = require('../../app/lib/aggregates.js');

describe('normalizeSpanYears', () => {
    it('defaults missing, blank, invalid, boolean and out-of-range-low values', () => {
        for (const value of [
            undefined,
            null,
            '',
            '   ',
            'not a number',
            true,
            false,
            NaN,
            Infinity,
            0,
            -5,
        ]) {
            expect(normalizeSpanYears(value)).toBe(30);
        }
    });

    it('keeps supported integer values and numeric strings', () => {
        expect(normalizeSpanYears(1)).toBe(1);
        expect(normalizeSpanYears(30)).toBe(30);
        expect(normalizeSpanYears('12')).toBe(12);
        expect(normalizeSpanYears(' 12 ')).toBe(12);
        expect(normalizeSpanYears(MAX_SPAN_YEARS)).toBe(120);
    });

    it('truncates fractional values to whole years', () => {
        expect(normalizeSpanYears(7.9)).toBe(7);
        expect(normalizeSpanYears(1.9)).toBe(1);
    });

    it('clamps huge horizons to the existing 120-year maximum', () => {
        expect(normalizeSpanYears(121)).toBe(120);
        expect(normalizeSpanYears(1e9)).toBe(120);
        expect(MAX_SPAN_YEARS).toBe(120);
    });
});
