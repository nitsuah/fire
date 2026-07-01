import { describe, it, expect } from 'vitest';
import { sortPositions } from '../../app/lib/finance-core.js';

// ─── sortPositions ─────────────────────────────────────────────────────────────

describe('sortPositions', () => {
    const positions = [
        {
            symbol: 'TSLA',
            description: 'Tesla',
            quantity: 5,
            lastPrice: 200,
            costBasis: 800,
            value: 1000,
            pnlDollar: 200,
        },
        {
            symbol: 'AAPL',
            description: 'Apple',
            quantity: 10,
            lastPrice: 175,
            costBasis: 1400,
            value: 1750,
            pnlDollar: 350,
        },
        {
            symbol: 'MSFT',
            description: 'Microsoft',
            quantity: 3,
            lastPrice: 380,
            costBasis: 900,
            value: 1140,
            pnlDollar: 240,
        },
    ];

    it('sorts by symbol ascending', () => {
        const sorted = sortPositions(positions, 'symbol', 'asc');
        expect(sorted[0].symbol).toBe('AAPL');
        expect(sorted[2].symbol).toBe('TSLA');
    });

    it('sorts by symbol descending', () => {
        const sorted = sortPositions(positions, 'symbol', 'desc');
        expect(sorted[0].symbol).toBe('TSLA');
    });

    it('sorts by pnlDollar descending (default)', () => {
        const sorted = sortPositions(positions, 'pnl', 'desc');
        expect(sorted[0].pnlDollar).toBe(350);
        expect(sorted[2].pnlDollar).toBe(200);
    });

    it('sorts by pnlDollar ascending', () => {
        const sorted = sortPositions(positions, 'pnl', 'asc');
        expect(sorted[0].pnlDollar).toBe(200);
    });

    it('sorts by value', () => {
        const sorted = sortPositions(positions, 'value', 'desc');
        expect(sorted[0].value).toBe(1750);
    });

    it('sorts by quantity', () => {
        const sorted = sortPositions(positions, 'qty', 'asc');
        expect(sorted[0].quantity).toBe(3);
    });

    it('sorts by price', () => {
        const sorted = sortPositions(positions, 'price', 'desc');
        expect(sorted[0].lastPrice).toBe(380);
    });

    it('sorts by cost basis', () => {
        const sorted = sortPositions(positions, 'cost', 'asc');
        expect(sorted[0].costBasis).toBe(800);
    });

    it('sorts by description', () => {
        const sorted = sortPositions(positions, 'desc', 'asc');
        expect(sorted[0].description).toBe('Apple');
    });

    it('does not mutate original array', () => {
        const original = [...positions];
        sortPositions(positions, 'symbol', 'asc');
        expect(positions[0].symbol).toBe(original[0].symbol);
    });
});
