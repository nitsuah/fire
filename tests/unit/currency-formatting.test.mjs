import { describe, it, expect } from 'vitest';
import { formatCurrency, pnlColorStyle } from '../../app/lib/finance-core.js';

// ─── formatCurrency ────────────────────────────────────────────────────────────

describe('formatCurrency', () => {
    it('formats a positive integer', () => {
        expect(formatCurrency(1000)).toBe('$1,000.00');
    });

    it('formats zero', () => {
        expect(formatCurrency(0)).toBe('$0.00');
    });

    it('formats a negative value', () => {
        expect(formatCurrency(-250.5)).toBe('-$250.50');
    });

    it('formats a large number with commas', () => {
        expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
    });

    it('returns $0.00 for NaN', () => {
        expect(formatCurrency(NaN)).toBe('$0.00');
        expect(formatCurrency('not a number')).toBe('$0.00');
    });

    it('coerces a string number', () => {
        expect(formatCurrency('500')).toBe('$500.00');
    });
});

// ─── pnlColorStyle ────────────────────────────────────────────────────────────────

describe('pnlColorStyle', () => {
    it('returns muted color for zero pnl', () => {
        expect(pnlColorStyle(0, 50)).toBe('color: var(--text-muted);');
    });

    it('returns muted color for near-zero maxAbsPct', () => {
        expect(pnlColorStyle(5, 0.001)).toBe('color: var(--text-muted);');
    });

    it('returns green hsl for positive pnl', () => {
        const style = pnlColorStyle(20, 50);
        expect(style).toMatch(/hsl\(142,/);
    });

    it('returns red hsl for negative pnl', () => {
        const style = pnlColorStyle(-20, 50);
        expect(style).toMatch(/hsl\(0,/);
    });

    it('clamps norm to [-1, 1]', () => {
        // pnlPct much larger than maxAbsPct
        const style1 = pnlColorStyle(1000, 50);
        const style2 = pnlColorStyle(50, 50);
        // Both should produce green (max intensity), check format
        expect(style1).toMatch(/hsl\(142,/);
        expect(style2).toMatch(/hsl\(142,/);
    });
});
