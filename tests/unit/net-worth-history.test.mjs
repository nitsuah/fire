import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import {
    snapshotNetWorth,
    recordNetWorthSnapshot,
    summarizeNetWorthHistory,
    MAX_HISTORY_DAYS,
} from '../../app/lib/net-worth-history.js';

// mcp-server.mjs requires app/lib/db.js, which reads FIRE_DB_FILE at load.
process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-nw-history-test-${process.pid}.json`,
);

const baseDb = () => ({
    importedPositions: [
        { symbol: 'COIN', description: '', value: 10000 },
        { symbol: 'SPAXX**', description: 'MONEY MARKET', value: 500 },
    ],
    customAccounts: [
        { type: 'Savings', value: 2000 },
        { type: 'Metal', value: 300 },
    ],
    cds: [{ principal: 5000 }],
    realEstate: [],
    vehicles: [{ currentValue: 8000, loanBalance: 3000 }],
    sideGigLedger: [{ net: 999 }],
});

describe('snapshotNetWorth', () => {
    it('matches the dashboard aggregates and leaves side hustle income out', () => {
        const s = snapshotNetWorth(baseDb());
        expect(s).toMatchObject({
            cash: 2500,
            cds: 5000,
            equities: 10000,
            otherAssets: 300,
            realEstate: 0,
            vehicles: 5000,
            total: 22800,
        });
    });
});

describe('recordNetWorthSnapshot', () => {
    it('upserts one entry per day and keeps the history sorted', () => {
        const db = baseDb();
        recordNetWorthSnapshot(db, new Date(2026, 8, 25, 9));
        db.customAccounts[0].value = 3000;
        recordNetWorthSnapshot(db, new Date(2026, 8, 25, 18)); // same day
        recordNetWorthSnapshot(db, new Date(2026, 8, 24, 12)); // earlier day
        expect(db.netWorthHistory.map((e) => e.date)).toEqual([
            '2026-09-24',
            '2026-09-25',
        ]);
        expect(db.netWorthHistory[1].total).toBe(23800);
    });

    it('does not record for an empty database', () => {
        const db = { customAccounts: [] };
        expect(recordNetWorthSnapshot(db)).toBeNull();
        expect(db.netWorthHistory).toBeUndefined();
    });

    it('caps the history length', () => {
        const db = baseDb();
        db.netWorthHistory = Array.from(
            { length: MAX_HISTORY_DAYS },
            (_, i) => ({
                date: `1990-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`,
                total: 1,
            }),
        );
        recordNetWorthSnapshot(db, new Date(2026, 8, 25));
        expect(db.netWorthHistory).toHaveLength(MAX_HISTORY_DAYS);
        expect(db.netWorthHistory.at(-1).date).toBe('2026-09-25');
    });
});

describe('summarizeNetWorthHistory', () => {
    const history = [
        { date: '2025-09-01', total: 800 },
        { date: '2026-08-20', total: 950 },
        { date: '2026-09-18', total: 990 },
        { date: '2026-09-25', total: 1000 },
    ];
    const now = new Date(2026, 8, 25);

    it('reports changes against the latest point on or before each cutoff', () => {
        const s = summarizeNetWorthHistory(history, now);
        expect(s.latest.total).toBe(1000);
        expect(s.changes.d7).toEqual({
            from: '2026-09-18',
            delta: 10,
            pct: 1.01,
        });
        expect(s.changes.d30.from).toBe('2026-08-20');
        expect(s.changes.d365.from).toBe('2025-09-01');
        expect(s.changes.sinceStart).toEqual({
            from: '2025-09-01',
            delta: 200,
            pct: 25,
        });
    });

    it('returns null changes when there is no point that far back', () => {
        const s = summarizeNetWorthHistory(
            [{ date: '2026-09-25', total: 1000 }],
            now,
        );
        expect(s.changes.d7).toBeNull();
        expect(s.changes.sinceStart).toBeNull();
    });

    it('handles no history', () => {
        expect(summarizeNetWorthHistory(undefined).latest).toBeNull();
    });
});

describe('MCP get_net_worth_trend', () => {
    let handleTool;
    beforeAll(async () => {
        ({ handleTool } = await import('../../app/mcp-server.mjs'));
    }, 60000);

    it('reports unavailable until a snapshot exists', () => {
        expect(handleTool('get_net_worth_trend', {})).toEqual({
            points: [],
            unavailableReason: 'no_snapshots_yet',
        });
    });

    it('returns the latest value, changes and (optionally limited) points', () => {
        const state = {
            netWorthHistory: [
                { date: '2026-09-23', total: 900.4 },
                { date: '2026-09-24', total: 950 },
                { date: '2026-09-25', total: 1000 },
            ],
        };
        const r = handleTool('get_net_worth_trend', state, { days: 2 });
        expect(r.latest).toEqual({ date: '2026-09-25', total: 1000 });
        expect(r.trackingSince).toBe('2026-09-23');
        expect(r.count).toBe(3);
        expect(r.points).toEqual([
            { date: '2026-09-24', total: 950 },
            { date: '2026-09-25', total: 1000 },
        ]);
    });
});
