import { describe, it, expect } from 'vitest';
import {
    MAX_HISTORY_DAYS,
    dayKey,
    upsertDailySnapshot,
} from '../../app/lib/daily-snapshot.js';

const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

describe('dayKey', () => {
    it('zero-pads month and day in local time', () => {
        expect(dayKey(at(2026, 3, 7))).toBe('2026-03-07');
        expect(dayKey(at(2026, 12, 25))).toBe('2026-12-25');
    });
});

describe('upsertDailySnapshot', () => {
    it('creates the list and records the point with its fields', () => {
        const state = {};
        const entry = upsertDailySnapshot(
            state,
            { total: 1000, cash: 1000 },
            at(2026, 10, 26),
        );
        expect(entry).toMatchObject({
            date: '2026-10-26',
            total: 1000,
            cash: 1000,
        });
        expect(entry.recordedAt).toBe(at(2026, 10, 26).toISOString());
        expect(state.netWorthHistory).toHaveLength(1);
    });

    it('replaces a second point from the same day instead of duplicating', () => {
        const state = {};
        upsertDailySnapshot(state, { total: 1000 }, at(2026, 10, 26));
        upsertDailySnapshot(state, { total: 1250 }, new Date(2026, 9, 26, 20));
        expect(state.netWorthHistory).toHaveLength(1);
        expect(state.netWorthHistory[0].total).toBe(1250);
    });

    it('keeps points date-sorted regardless of insertion order', () => {
        const state = {};
        upsertDailySnapshot(state, { total: 3 }, at(2026, 10, 26));
        upsertDailySnapshot(state, { total: 1 }, at(2026, 10, 20));
        upsertDailySnapshot(state, { total: 2 }, at(2026, 10, 23));
        expect(state.netWorthHistory.map((e) => e.date)).toEqual([
            '2026-10-20',
            '2026-10-23',
            '2026-10-26',
        ]);
    });

    it('drops junk entries and caps the list at MAX_HISTORY_DAYS', () => {
        const state = { netWorthHistory: [null, { date: '2026-10-19' }] };
        const start = new Date(2026, 9, 26);
        for (let i = 0; i < MAX_HISTORY_DAYS + 5; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() - i);
            upsertDailySnapshot(state, { total: i }, d);
        }
        expect(state.netWorthHistory).toHaveLength(MAX_HISTORY_DAYS);
        expect(state.netWorthHistory.every((e) => e && e.date)).toBe(true);
        expect(
            state.netWorthHistory[state.netWorthHistory.length - 1].date,
        ).toBe('2026-10-26');
    });
});
