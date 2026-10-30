import { describe, it, expect, vi } from 'vitest';
import {
    collectFacts,
    compareRates,
    pickAction,
    sanitizeRates,
    loadRates,
    isoWeek,
    upcomingEnds,
    daysUntil,
    numbersPreserved,
    run,
} from '../../scripts/fin-checkin.mjs';

// Fake numbers only. Today in every test: Friday 2026-01-30 (ISO week 5).
const TODAY = { y: 2026, m: 1, d: 30 };
const DATE = '2026-01-30';

function fakeState(over = {}) {
    return {
        importedPositions: [
            {
                symbol: 'FAKE',
                value: 1000,
                priceUpdatedAt: '2026-01-29T12:00:00Z',
            },
        ],
        customAccounts: [
            {
                id: 1,
                name: 'Fake Savings',
                type: 'Savings',
                value: 4000,
                apy: 3,
            },
        ],
        cds: [
            {
                id: 1,
                bank: 'Test Bank',
                principal: 5000,
                rate: 4,
                maturity: '2026-06-30',
            },
        ],
        expenses: { housing: 500 },
        projectionSettings: { swr: 4 },
        ...over,
    };
}

const facts = (over) => collectFacts(fakeState(over), TODAY);

describe('dates', () => {
    it('computes ISO week, month end and quarter end', () => {
        expect(isoWeek(TODAY)).toEqual({ year: 2026, week: 5 });
        const e = upcomingEnds(TODAY);
        expect(e.monthEnd).toEqual({ date: '2026-01-31', daysAway: 1 });
        expect(e.quarterEnd).toEqual({ date: '2026-03-31', daysAway: 60 });
    });
    it('counts whole days to a maturity, negative once matured', () => {
        expect(daysUntil('2026-02-14', TODAY)).toBe(15);
        expect(daysUntil('2026-01-28', TODAY)).toBe(-2);
        expect(daysUntil(null, TODAY)).toBeNull();
    });
});

describe('action-item rules', () => {
    it('flags a CD maturing within 30 days first', () => {
        const f = facts({
            cds: [
                {
                    bank: 'Test Bank',
                    principal: 5000,
                    rate: 4,
                    maturity: '2026-02-14',
                },
            ],
            expenses: { housing: 5000 }, // low runway too, but the CD wins
        });
        const a = pickAction(f);
        expect(a.id).toBe('cd-maturing');
        expect(a.text).toContain('Test Bank');
        expect(a.text).toContain('15 days');
    });
    it('flags an already matured CD', () => {
        const a = pickAction(
            facts({
                cds: [
                    {
                        bank: 'B',
                        principal: 100,
                        rate: 1,
                        maturity: '2026-01-25',
                    },
                ],
            }),
        );
        expect(a.id).toBe('cd-maturing');
        expect(a.text).toContain('matured 5 days ago');
    });
    it('ignores a CD maturing after the window', () => {
        expect(pickAction(facts()).id).not.toBe('cd-maturing');
    });
    it('flags runway below 12 months', () => {
        // net worth 10000 / 2000 per month = 5 months
        const a = pickAction(facts({ expenses: { housing: 2000 } }));
        expect(a.id).toBe('low-runway');
        expect(a.text).toContain('5 months');
    });
    it('flags stale prices before runway', () => {
        const f = facts({
            importedPositions: [
                {
                    symbol: 'FAKE',
                    value: 1000,
                    priceUpdatedAt: '2025-01-01T00:00:00Z',
                },
            ],
            expenses: { housing: 2000 },
        });
        expect(f.freshness.stale).toBe(true);
        expect(pickAction(f).id).toBe('stale-prices');
    });
    it('flags concentration at 20% or more', () => {
        const f = facts({
            importedPositions: [
                {
                    symbol: 'BIG',
                    value: 5000,
                    priceUpdatedAt: '2026-01-29T12:00:00Z',
                },
            ],
            customAccounts: [],
            cds: [],
            expenses: { housing: 100 },
        });
        const a = pickAction(f);
        expect(a.id).toBe('concentration');
        expect(a.text).toContain('BIG');
    });
    it('flags a rate gap only when rates are supplied', () => {
        const f = facts();
        expect(pickAction(f, null).id).toBe('none');
        const cmp = compareRates(f, { hysa: 3.1, cd3: 4.1, cd6: 4.2, cd12: 5 });
        expect(cmp.cdsCouldEarnMore).toBe(true);
        expect(pickAction(f, cmp).id).toBe('rate-gap-cd');
    });
    it('says no action is needed when nothing triggers', () => {
        expect(pickAction(facts()).id).toBe('none');
    });
});

