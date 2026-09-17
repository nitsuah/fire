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

// Route-level coverage for the eBay sync toggle/status/gate added alongside
// the Settings-tab "eBay Order Sync" UI, plus (per TASKS.md's own tracked
// gap) the previously-untested /ebay/authorize, /ebay/callback, and the
// Marketplace Account Deletion compliance webhook
// (GET/POST /ebay/marketplace-account-deletion — required by eBay for any
// app holding a production sell.* OAuth scope).
//
// Own isolated FIRE_DATA_DIR (mirrors tests/unit/sync-plaid-route.test.mjs)
// so tokens-ebay.json writes/purges here never touch the real app/data
// directory.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-sync-ebay-test-'),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');
const TOKEN_FILE = path.join(TEST_DATA_DIR, 'tokens-ebay.json');
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
// Test-only 64-hex-char key (not a real secret) — required for
// SYNC_MASTER_KEY-gated token storage (authorize/callback/marketplace
// deletion all touch tokens-ebay.json via app/lib/crypto-utils.js).
process.env.SYNC_MASTER_KEY = '11'.repeat(32);
process.env.EBAY_VERIFICATION_TOKEN = 'a'.repeat(40);
process.env.EBAY_NOTIFICATION_ENDPOINT_URL =
    'https://example.test/api/sync/ebay/marketplace-account-deletion';
// This suite drives routes unauthenticated -- opt out of the
// now-required-by-default auth (the gate itself is covered by
// tests/unit/server-hardening.test.js). Vitest can reuse worker processes
// across test files, so process.env mutations here can otherwise leak into
// a later-run suite; save the prior value and restore it in afterAll.
const PREV_FIRE_AUTH_DISABLED = process.env.FIRE_AUTH_DISABLED;
process.env.FIRE_AUTH_DISABLED = 'true';

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
let computeMarketplaceDeletionChallengeResponse;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
    ({ computeMarketplaceDeletionChallengeResponse } =
        await import('../../app/lib/ebay-connector.js'));
});

afterEach(() => {
    // Reset the toggle and any eBay client credentials between tests so
    // ordering doesn't leak state.
    const db = JSON.parse(fs.readFileSync(TEST_DB, 'utf8'));
    delete db.ebaySyncEnabled;
    fs.writeFileSync(TEST_DB, JSON.stringify(db));
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    try {
        fs.unlinkSync(TOKEN_FILE);
    } catch {
        /* not every test creates one */
    }
    vi.unstubAllGlobals();
});

