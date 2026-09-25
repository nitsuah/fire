import {
    describe,
    it,
    expect,
    beforeAll,
    afterAll,
    afterEach,
    beforeEach,
    vi,
} from 'vitest';
import crypto from 'crypto';
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
const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_AUTH_DISABLED',
    'SYNC_MASTER_KEY',
    'EBAY_VERIFICATION_TOKEN',
    'EBAY_NOTIFICATION_ENDPOINT_URL',
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function restoreEnv() {
    for (const k of ENV_KEYS) {
        if (PREV_ENV[k] === undefined) delete process.env[k];
        else process.env[k] = PREV_ENV[k];
    }
}
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
let readState;
let mutateState;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
    ({ computeMarketplaceDeletionChallengeResponse } =
        await import('../../app/lib/ebay-connector.js'));
    // db.json is encrypted at rest under SYNC_MASTER_KEY, so go through the
    // app's own accessors rather than parsing the file.
    ({ readState, mutateState } = await import('../../app/lib/db.js'));
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
    restoreEnv();
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

// eBay signs deletion notifications with X-EBAY-SIGNATURE (base64 JSON
// {alg, kid, signature, digest}). These tests generate a throwaway ECDSA
// key pair, sign bodies with it, and stub global fetch so the connector's
// app-token + public-key lookups hit the stub instead of eBay. Each test
// uses its own kid because the route's connector instance caches keys.
const signingKeys = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
});
// eBay returns the PEM on one line; mimic that.
const EBAY_STYLE_PEM = signingKeys.publicKey
    .export({ type: 'spki', format: 'pem' })
    .replace(/\n/g, '');
let kidCounter = 0;
const nextKid = () => `test-kid-${Date.now()}-${++kidCounter}`;

function signatureHeader(rawBody, kid, overrides = {}) {
    const signature = crypto
        .sign('sha1', Buffer.from(rawBody), signingKeys.privateKey)
        .toString('base64');
    return Buffer.from(
        JSON.stringify({
            alg: 'ECDSA',
            kid,
            signature,
            digest: 'SHA1',
            ...overrides,
        }),
    ).toString('base64');
}

