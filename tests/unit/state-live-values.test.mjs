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
        { id: 'gold-1', name: 'Gold', type: 'Metal', value: 1, weightOz: 1 },
        { id: 'cash-1', name: 'Cash', type: 'Cash', value: 500 },
    ],
    cds: [],
    sideGigLedger: [{ id: 'sg-1', net: 1115.95 }],
});
fs.writeFileSync(TEST_DB, JSON.stringify(seed()));

const app = (await import('../../app/server.js')).default;

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
    it('updates only price-derived fields on matching positions and metals', async () => {
        const res = await request(app)
            .patch('/api/state/live-values')
            .send({
                positions: [
                    {
                        id: 'pos-1',
                        lastPrice: 120,
                        value: 1200,
                        pnlDollar: 700,
                        pnlPercent: 140,
                        priceUpdatedAt: '2026-09-25T23:00:00.000Z',
                        quantity: 999, // not a live field — ignored
                    },
                ],
                metals: [
                    {
                        id: 'gold-1',
                        value: 3800,
                        spotPricePerOz: 4000,
                        payoutPct: 0.95,
                        valueLastRefreshed: '2026-09-25T23:00:00.000Z',
                    },
                ],
            });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(2);

        const state = (await request(app).get('/api/state')).body;
        const pos = state.importedPositions[0];
        expect(pos.value).toBe(1200);
        expect(pos.lastPrice).toBe(120);
        expect(pos.quantity).toBe(10);
        const gold = state.customAccounts.find((a) => a.id === 'gold-1');
        expect(gold.value).toBe(3800);
        expect(gold.payoutPct).toBe(0.95);
    });

    it('never touches anything else a stale tab might hold (e.g. the ledger)', async () => {
        await request(app)
            .patch('/api/state/live-values')
            .send({ positions: [{ id: 'pos-1', value: 1100 }] });
        const state = (await request(app).get('/api/state')).body;
        expect(state.sideGigLedger[0].net).toBe(1115.95);
        expect(state.customAccounts).toHaveLength(2);
    });

    it('ignores unknown ids, non-Metal accounts and non-numeric values', async () => {
        const res = await request(app)
            .patch('/api/state/live-values')
            .send({
                positions: [
                    { id: 'nope', value: 1 },
                    { id: 'pos-1', value: 'lots' },
                ],
                metals: [{ id: 'cash-1', value: 0 }],
            });
        expect(res.status).toBe(200);
        const state = (await request(app).get('/api/state')).body;
        expect(state.importedPositions[0].value).toBe(1000);
        expect(state.customAccounts.find((a) => a.id === 'cash-1').value).toBe(
            500,
        );
    });

    it('rejects non-array payloads', async () => {
        const res = await request(app)
            .patch('/api/state/live-values')
            .send({ positions: 'x' });
        expect(res.status).toBe(400);
    });
});
