import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import {
    summarizeDataFreshness,
    pricesAsOf,
    quotableSymbols,
} from '../../app/lib/data-freshness.js';
import { recordNetWorthSnapshot } from '../../app/lib/net-worth-history.js';
import { collectLiveQuotes } from '../../app/lib/server-reprice.js';
import { applyLiveValues } from '../../app/lib/live-values.js';

// mcp-server.mjs requires app/lib/db.js, which reads FIRE_DB_FILE at load.
process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-data-freshness-test-${process.pid}.json`,
);

const NOW = new Date('2026-10-14T12:00:00Z');
const STALE = '2026-09-26T18:49:01.183Z';

// Shaped like the 2026-10-14 check-in's db: quoted positions priced on
// 09-26, two CUSIP 401k CITs that never get a quote, a money-market sweep.
const staleDb = () => ({
    importedPositions: [
        {
            id: 'p1',
            account: 'CB',
            symbol: 'SPAXX**',
            description: 'HELD IN MONEY MARKET',
            value: 1000,
        },
        {
            id: 'p2',
            account: 'CB',
            symbol: 'COIN',
            quantity: 10,
            costBasis: 500,
            value: 1951.1,
            priceUpdatedAt: STALE,
        },
        {
            id: 'p3',
            account: 'CB',
            symbol: 'VOO',
            quantity: 2,
            value: 1000,
            priceUpdatedAt: '2026-09-27T00:00:00Z',
        },
        {
            id: 'p4',
            account: 'NETFLIX',
            symbol: '92202V344',
            description: 'VANGUARD TARGET 2045',
            value: 50000.4,
        },
        { id: 'p5', account: 'COINBASE', symbol: '92202V476', value: 20000 },
    ],
    customAccounts: [
        {
            id: 'm1',
            type: 'Metal',
            metalType: 'Gold',
            weightOz: 2,
            value: 5000,
            valueLastRefreshed: '2026-09-26T17:50:17.059Z',
        },
        { id: 'a1', type: 'Savings', value: 2000 },
    ],
    vehicles: [
        { name: 'Corvette', currentValue: 30000 },
        {
            name: 'Malibu',
            currentValue: 8000,
            valueLastRefreshed: '2026-09-19T04:46:39.676Z',
        },
    ],
    importedFiles: [
        { date: '9/18/2026 11:00 PM', name: 'a.csv' },
        { date: '9/24/2026 02:20 AM', name: 'b.csv' },
    ],
});

describe('summarizeDataFreshness', () => {
    it('reports oldest/newest price, days stale, last import and unpriced positions', () => {
        const f = summarizeDataFreshness(staleDb(), NOW);
        expect(f.pricesAsOf).toEqual({
            oldest: '2026-09-26T17:50:17.059Z',
            newest: '2026-09-27T00:00:00.000Z',
        });
        expect(f.daysStale).toBe(17);
        expect(f.stale).toBe(true);
        expect(f.lastImport.slice(0, 10)).toBe('2026-09-24');
        expect(f.positionsWithoutPriceSource.map((p) => p.symbol)).toEqual([
            '92202V344',
            '92202V476',
        ]);
        expect(f.positionsWithoutPriceSource[0]).toMatchObject({
            account: 'NETFLIX',
            value: 50000,
            reason: 'no_ticker',
        });
        expect(f.vehicles).toEqual({
            oldestValuation: '2026-09-19T04:46:39.676Z',
            neverValued: 1,
        });
    });

    it('is not stale within the threshold and flags quotable positions never priced', () => {
        const db = {
            importedPositions: [
                {
                    symbol: 'VOO',
                    value: 1,
                    priceUpdatedAt: '2026-10-12T12:00:00Z',
                },
                { symbol: 'FXAIX', value: 2 },
            ],
        };
        const f = summarizeDataFreshness(db, NOW);
        expect(f.daysStale).toBe(2);
        expect(f.stale).toBe(false);
        expect(f.positionsWithoutPriceSource).toEqual([
            expect.objectContaining({
                symbol: 'FXAIX',
                reason: 'never_priced',
            }),
        ]);
    });

    it('handles an empty state', () => {
        const f = summarizeDataFreshness({}, NOW);
        expect(f).toMatchObject({
            pricesAsOf: { oldest: null, newest: null },
            daysStale: null,
            stale: false,
            lastImport: null,
            positionsWithoutPriceSource: [],
        });
    });
});

describe('net-worth snapshots carry pricesAsOf/stale', () => {
    it('marks a snapshot taken on stale prices', () => {
        const db = staleDb();
        const e = recordNetWorthSnapshot(db, NOW);
        expect(e.pricesAsOf).toBe('2026-09-26T17:50:17.059Z');
        expect(e.stale).toBe(true);
    });

    it('a fresh re-price clears the stale flag', () => {
        expect(
            pricesAsOf(staleDb(), new Date('2026-09-28T00:00:00Z')).stale,
        ).toBe(false);
    });
});

describe('server re-price', () => {
    it('quotes only tickers and applies them through live-values', async () => {
        // live-values rejects quote timestamps in the future, so use the
        // real clock here.
        const now = new Date();
        const db = staleDb();
        expect(quotableSymbols(db.importedPositions)).toEqual(['COIN', 'VOO']);
        const quotes = await collectLiveQuotes(db, {
            now,
            quotes: async (syms) => {
                expect(syms).toEqual(['COIN', 'VOO']);
                return { COIN: { price: 300, changePercent: 1.5 } }; // VOO missed
            },
            metalSpot: async (m) => {
                expect(m).toBe('gold');
                return { price: 2500, payoutPct: 0.95 };
            },
        });
        expect(quotes.positions).toEqual([
            {
                id: 'p2',
                lastPrice: 300,
                dayChangePercent: 1.5,
                priceUpdatedAt: now.toISOString(),
            },
        ]);
        expect(applyLiveValues(db, quotes)).toBe(2);
        const coin = db.importedPositions.find((p) => p.id === 'p2');
        expect(coin).toMatchObject({
            value: 3000,
            pnlDollar: 2500,
            priceUpdatedAt: now.toISOString(),
        });
        expect(db.customAccounts[0]).toMatchObject({
            value: 4750,
            valueLastRefreshed: now.toISOString(),
        });
        // VOO wasn't re-priced, so it's now the oldest market price.
        expect(summarizeDataFreshness(db, now).pricesAsOf.oldest).toBe(
            '2026-09-27T00:00:00.000Z',
        );
    });

    it('a failed quote fetch still yields metals and does not throw', async () => {
        const quotes = await collectLiveQuotes(staleDb(), {
            now: NOW,
            quotes: async () => {
                throw new Error('offline');
            },
            metalSpot: async () => ({ price: 2500, payoutPct: 0.95 }),
        });
        expect(quotes.positions).toEqual([]);
        expect(quotes.metals).toHaveLength(1);
    });
});

describe('MCP tools expose dataFreshness', () => {
    let handleTool, defaultState;
    beforeAll(async () => {
        ({ handleTool } = await import('../../app/mcp-server.mjs'));
        ({ defaultState } = await import('../../app/lib/db.js'));
    }, 60000);

    it.each(['get_net_worth', 'fire_status_summary', 'get_portfolio'])(
        '%s includes dataFreshness',
        (tool) => {
            const r = handleTool(tool, { ...defaultState(), ...staleDb() });
            expect(r.dataFreshness).toBeDefined();
            expect(r.dataFreshness.stale).toBe(true);
            expect(r.dataFreshness.positionsWithoutPriceSource).toHaveLength(2);
        },
    );

    it('get_portfolio returns priceUpdatedAt per position', () => {
        const r = handleTool('get_portfolio', staleDb());
        expect(
            r.positions.find((p) => p.symbol === 'COIN').priceUpdatedAt,
        ).toBe(STALE);
        expect(
            r.positions.find((p) => p.symbol === '92202V344').priceUpdatedAt,
        ).toBeNull();
    });

    it('get_net_worth_trend reports stale points and null for legacy snapshots', () => {
        const r = handleTool('get_net_worth_trend', {
            netWorthHistory: [
                { date: '2026-09-26', total: 100 },
                {
                    date: '2026-10-14',
                    total: 100,
                    pricesAsOf: STALE,
                    stale: true,
                },
            ],
        });
        expect(r.stalePoints).toBe(1);
        expect(r.points[0].stale).toBeNull();
        expect(r.points[1]).toMatchObject({ pricesAsOf: STALE, stale: true });
    });
});