// knownKids: kids eBay "knows"; any other kid gets eBay's 404. keyStatus
// overrides the public-key response status (e.g. 500 = eBay is down).
function stubEbayFetch({ knownKids = [], keyStatus } = {}) {
    const fetchMock = vi.fn(async (url) => {
        const u = String(url);
        if (u.endsWith('/identity/v1/oauth2/token')) {
            return new Response(
                JSON.stringify({ access_token: 'app-token', expires_in: 7200 }),
                { status: 200 },
            );
        }
        const m = u.match(/\/commerce\/notification\/v1\/public_key\/(.+)$/);
        if (m) {
            const kid = decodeURIComponent(m[1]);
            if (keyStatus) return new Response('boom', { status: keyStatus });
            if (!knownKids.includes(kid)) {
                return new Response('{"errors":[]}', { status: 404 });
            }
            return new Response(
                JSON.stringify({
                    algorithm: 'ECDSA',
                    digest: 'SHA1',
                    key: EBAY_STYLE_PEM,
                }),
                { status: 200 },
            );
        }
        throw new Error(`Unexpected fetch in test: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const VALID_NOTIFICATION = JSON.stringify({
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
    notification: {
        notificationId: 'test-notification-id',
        data: { username: 'testuser', userId: 'abc123' },
    },
});

// /api/sync is rate-limited to 30 req/min per client IP; the app trusts
// one proxy hop, so a distinct X-Forwarded-For per request keeps this
// block from tripping the limiter (429) regardless of test ordering.
let clientIpCounter = 0;
function postDeletion(rawBody, header) {
    const req = request(app)
        .post('/api/sync/ebay/marketplace-account-deletion')
        .set('X-Forwarded-For', `203.0.113.${++clientIpCounter}`)
        .set('Content-Type', 'application/json');
    if (header) req.set('X-EBAY-SIGNATURE', header);
    return req.send(rawBody);
}

describe('POST /api/sync/ebay/marketplace-account-deletion', () => {
    beforeEach(async () => {
        process.env.EBAY_CLIENT_ID = 'test-client-id';
        process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ data: 'placeholder' }));
        await mutateState((state) => {
            state.ebaySyncEnabled = true;
        });
    });

    const syncEnabled = () => readState().ebaySyncEnabled;

    function expectUntouched() {
        expect(fs.existsSync(TOKEN_FILE)).toBe(true);
        expect(syncEnabled()).toBe(true);
    }

    it('acknowledges a validly signed notification, purges stored tokens, and disables sync', async () => {
        const kid = nextKid();
        const fetchMock = stubEbayFetch({ knownKids: [kid] });

        const res = await postDeletion(
            VALID_NOTIFICATION,
            signatureHeader(VALID_NOTIFICATION, kid),
        );
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('acknowledged');
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);
        expect(
            fetchMock.mock.calls.some(([u]) =>
                String(u).endsWith(`/public_key/${kid}`),
            ),
        ).toBe(true);
        expect(syncEnabled()).toBe(false);
    });

    it('accepts a signature over JSON.stringify(body) when the wire JSON is formatted differently', async () => {
        const kid = nextKid();
        stubEbayFetch({ knownKids: [kid] });
        const pretty = JSON.stringify(JSON.parse(VALID_NOTIFICATION), null, 2);
        const res = await postDeletion(
            pretty,
            signatureHeader(VALID_NOTIFICATION, kid),
        );
        expect(res.status).toBe(200);
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);
    });

    it('rejects a notification with no X-EBAY-SIGNATURE header', async () => {
        const fetchMock = stubEbayFetch();
        const res = await postDeletion(VALID_NOTIFICATION);
        expect(res.status).toBe(412);
        expect(fetchMock).not.toHaveBeenCalled();
        expectUntouched();
    });

    it('rejects a header that is not base64 JSON', async () => {
        stubEbayFetch();
        const res = await postDeletion(VALID_NOTIFICATION, 'not-a-signature');
        expect(res.status).toBe(412);
        expectUntouched();
    });

    it('rejects a tampered body signed for different bytes', async () => {
        const kid = nextKid();
        stubEbayFetch({ knownKids: [kid] });
        const header = signatureHeader(VALID_NOTIFICATION, kid);
        const tampered = VALID_NOTIFICATION.replace('abc123', 'victim-999');

        const res = await postDeletion(tampered, header);
        expect(res.status).toBe(412);
        expectUntouched();
    });

    it('rejects a signature whose kid eBay does not recognise', async () => {
        stubEbayFetch({ knownKids: [] });
        const res = await postDeletion(
            VALID_NOTIFICATION,
            signatureHeader(VALID_NOTIFICATION, nextKid()),
        );
        expect(res.status).toBe(412);
        expectUntouched();
    });

    it('rejects a signature made with a different key for a known kid', async () => {
        const kid = nextKid();
        stubEbayFetch({ knownKids: [kid] });
        const other = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
        });
        const forged = crypto
            .sign('sha1', Buffer.from(VALID_NOTIFICATION), other.privateKey)
            .toString('base64');
        const res = await postDeletion(
            VALID_NOTIFICATION,
            signatureHeader(VALID_NOTIFICATION, kid, { signature: forged }),
        );
        expect(res.status).toBe(412);
        expectUntouched();
    });

    it('returns 503 (so eBay retries) when the public key cannot be fetched', async () => {
        stubEbayFetch({ keyStatus: 500 });
        const res = await postDeletion(
            VALID_NOTIFICATION,
            signatureHeader(VALID_NOTIFICATION, nextKid()),
        );
        expect(res.status).toBe(503);
        expectUntouched();
    });

    it('returns 503 without eBay client credentials to look up the key', async () => {
        delete process.env.EBAY_CLIENT_ID;
        const fetchMock = stubEbayFetch();
        const res = await postDeletion(
            VALID_NOTIFICATION,
            signatureHeader(VALID_NOTIFICATION, nextKid()),
        );
        expect(res.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
        expectUntouched();
    });

    it('still rejects a validly signed but malformed notification', async () => {
        const kid = nextKid();
        stubEbayFetch({ knownKids: [kid] });
        const body = JSON.stringify({ not: 'a real eBay payload' });
        const res = await postDeletion(body, signatureHeader(body, kid));
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Malformed/i);
        expectUntouched();
    });
});