afterAll(() => {
    try {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    if (PREV_FIRE_AUTH_DISABLED === undefined) {
        delete process.env.FIRE_AUTH_DISABLED;
    } else {
        process.env.FIRE_AUTH_DISABLED = PREV_FIRE_AUTH_DISABLED;
    }
    delete process.env.FIRE_DATA_DIR;
    delete process.env.SYNC_MASTER_KEY;
    delete process.env.EBAY_VERIFICATION_TOKEN;
    delete process.env.EBAY_NOTIFICATION_ENDPOINT_URL;
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

describe('GET /api/sync/ebay/authorize', () => {
    it('returns 503 when eBay client credentials are not configured', async () => {
        const res = await request(app).get('/api/sync/ebay/authorize');
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);
    });

    it('returns 503 when SYNC_MASTER_KEY is unset', async () => {
        process.env.EBAY_CLIENT_ID = 'test-client-id';
        process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
        const prevKey = process.env.SYNC_MASTER_KEY;
        delete process.env.SYNC_MASTER_KEY;
        try {
            const res = await request(app).get('/api/sync/ebay/authorize');
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/SYNC_MASTER_KEY/);
        } finally {
            process.env.SYNC_MASTER_KEY = prevKey;
        }
    });

    it('redirects to the eBay sandbox authorization URL with a state param and stores it in-session', async () => {
        process.env.EBAY_CLIENT_ID = 'test-client-id';
        process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
        const res = await request(app).get('/api/sync/ebay/authorize');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(
            /^https:\/\/auth\.sandbox\.ebay\.com\/oauth2\/authorize\?/,
        );
        const location = new URL(res.headers.location);
        expect(location.searchParams.get('client_id')).toBe('test-client-id');
        expect(location.searchParams.get('state')).toBeTruthy();
        expect(location.searchParams.get('redirect_uri')).toContain(
            '/api/sync/ebay/callback',
        );
    });
});

describe('GET /api/sync/ebay/callback', () => {
    it('rejects a missing/mismatched state', async () => {
        const res = await request(app)
            .get('/api/sync/ebay/callback')
            .query({ code: 'abc', state: 'not-the-real-state' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Invalid OAuth state/i);
    });

    it('rejects a missing authorization code for a valid session state', async () => {
        process.env.EBAY_CLIENT_ID = 'test-client-id';
        process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
        const agent = request.agent(app);
        const authRes = await agent.get('/api/sync/ebay/authorize');
        const state = new URL(authRes.headers.location).searchParams.get(
            'state',
        );

        const res = await agent.get('/api/sync/ebay/callback').query({ state });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Missing authorization code/i);
    });

    it('exchanges a valid code for tokens and persists them', async () => {
        process.env.EBAY_CLIENT_ID = 'test-client-id';
        process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
        const agent = request.agent(app);
        const authRes = await agent.get('/api/sync/ebay/authorize');
        const state = new URL(authRes.headers.location).searchParams.get(
            'state',
        );

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    refresh_token: 'test-refresh-token',
                    expires_in: 7200,
                }),
            }),
        );

        const res = await agent
            .get('/api/sync/ebay/callback')
            .query({ state, code: 'a-real-looking-code' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('success');
        expect(fs.existsSync(TOKEN_FILE)).toBe(true);

        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.connected).toBe(true);
    });
});

describe('GET /api/sync/ebay/marketplace-account-deletion', () => {
    it('rejects a missing challenge_code', async () => {
        const res = await request(app).get(
            '/api/sync/ebay/marketplace-account-deletion',
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/challenge_code/i);
    });

    it('returns 503 when EBAY_VERIFICATION_TOKEN is not configured', async () => {
        const prevToken = process.env.EBAY_VERIFICATION_TOKEN;
        delete process.env.EBAY_VERIFICATION_TOKEN;
        try {
            const res = await request(app)
                .get('/api/sync/ebay/marketplace-account-deletion')
                .query({ challenge_code: 'ebay-challenge-123' });
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/EBAY_VERIFICATION_TOKEN/);
        } finally {
            process.env.EBAY_VERIFICATION_TOKEN = prevToken;
        }
    });

    it('returns the correct sha256(challengeCode + verificationToken + endpoint) hash', async () => {
        const challengeCode = 'ebay-challenge-456';
        const res = await request(app)
            .get('/api/sync/ebay/marketplace-account-deletion')
            .query({ challenge_code: challengeCode });
        expect(res.status).toBe(200);
        const expected = computeMarketplaceDeletionChallengeResponse(
            challengeCode,
            process.env.EBAY_VERIFICATION_TOKEN,
            process.env.EBAY_NOTIFICATION_ENDPOINT_URL,
        );
        expect(res.body.challengeResponse).toBe(expected);
    });
});

describe('POST /api/sync/ebay/marketplace-account-deletion', () => {
    it('rejects a malformed notification', async () => {
        const res = await request(app)
            .post('/api/sync/ebay/marketplace-account-deletion')
            .send({ not: 'a real eBay payload' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Malformed/i);
    });

    it('acknowledges a well-formed notification, purges stored tokens, and disables sync', async () => {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ data: 'placeholder' }));
        await request(app)
            .post('/api/sync/ebay/toggle')
            .send({ enabled: true });

        const res = await request(app)
            .post('/api/sync/ebay/marketplace-account-deletion')
            .send({
                metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
                notification: {
                    notificationId: 'test-notification-id',
                    data: { username: 'testuser', userId: 'abc123' },
                },
            });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('acknowledged');
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);

        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.syncEnabled).toBe(false);
    });
});
