import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

const TEST_DB = path.join(os.tmpdir(), `fire-hsa-test-${process.pid}.json`);
process.env.FIRE_DB_FILE = TEST_DB;
// Drives /api/accounts unauthenticated (the auth gate is covered elsewhere).
process.env.FIRE_AUTH_DISABLED = 'true';
fs.writeFileSync(TEST_DB, JSON.stringify({ customAccounts: [], cds: [] }));

const app = (await import('../../app/server.js')).default;

let handleTool;
beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        // already gone
    }
});

describe('POST /api/accounts — HSA type', () => {
    it('accepts HSA and stores it with the given value', async () => {
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'Fidelity HSA', type: 'HSA', value: 8200 });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
            name: 'Fidelity HSA',
            type: 'HSA',
            value: 8200,
        });
    });

    it('lists HSA in the valid-types error for an unknown type', async () => {
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'Nope', type: 'Pension', value: 1 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('HSA');
    });

    it('accepts HSA on update and still rejects unknown types', async () => {
        const created = await request(app)
            .post('/api/accounts')
            .send({ name: 'Old HSA', type: 'Other', value: 100 });
        const id = created.body.id;

        const ok = await request(app)
            .put(`/api/accounts/${id}`)
            .send({ type: 'HSA' });
        expect(ok.status).toBe(200);
        expect(ok.body.type).toBe('HSA');

        const bad = await request(app)
            .put(`/api/accounts/${id}`)
            .send({ type: 'Pension' });
        expect(bad.status).toBe(400);
    });
});

describe('HSA net-worth bucketing', () => {
    it('counts HSA as equities and not otherAssets in get_net_worth', () => {
        const r = handleTool('get_net_worth', {
            customAccounts: [
                { type: 'HSA', value: 5000 },
                { type: 'Metal', value: 500 },
            ],
        });
        expect(r.breakdown.equities).toBe(5000);
        expect(r.breakdown.otherAssets).toBe(500);
        expect(r.total).toBe(5500);
    });

    it('reports hsaTotal and filters by type in get_accounts', () => {
        const state = {
            customAccounts: [
                { id: '1', name: 'HSA A', type: 'HSA', value: 3000 },
                { id: '2', name: 'HSA B', type: 'HSA', value: 2000 },
                { id: '3', name: 'Brokerage', type: 'Brokerage', value: 9000 },
            ],
        };
        const all = handleTool('get_accounts', state);
        expect(all.count).toBe(3);
        expect(all.total).toBe(14000);
        expect(all.hsaTotal).toBe(5000);

        const only = handleTool('get_accounts', state, { type: 'HSA' });
        expect(only.count).toBe(2);
        expect(only.total).toBe(5000);
        expect(only.typeFilter).toBe('HSA');
        // The HSA total is whole-state even when filtered to another type.
        expect(
            handleTool('get_accounts', state, { type: 'Brokerage' }).hsaTotal,
        ).toBe(5000);
    });
});
