import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';

process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-recurring-charges-${process.pid}.json`,
);

let handleTool;
let detectRecurringCharges;
let normalizeMerchant;

beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
    ({ detectRecurringCharges, normalizeMerchant } =
        await import('../../app/lib/recurring-charges.js'));
});

const DAY_MS = 1000 * 60 * 60 * 24;
// Fixed clock so nextExpectedDate/daysUntilNext are deterministic.
const NOW = Date.parse('2026-10-26T00:00:00Z');
const day = (n) => new Date(NOW - n * DAY_MS).toISOString().slice(0, 10);

// One charge per day-offset supplied, so a test can place a whole series.
const series = (merchant, amount, daysAgo, category = 'Subscriptions') =>
    daysAgo.map((n) => ({ date: day(n), merchant, amount, category }));

describe('normalizeMerchant', () => {
    it('strips store numbers, phone numbers and punctuation', () => {
        expect(normalizeMerchant('NETFLIX.COM 866-579-7172')).toBe(
            'netflix com',
        );
        expect(normalizeMerchant('AMZN Mktp US*2K4LM9')).toBe('amzn mktp us');
        expect(normalizeMerchant('  Blue Bottle #1234 ')).toBe('blue bottle');
    });
});

describe('detectRecurringCharges', () => {
    it('flags a monthly subscription with the next expected date', () => {
        const r = detectRecurringCharges(
            series('Netflix', 15.49, [95, 65, 35, 5]),
            { now: NOW },
        );
        expect(r.count).toBe(1);
        expect(r.charges[0]).toMatchObject({
            merchant: 'Netflix',
            cadence: 'monthly',
            typicalAmount: 15.49,
            occurrences: 4,
            lastDate: day(5),
        });
        expect(r.monthlyTotal).toBe(15.49);
        expect(r.annualTotal).toBe(185.88);
        // ~30 days after the last charge, which was 5 days ago.
        expect(r.charges[0].daysUntilNext).toBeGreaterThan(20);
        expect(r.charges[0].daysUntilNext).toBeLessThan(30);
    });

    it('keeps a series through a price rise inside the tolerance', () => {
        const txns = [
            { date: day(65), merchant: 'Spotify', amount: 10.99 },
            { date: day(35), merchant: 'Spotify', amount: 10.99 },
            { date: day(5), merchant: 'Spotify', amount: 11.99 },
        ];
        const r = detectRecurringCharges(txns, { now: NOW });
        expect(r.count).toBe(1);
        expect(r.charges[0].occurrences).toBe(3);
        expect(r.charges[0].cadence).toBe('monthly');
    });

    it('detects an annual bill from two charges', () => {
        const txns = [
            { date: day(370), merchant: 'Amazon Prime', amount: 139 },
            { date: day(5), merchant: 'Amazon Prime', amount: 139 },
        ];
        const r = detectRecurringCharges(txns, { now: NOW });
        expect(r.charges[0]).toMatchObject({
            cadence: 'annual',
            occurrences: 2,
        });
        expect(r.charges[0].monthlyEquivalent).toBe(11.58);
    });

    it('detects a weekly charge', () => {
        const txns = [21, 14, 7].map((ago) => ({
            date: day(ago),
            merchant: 'Blue Bottle',
            amount: 6.5,
        }));
        const r = detectRecurringCharges(txns, { now: NOW });
        expect(r.charges[0]).toMatchObject({
            cadence: 'weekly',
            occurrences: 3,
        });
        expect(r.charges[0].monthlyEquivalent).toBe(28.17);
    });

    it('ignores one-off purchases and irregular repeat visits', () => {
        const txns = [
            { date: day(200), merchant: 'Home Depot', amount: 400 },
            { date: day(3), merchant: 'Home Depot', amount: 22 },
            { date: day(160), merchant: 'Target', amount: 55 },
            { date: day(120), merchant: 'Target', amount: 61 },
            { date: day(64), merchant: 'Target', amount: 49 },
            { date: day(9), merchant: 'Target', amount: 70 },
        ];
        const r = detectRecurringCharges(txns, { now: NOW });
        expect(r.charges).toEqual([]);
        expect(r.monthlyTotal).toBe(0);
    });

    it('ignores refunds, unparseable dates and an empty list', () => {
        const txns = [
            { date: day(35), merchant: 'Gym', amount: -40 },
            { date: day(5), merchant: 'Gym', amount: -40 },
            { date: 'not a date', merchant: 'Gym', amount: 40 },
        ];
        expect(detectRecurringCharges(txns, { now: NOW }).charges).toEqual([]);
        expect(detectRecurringCharges([], { now: NOW }).count).toBe(0);
        expect(detectRecurringCharges(undefined, { now: NOW }).count).toBe(0);
    });

    it('groups the same subscription across merchant string noise', () => {
        const txns = [
            { date: day(65), merchant: 'NETFLIX.COM 866-579-7172', amount: 20 },
            { date: day(35), merchant: 'NETFLIX.COM 866-579-7172', amount: 20 },
            { date: day(5), merchant: 'Netflix.com', amount: 20 },
        ];
        const r = detectRecurringCharges(txns, { now: NOW });
        expect(r.count).toBe(1);
        expect(r.charges[0].occurrences).toBe(3);
    });

    it('sorts by monthly cost, highest first', () => {
        const r = detectRecurringCharges(
            [
                ...series('Cheap', 3, [65, 35, 5]),
                ...series('Pricey', 80, [65, 35, 5]),
            ],
            { now: NOW },
        );
        expect(r.charges.map((c) => c.merchant)).toEqual(['Pricey', 'Cheap']);
        expect(r.monthlyTotal).toBe(83);
    });
});

describe('MCP get_recurring_charges', () => {
    const state = {
        spendingTransactions: series('Netflix', 15.49, [65, 35, 5]),
    };

    it('returns the detected series from state', () => {
        const r = handleTool('get_recurring_charges', state);
        expect(r.count).toBe(1);
        expect(r.charges[0].merchant).toBe('Netflix');
        expect(r.monthlyTotal).toBe(15.49);
    });

    it('honours minOccurrences', () => {
        const mixed = {
            spendingTransactions: [
                ...series('Netflix', 15.49, [65, 35, 5]),
                { date: day(370), merchant: 'Prime', amount: 139 },
                { date: day(5), merchant: 'Prime', amount: 139 },
            ],
        };
        const all = handleTool('get_recurring_charges', mixed);
        expect(all.count).toBe(2);
        const filtered = handleTool('get_recurring_charges', mixed, {
            minOccurrences: 3,
        });
        expect(filtered.charges.map((c) => c.merchant)).toEqual(['Netflix']);
        expect(filtered.minOccurrences).toBe(3);
    });

    it('returns an empty list when there are no transactions', () => {
        expect(handleTool('get_recurring_charges', {})).toMatchObject({
            charges: [],
            count: 0,
            monthlyTotal: 0,
        });
    });
});