describe('market rates', () => {
    it('drops invalid values and never invents missing ones', () => {
        expect(
            sanitizeRates({ hysa: 4.5, cd3: 'x', cd6: -1, cd12: 99 }),
        ).toEqual({ hysa: 4.5 });
        expect(sanitizeRates({})).toBeNull();
        expect(sanitizeRates(null)).toBeNull();
    });
    it('returns null with no file and no env URL', async () => {
        const fetchFn = vi.fn();
        expect(await loadRates({ env: {}, fetchFn })).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });
    it('reports rates unavailable and skips the comparison', async () => {
        const fetchFn = vi.fn();
        const { text, json } = await run(['--no-model', '--date', DATE], {
            env: {},
            readStateFn: () => fakeState(),
            fetchFn,
        });
        expect(text).toContain('market rates: unavailable (provide --rates)');
        expect(json.comparison).toBeNull();
        expect(text).not.toContain('On rates');
        expect(fetchFn).not.toHaveBeenCalled();
    });
});

describe('model handling', () => {
    it('--no-model never calls the router and prints the template', async () => {
        const fetchFn = vi.fn(() => {
            throw new Error('network must not be used');
        });
        const { text, json } = await run(['--no-model', '--date', DATE], {
            env: { NINEROUTER_KEY: 'fake-test-key' },
            readStateFn: () => fakeState(),
            fetchFn,
        });
        expect(fetchFn).not.toHaveBeenCalled();
        expect(json.modelUsed).toBe(false);
        expect(text).toContain('ISO week 5');
        expect(text).toContain("This week's action:");
        expect(text).toContain('mindful of spending');
    });
    it('falls back to the template when the router fails, without leaking the key', async () => {
        const warn = vi.fn();
        const fetchFn = vi
            .fn()
            .mockRejectedValue(new Error('connect ECONNREFUSED'));
        const { text, json } = await run(['--date', DATE], {
            env: {
                NINEROUTER_KEY: 'fake-test-key',
                ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/v1',
            },
            readStateFn: () => fakeState(),
            fetchFn,
            warn,
            home: '/nonexistent',
        });
        expect(json.modelUsed).toBe(false);
        expect(text).toContain('ISO week 5');
        expect(JSON.stringify(warn.mock.calls)).not.toContain('fake-test-key');
    });
    it('uses a faithful rewrite and rejects one that invents numbers', () => {
        const allowed = 'Net worth is $10,000 with 20 months of runway';
        expect(
            numbersPreserved('You have 20 months and $10,000.', allowed),
        ).toBe(true);
        expect(numbersPreserved('You have 24 months.', allowed)).toBe(false);
    });
    it('accepts a stubbed model reply that keeps the numbers', async () => {
        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [
                    {
                        finish_reason: 'stop',
                        message: { content: 'A calm week.' },
                    },
                ],
            }),
        });
        const { text, json } = await run(['--date', DATE], {
            env: { NINEROUTER_KEY: 'fake-test-key' },
            readStateFn: () => fakeState(),
            fetchFn,
            home: '/nonexistent',
        });
        expect(json.modelUsed).toBe(true);
        expect(text).toContain('A calm week.');
    });
});
