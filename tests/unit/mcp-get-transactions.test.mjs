import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';

process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-transactions-${process.pid}.json`,
);

let handleTool;

beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
});

const rows = [
    // Plaid writes YYYY-MM-DD, the CSV importer writes locale dates.
    {
        id: 'a',
        date: '2026-09-02',
        merchant: 'Whole Foods',
        amount: 40,
        category: 'food',
    },
    {
        id: 'b',
        date: '9/20/2026 02:20 AM',
        merchant: 'Shell',
        amount: 60.5,
        category: 'transport',
    },
    {
        id: 'c',
        date: '2026-09-30',
        merchant: 'Whole Foods',
        amount: 25,
        category: 'food',
    },
    {
        id: 'd',
        date: '2026-10-01',
        merchant: 'Netflix',
        amount: 15,
        category: 'subscriptions',
    },
    { id: 'e', date: '', merchant: 'Unknown', amount: 10, category: 'food' },
];

const stateWith = (txns = rows) => ({ spendingTransactions: txns });

describe('get_transactions', () => {
    it('returns rows newest first with totals and per-category sums', () => {
        const r = handleTool('get_transactions', stateWith());
        expect(r.matched).toBe(5);
        expect(r.count).toBe(5);
        expect(r.transactions.map((t) => t.id)).toEqual([
            'd',
            'c',
            'b',
            'a',
            'e',
        ]);
        expect(r.total).toBe(150.5);
        expect(r.byCategory.food).toBe(75);
        expect(r.limit).toBe(200);
    });

    it('filters by date range inclusive of both ends', () => {
        const r = handleTool('get_transactions', stateWith(), {
            from: '2026-09-02',
            to: '2026-09-02',
        });
        expect(r.transactions.map((t) => t.id)).toEqual(['a']);
    });

    it('filters by category (exact, case-insensitive) and merchant substring', () => {
        expect(
            handleTool('get_transactions', stateWith(), {
                category: 'FOOD',
            }).transactions.map((t) => t.id),
        ).toEqual(['c', 'a', 'e']);
        expect(
            handleTool('get_transactions', stateWith(), {
                merchant: 'whole',
            }).transactions.map((t) => t.id),
        ).toEqual(['c', 'a']);
    });

    it('honours limit but still reports totals for every match', () => {
        const r = handleTool('get_transactions', stateWith(), { limit: 2 });
        expect(r.transactions).toHaveLength(2);
        expect(r.count).toBe(2);
        expect(r.matched).toBe(5);
        expect(r.total).toBe(150.5);
        expect(
            handleTool('get_transactions', stateWith(), { limit: 9999 }).limit,
        ).toBe(1000);
    });

    it('rejects malformed or reversed dates', () => {
        expect(() =>
            handleTool('get_transactions', stateWith(), { from: '9/2/2026' }),
        ).toThrow(/YYYY-MM-DD/);
        expect(() =>
            handleTool('get_transactions', stateWith(), { to: '2026-13-45' }),
        ).toThrow(/not a real date/);
        expect(() =>
            handleTool('get_transactions', stateWith(), {
                from: '2026-10-01',
                to: '2026-09-01',
            }),
        ).toThrow(/must not be after/);
    });

    it('returns an empty result for an empty or missing state', () => {
        expect(handleTool('get_transactions', stateWith([]))).toMatchObject({
            transactions: [],
            count: 0,
            matched: 0,
            total: 0,
            byCategory: {},
        });
        expect(handleTool('get_transactions', {}).count).toBe(0);
    });
});
