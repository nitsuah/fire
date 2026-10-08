import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
    afterEach,
    vi,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// Express /api/sync/etsy/* (self-hosted). Own FIRE_DATA_DIR so the token
// file and ledger writes never touch app/data; Etsy is a stubbed global
// fetch throughout.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-sync-etsy-test-'),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');
const TOKEN_FILE = path.join(TEST_DATA_DIR, 'tokens-etsy.json');
const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_AUTH_DISABLED',
    'SYNC_MASTER_KEY',
    'ETSY_CLIENT_ID',
];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
// Test-only 64-hex-char key, not a real secret.
process.env.SYNC_MASTER_KEY = '44'.repeat(32);
process.env.ETSY_CLIENT_ID = 'testkeystring';
process.env.FIRE_AUTH_DISABLED = 'true';

let app;
let readState;
let mutateState;
let saveTokens;
let loadTokens;
let etsy;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
    ({ readState, mutateState } = await import('../../app/lib/db.js'));
    ({ saveTokens, loadTokens } = await import('../../app/lib/token-store.js'));
    etsy = (await import('../../app/lib/etsy-connector.js')).default;
});

afterEach(async () => {
    await mutateState((state) => {
        state.sideGigLedger = [];
        delete state.etsySyncEnabled;
    });
    try {
        fs.unlinkSync(TOKEN_FILE);
    } catch {
        /* not every test creates one */
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
        if (PREV_ENV[k] === undefined) delete process.env[k];
        else process.env[k] = PREV_ENV[k];
    }
});

const jsonRes = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const receipt = (id) => ({
    receipt_id: id,
    status: 'Paid',
    is_paid: true,
    create_timestamp: 1777900000,
    grandtotal: { amount: 2000, divisor: 100 },
    total_tax_cost: { amount: 0, divisor: 100 },
    transactions: [{ title: `Item ${id}`, quantity: 1 }],
});

function connect(extra = {}) {
    saveTokens('etsy', {
        access_token: '1.tok',
        refresh_token: 'rt',
        expires_at: Date.now() + 3600_000,
        shop_id: '777',
        ...extra,
    });
}

describe('GET /api/sync/etsy/status', () => {
    it('reports not connected with sync enabled by default', async () => {
        const res = await request(app).get('/api/sync/etsy/status');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            connected: false,
            configured: true,
            syncEnabled: true,
        });
    });

    it('is not counted against the 30/min sync limiter', async () => {
        for (let i = 0; i < 35; i++) {
            const res = await request(app).get('/api/sync/etsy/status');
            expect(res.status).toBe(200);
        }
    });

    it('reports a stored connection and its last sync', async () => {
        connect({ lastSyncedAt: '2026-05-01T00:00:00.000Z' });
        const res = await request(app).get('/api/sync/etsy/status');
        expect(res.body).toMatchObject({
            connected: true,
            lastSync: '2026-05-01T00:00:00.000Z',
            shopId: '777',
        });
        // Tokens are never echoed back.
        expect(JSON.stringify(res.body)).not.toContain('1.tok');
    });
});

describe('OAuth', () => {
    it('authorize redirects to Etsy with a PKCE cookie', async () => {
        const res = await request(app).get('/api/sync/etsy/authorize');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(
            /^https:\/\/www\.etsy\.com\/oauth\/connect\?/,
        );
        expect(res.headers['set-cookie'][0]).toMatch(/^etsy_oauth=/);
    });

    it('callback stores the tokens encrypted and returns to the SPA', async () => {
        const auth = await request(app).get('/api/sync/etsy/authorize');
        const state = new URL(auth.headers.location).searchParams.get('state');
        const cookie = auth.headers['set-cookie'][0].split(';')[0];
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonRes(200, {
                    access_token: '99.secret-token',
                    refresh_token: 'rt',
                    expires_in: 3600,
                }),
            ),
        );
        const res = await request(app)
            .get(`/api/sync/etsy/callback?code=abc&state=${state}`)
            .set('Cookie', cookie);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/#etsy-connected=stored');
        const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
        expect(raw).not.toContain('secret-token');
        expect(loadTokens('etsy')).toMatchObject({
            access_token: '99.secret-token',
        });
    });

    it('callback with a bad state stores nothing', async () => {
        const res = await request(app).get(
            '/api/sync/etsy/callback?code=abc&state=nope',
        );
        expect(res.headers.location).toBe('/#etsy-error=invalid_state');
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);
    });
});

describe('POST /api/sync/etsy/sync', () => {
    it('requires a connection', async () => {
        const res = await request(app).post('/api/sync/etsy/sync');
        expect(res.status).toBe(401);
    });

    it('honours the toggle', async () => {
        connect();
        await request(app)
            .post('/api/sync/etsy/toggle')
            .send({ enabled: false });
        const res = await request(app).post('/api/sync/etsy/sync');
        expect(res.status).toBe(403);
        expect(
            (await request(app).post('/api/sync/etsy/toggle').send({})).status,
        ).toBe(400);
    });

    it('merges receipts into the ledger and dedupes on the next sync', async () => {
        connect();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonRes(200, { results: [receipt(1), receipt(2)] }),
            ),
        );
        const first = await request(app).post('/api/sync/etsy/sync');
        expect(first.body).toMatchObject({ fetched: 2, added: 2 });
        const second = await request(app).post('/api/sync/etsy/sync');
        expect(second.body).toMatchObject({ fetched: 2, added: 0 });
        const ids = readState().sideGigLedger.map((e) => e.id);
        expect(ids).toEqual(['etsy-1', 'etsy-2']);
        expect(loadTokens('etsy').lastSyncedAt).toBe(second.body.syncedAt);
        // The second sync only looks back a week from the first.
        const url = new URL(fetch.mock.calls[1][0]);
        expect(Number(url.searchParams.get('min_created'))).toBeGreaterThan(0);
    });

    it('drops tokens and API-synced rows (not manual ones) when revoked', async () => {
        connect({ expires_at: Date.now() - 1 });
        await mutateState((state) => {
            state.sideGigLedger = [
                { id: 'etsy-5', etsyReceiptId: '5', category: 'Etsy' },
                {
                    id: '1700000000000',
                    category: 'Etsy',
                    desc: 'Etsy Sale: $5 Item',
                },
            ];
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonRes(400, { error: 'invalid_grant' })),
        );
        const res = await request(app).post('/api/sync/etsy/sync');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('etsy_revoked');
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);
        expect(readState().sideGigLedger.map((e) => e.id)).toEqual([
            '1700000000000',
        ]);
    });

    it('disconnect forgets the grant but keeps synced sales', async () => {
        connect();
        await mutateState((state) => {
            state.sideGigLedger = [{ id: 'etsy-5', etsyReceiptId: '5' }];
        });
        const res = await request(app).post('/api/sync/etsy/disconnect');
        expect(res.status).toBe(200);
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);
        expect(readState().sideGigLedger).toHaveLength(1);
        expect(etsy.isApiSyncedEtsyEntry(readState().sideGigLedger[0])).toBe(
            true,
        );
    });
});
