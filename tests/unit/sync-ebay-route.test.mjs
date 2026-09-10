import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
    afterEach,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// Route-level coverage for the eBay sync toggle/status/gate added alongside
// the Settings-tab "eBay Order Sync" UI. OAuth authorize/callback/refresh
// aren't exercised here (they need a real SYNC_MASTER_KEY + session-backed
// browser redirect flow) — this focuses on the three routes the new UI
// actually calls: GET status, POST toggle, and the disabled-sync gate on
// POST sync, none of which require a stored eBay token to reach their
// interesting branch.
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-sync-ebay-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;

fs.writeFileSync(
    TEST_DB,
    JSON.stringify({
        importedPositions: [],
        customAccounts: [],
        cds: [],
        wallets: [],
        expenses: {},
        taxRate: 0,
        sideGigLedger: [],
        projectionSettings: {},
        importedFiles: [],
    }),
);

let app;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
});

afterEach(() => {
    // Reset the toggle between tests so ordering doesn't leak state.
    const db = JSON.parse(fs.readFileSync(TEST_DB, 'utf8'));
    delete db.ebaySyncEnabled;
    fs.writeFileSync(TEST_DB, JSON.stringify(db));
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

describe('GET /api/sync/ebay/status', () => {
    it('reports not connected with sync enabled by default', async () => {
        const res = await request(app).get('/api/sync/ebay/status');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
        expect(res.body.syncEnabled).toBe(true);
    });

    it('reflects a previously toggled-off sync setting', async () => {
        await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: false });
        const res = await request(app).get('/api/sync/ebay/status');
        expect(res.body.syncEnabled).toBe(false);
    });
});

describe('POST /api/sync/ebay/toggle', () => {
    it('rejects a missing enabled field', async () => {
        const res = await request(app).post('/api/sync/ebay/toggle').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/enabled/i);
    });

    it('rejects a non-boolean enabled value', async () => {
        const res = await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: 'yes' });
        expect(res.status).toBe(400);
    });

    it('persists enabled: true', async () => {
        const res = await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: true });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ enabled: true });

        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.syncEnabled).toBe(true);
    });

    it('persists enabled: false', async () => {
        const res = await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: false });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ enabled: false });

        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.syncEnabled).toBe(false);
    });
});

describe('POST /api/sync/ebay/sync', () => {
    it('is blocked with 403 while sync is disabled, before token lookup', async () => {
        await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: false });

        const res = await request(app).post('/api/sync/ebay/sync');
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/disabled/i);
    });

    it('falls through to the no-token 401 once re-enabled', async () => {
        await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: true });

        const res = await request(app).post('/api/sync/ebay/sync');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/No eBay tokens/i);
    });
});
