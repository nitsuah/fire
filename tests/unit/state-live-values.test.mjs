import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

const TEST_DB = path.join(
    os.tmpdir(),
    `fire-live-values-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
// Drives /api/state unauthenticated (auth gate is covered elsewhere).
process.env.FIRE_AUTH_DISABLED = 'true';

const T1 = '2026-09-25T23:00:00.000Z';
const T2 = '2026-09-25T23:05:00.000Z';

const seed = () => ({
    importedPositions: [
        {
            id: 'pos-1',
            symbol: 'COIN',
            quantity: 10,
            lastPrice: 100,
            value: 1000,
            costBasis: 500,
        },
    ],
    customAccounts: [
        {
            id: 'gold-1',
            name: 'Gold',
            type: 'Metal',
            metalType: 'gold',
            value: 1,
            weightOz: 2,
        },
        { id: 'cash-1', name: 'Cash', type: 'Cash', value: 500 },
    ],
    cds: [],
    sideGigLedger: [{ id: 'sg-1', net: 1115.95 }],
});
fs.writeFileSync(TEST_DB, JSON.stringify(seed()));

const app = (await import('../../app/server.js')).default;

const patch = (body) => request(app).patch('/api/state/live-values').send(body);
const getState = async () => (await request(app).get('/api/state')).body;

beforeEach(async () => {
    await request(app).post('/api/state').send(seed());
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        // ignore
    }
});

describe('PATCH /api/state/live-values', () => {
    it('recomputes value and PnL from the stored holdings and the new quote', async () => {
        const res = await patch({
            positions: [
                {
                    id: 'pos-1',
                    lastPrice: 120,
                    priceUpdatedAt: T1,
                    value: 999999, // client-computed values are ignored
                    quantity: 999,
                },
            ],
            metals: [
                {
                    id: 'gold-1',
                    spotPricePerOz: 4000,
                    payoutPct: 0.95,
                    valueLastRefreshed: T1,
                    value: 1,
                },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(2);

        const state = await getState();
        const pos = state.importedPositions[0];
        expect(pos.lastPrice).toBe(120);
        expect(pos.quantity).toBe(10);
        expect(pos.value).toBe(1200);
        expect(pos.pnlDollar).toBe(700);
        expect(pos.pnlPercent).toBe(140);
        const gold = state.customAccounts.find((a) => a.id === 'gold-1');
        expect(gold.value).toBeCloseTo(7600, 6); // 2oz × 4000 × 95%
        expect(gold.payoutPct).toBe(0.95);
    });

    it('uses holdings edited in another tab, not the sender’s stale copy', async () => {
        // Another tab changed quantity, cost basis and weight after this
        // tab loaded; this tab only knows the new price.
        const edited = seed();
        edited.importedPositions[0].quantity = 20;
        edited.importedPositions[0].costBasis = 1000;
        edited.customAccounts[0].weightOz = 5;
        await request(app).post('/api/state').send(edited);

        await patch({
            positions: [{ id: 'pos-1', lastPrice: 120, priceUpdatedAt: T1 }],
            metals: [
                {
                    id: 'gold-1',
                    spotPricePerOz: 4000,
                    payoutPct: 0.95,
                    valueLastRefreshed: T1,
                },
            ],
        });
        const state = await getState();
        expect(state.importedPositions[0].value).toBe(2400);
        expect(state.importedPositions[0].pnlDollar).toBe(1400);
        const gold = state.customAccounts.find((a) => a.id === 'gold-1');
        expect(gold.value).toBeCloseTo(19000, 6); // 5oz × 4000 × 95%
    });

    it('ignores an older refresh that arrives after a newer one', async () => {
        await patch({
            positions: [{ id: 'pos-1', lastPrice: 130, priceUpdatedAt: T2 }],
            metals: [
                {
                    id: 'gold-1',
                    spotPricePerOz: 4100,
                    payoutPct: 0.95,
                    valueLastRefreshed: T2,
                },
            ],
        });
        const late = await patch({
            positions: [{ id: 'pos-1', lastPrice: 120, priceUpdatedAt: T1 }],
            metals: [
                {
                    id: 'gold-1',
                    spotPricePerOz: 4000,
                    payoutPct: 0.95,
                    valueLastRefreshed: T1,
                },
            ],
        });
        expect(late.body.updated).toBe(0);
        const state = await getState();
        expect(state.importedPositions[0].lastPrice).toBe(130);
        expect(state.importedPositions[0].priceUpdatedAt).toBe(T2);
        const gold = state.customAccounts.find((a) => a.id === 'gold-1');
        expect(gold.spotPricePerOz).toBe(4100);
        expect(gold.valueLastRefreshed).toBe(T2);
    });

    it('never touches anything else a stale tab might hold (e.g. the ledger)', async () => {
        await patch({
            positions: [{ id: 'pos-1', lastPrice: 110, priceUpdatedAt: T1 }],
        });
        const state = await getState();
        expect(state.sideGigLedger[0].net).toBe(1115.95);
        expect(state.customAccounts).toHaveLength(2);
    });

    it('ignores unknown ids, non-Metal accounts, bad prices and missing timestamps', async () => {
        const res = await patch({
            positions: [
                { id: 'nope', lastPrice: 1, priceUpdatedAt: T1 },
                { id: 'pos-1', lastPrice: 'lots', priceUpdatedAt: T1 },
                { id: 'pos-1', lastPrice: 150 }, // no timestamp
            ],
            metals: [
                {
                    id: 'cash-1',
                    spotPricePerOz: 4000,
                    payoutPct: 0.95,
                    valueLastRefreshed: T1,
                },
                {
                    id: 'gold-1',
                    spotPricePerOz: 4000,
                    payoutPct: 5, // not a fraction
                    valueLastRefreshed: T1,
                },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(0);
        const state = await getState();
        expect(state.importedPositions[0].value).toBe(1000);
        expect(state.customAccounts.find((a) => a.id === 'cash-1').value).toBe(
            500,
        );
    });

    it('rejects non-array payloads', async () => {
        const res = await patch({ positions: 'x' });
        expect(res.status).toBe(400);
    });
});
