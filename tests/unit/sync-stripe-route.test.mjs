import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-sync-stripe-test-'),
);
const TEST_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
const TEST_MASTER_KEY = '22'.repeat(32);
const PREVIOUS_ENV = {
    FIRE_DATA_DIR: process.env.FIRE_DATA_DIR,
    FIRE_DB_FILE: process.env.FIRE_DB_FILE,
    FIRE_AUTH_DISABLED: process.env.FIRE_AUTH_DISABLED,
    SYNC_MASTER_KEY: process.env.SYNC_MASTER_KEY,
};

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB_FILE;
process.env.FIRE_AUTH_DISABLED = 'true';
process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;

let app;
let getTokenFile;
let loadTokens;
let saveTokens;
let readState;
let mutateState;

beforeAll(async () => {
    ({ getTokenFile, loadTokens, saveTokens } =
        await import('../../app/lib/token-store.js'));
    ({ readState, mutateState } = await import('../../app/lib/db.js'));
    app = (await import('../../app/server.js')).default;
});

beforeEach(() => {
    process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;
});

afterEach(async () => {
    await mutateState((state) => {
        state.sideGigLedger = [];
    });
    try {
        fs.unlinkSync(getTokenFile('stripe'));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    for (const [key, value] of Object.entries(PREVIOUS_ENV)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const CREDENTIALS = {
    restrictedKey: 'rk_test_fakeRestricted123',
    webhookSigningSecret: 'whsec_fakeWebhook123',
};

const stripeTransaction = (id, overrides = {}) => ({
    id,
    type: 'charge',
    currency: 'usd',
    amount: 2000,
    fee: 200,
    created: 1_700_000_000,
    description: 'Imported Stripe sale',
    ...overrides,
});

const stripeResponse = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

function connectStripe(extra = {}) {
    saveTokens('stripe', {
        restrictedKey: CREDENTIALS.restrictedKey,
        ...extra,
    });
}

describe('GET /api/sync/stripe/status', () => {
    it('reports a fresh self-hosted install without exposing credentials', async () => {
        const res = await request(app).get('/api/sync/stripe/status');

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toEqual({
            configured: true,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
            lastSyncedAt: null,
            lastSyncOutcome: null,
        });
        expect(JSON.stringify(res.body)).not.toContain('rk_test_');
        expect(JSON.stringify(res.body)).not.toContain('whsec_');
    });

    it('reports stored status booleans and the token-store timestamp only', async () => {
        await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);

        const res = await request(app).get('/api/sync/stripe/status');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            configured: true,
            connected: true,
            webhookConfigured: true,
        });
        expect(typeof res.body.lastUpdated).toBe('string');
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.restrictedKey,
        );
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.webhookSigningSecret,
        );
    });

    it('reports unconfigured when the master key is missing or invalid', async () => {
        delete process.env.SYNC_MASTER_KEY;
        let res = await request(app).get('/api/sync/stripe/status');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            configured: false,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
            lastSyncedAt: null,
            lastSyncOutcome: null,
        });

        process.env.SYNC_MASTER_KEY = 'invalid';
        res = await request(app).get('/api/sync/stripe/status');
        expect(res.body.configured).toBe(false);
        expect(res.body.connected).toBe(false);
    });
});

describe('POST /api/sync/stripe/credentials', () => {
    it('stores fake restricted credentials encrypted and returns status only', async () => {
        const fetchMock = vi.fn();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        vi.stubGlobal('fetch', fetchMock);
        const res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatchObject({
            configured: true,
            connected: true,
            webhookConfigured: true,
        });
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.restrictedKey,
        );
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.webhookSigningSecret,
        );

        const encryptedFile = fs.readFileSync(getTokenFile('stripe'), 'utf8');
        expect(fs.statSync(getTokenFile('stripe')).mode & 0o777).toBe(0o600);
        expect(encryptedFile).not.toContain(CREDENTIALS.restrictedKey);
        expect(encryptedFile).not.toContain(CREDENTIALS.webhookSigningSecret);
        expect(loadTokens('stripe')).toMatchObject({
            restrictedKey: CREDENTIALS.restrictedKey,
            webhookSigningSecret: CREDENTIALS.webhookSigningSecret,
            configuredAt: expect.any(String),
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('accepts a restricted key without a webhook secret', async () => {
        const res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send({ restrictedKey: 'rk_test_restrictedOnly123' });

        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(true);
        expect(res.body.webhookConfigured).toBe(false);
        expect(loadTokens('stripe')).toMatchObject({
            restrictedKey: 'rk_test_restrictedOnly123',
        });
        expect(loadTokens('stripe').webhookSigningSecret).toBeUndefined();
    });

    it('preserves the existing webhook secret when the next update omits it', async () => {
        await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);

        const res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send({ restrictedKey: 'rk_live_restricted456' });

        expect(res.status).toBe(200);
        expect(res.body.webhookConfigured).toBe(true);
        expect(loadTokens('stripe')).toMatchObject({
            restrictedKey: 'rk_live_restricted456',
            webhookSigningSecret: CREDENTIALS.webhookSigningSecret,
        });
    });

    it('rejects malformed keys, unknown fields, and oversized values', async () => {
        const invalidPayloads = [
            { restrictedKey: 'sk_test_not_restricted' },
            { restrictedKey: 'rk_test_' },
            { restrictedKey: 'rk_test_' + 'x'.repeat(1025) },
            {
                restrictedKey: 'rk_test_valid123',
                webhookSigningSecret: 'whsec_',
            },
            {
                restrictedKey: 'rk_test_valid123',
                webhookSigningSecret: 'whsec_' + 'x'.repeat(1025),
            },
            { restrictedKey: 'rk_test_valid123', extra: 'not allowed' },
        ];

        for (const payload of invalidPayloads) {
            const res = await request(app)
                .post('/api/sync/stripe/credentials')
                .send(payload);
            expect(res.status).toBe(400);
        }
    });

    it('returns 503 when the master key is missing or invalid', async () => {
        delete process.env.SYNC_MASTER_KEY;
        let res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);
        expect(res.status).toBe(503);

        process.env.SYNC_MASTER_KEY = 'invalid';
        res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);
        expect(res.status).toBe(503);
    });

    it('refuses to overwrite an unreadable encrypted token file', async () => {
        const file = getTokenFile('stripe');
        fs.writeFileSync(file, 'not-json');
        const original = fs.readFileSync(file, 'utf8');
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/refusing to overwrite/i);
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.restrictedKey,
        );
        expect(JSON.stringify(res.body)).not.toContain(
            CREDENTIALS.webhookSigningSecret,
        );
    });
});

describe('DELETE /api/sync/stripe/disconnect', () => {
    it('deletes only the local encrypted record and is idempotent', async () => {
        await request(app)
            .post('/api/sync/stripe/credentials')
            .send(CREDENTIALS);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        let res = await request(app).delete('/api/sync/stripe/disconnect');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toEqual({
            configured: true,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
            lastSyncedAt: null,
            lastSyncOutcome: null,
        });
        expect(fs.existsSync(getTokenFile('stripe'))).toBe(false);

        res = await request(app).delete('/api/sync/stripe/disconnect');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('POST /api/sync/stripe/sync', () => {
    it('requires a valid connected restricted key before calling Stripe', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await request(app).post('/api/sync/stripe/sync');

        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('merges by canonical id idempotently and preserves manual/Etsy rows', async () => {
        connectStripe();
        await mutateState((state) => {
            state.sideGigLedger = [
                { id: 'manual-1', category: 'Manual' },
                {
                    id: 'etsy-txn_shared',
                    platform: 'Etsy',
                    category: 'Etsy',
                },
            ];
        });
        const fetchMock = vi.fn(async () =>
            stripeResponse(200, {
                data: [stripeTransaction('txn_shared')],
                has_more: false,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const first = await request(app).post('/api/sync/stripe/sync');
        const second = await request(app).post('/api/sync/stripe/sync');

        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
            status: 'success',
            fetched: 1,
            added: 1,
            skipped: 0,
            partial: false,
        });
        expect(second.body).toMatchObject({ fetched: 1, added: 0 });
        expect(readState().sideGigLedger.map((entry) => entry.id)).toEqual([
            'manual-1',
            'etsy-txn_shared',
            'stripe-txn_shared',
        ]);
        expect(
            readState().sideGigLedger.find(
                (entry) => entry.id === 'stripe-txn_shared',
            ).platform,
        ).toBe('Stripe');
        const status = await request(app).get('/api/sync/stripe/status');
        expect(status.body.lastSyncedAt).toBe(second.body.syncedAt);
        expect(status.body.lastSyncOutcome).toMatchObject({
            ok: true,
            added: 0,
            errorCode: null,
        });
    });

    it('keeps refunds separate and reports skipped payouts without importing them', async () => {
        connectStripe();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                stripeResponse(200, {
                    data: [
                        stripeTransaction('txn_sale', {
                            amount: 2500,
                            fee: 100,
                        }),
                        stripeTransaction('txn_refund', {
                            type: 'refund',
                            amount: 500,
                            fee: 0,
                        }),
                        stripeTransaction('txn_payout', {
                            type: 'payout',
                            amount: -2000,
                            fee: 0,
                        }),
                    ],
                    has_more: false,
                }),
            ),
        );

        const res = await request(app).post('/api/sync/stripe/sync');
        const ledger = readState().sideGigLedger;

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ fetched: 2, added: 2, skipped: 1 });
        expect(ledger.map((entry) => entry.id)).toEqual([
            'stripe-txn_sale',
            'stripe-txn_refund',
        ]);
        expect(ledger[0].gross).toBe(25);
        expect(ledger[1].gross).toBe(-5);
        expect(ledger[1].stripeTxnId).toBe('txn_refund');
    });

    it('persists a partial batch and resume cursor without reporting full success', async () => {
        connectStripe();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                stripeResponse(200, {
                    data: [stripeTransaction('txn_first')],
                    has_more: true,
                }),
            )
            .mockResolvedValueOnce(
                stripeResponse(502, {
                    error: 'provider detail must not be stored',
                }),
            );
        vi.stubGlobal('fetch', fetchMock);

        const res = await request(app).post('/api/sync/stripe/sync');
        const tokens = loadTokens('stripe');

        expect(res.status).toBe(206);
        expect(res.body).toMatchObject({
            status: 'partial',
            fetched: 1,
            added: 1,
            partial: true,
            errorCode: 'provider_error',
        });
        expect(
            new URL(fetchMock.mock.calls[1][0]).searchParams.get(
                'starting_after',
            ),
        ).toBe('txn_first');
        expect(tokens.resumeFrom).toBe('txn_first');
        expect(tokens.lastSyncOutcome).toMatchObject({
            ok: false,
            partial: true,
            fetched: 1,
            added: 1,
            errorCode: 'provider_error',
        });
        expect(readState().sideGigLedger.map((entry) => entry.id)).toEqual([
            'stripe-txn_first',
        ]);
    });
});

describe('Stripe API key auth boundary', () => {
    it('requires x-api-key for the status route when auth is enabled', () => {
        const authDataDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'fire-stripe-auth-boundary-'),
        );
        const apiKey = 'fire-test-api-key';
        const serverPath = JSON.stringify(path.resolve('app/server.js'));
        const script = [
            'const app = require(' + serverPath + ');',
            "const server = app.listen(0, '127.0.0.1', async () => {",
            '  const port = server.address().port;',
            "  const url = 'http://127.0.0.1:' + port + '/api/sync/stripe/status';",
            '  try {',
            '    const unauthenticated = await fetch(url);',
            '    const unauthenticatedBody = await unauthenticated.json();',
            '    const authenticated = await fetch(url, {',
            '      headers: { "x-api-key": process.env.FIRE_API_KEY },',
            '    });',
            '    const authenticatedBody = await authenticated.json();',
            '    console.log(JSON.stringify({',
            '      unauthenticatedStatus: unauthenticated.status,',
            '      unauthenticatedBody,',
            '      authenticatedStatus: authenticated.status,',
            '      authenticatedBody,',
            '    }));',
            '  } catch (error) {',
            '    console.error(error.message);',
            '    process.exitCode = 1;',
            '  } finally {',
            '    server.closeAllConnections();',
            '    server.close();',
            '  }',
            '});',
        ].join(String.fromCharCode(10));
        const env = {
            ...process.env,
            FIRE_API_KEY: apiKey,
            FIRE_DATA_DIR: authDataDir,
            FIRE_DB_FILE: path.join(authDataDir, 'db.json'),
            SESSION_SECRET: 'fire-stripe-auth-test-session-secret',
            SYNC_MASTER_KEY: TEST_MASTER_KEY,
            NODE_ENV: 'test',
        };
        delete env.FIRE_AUTH_DISABLED;

        try {
            const result = spawnSync(process.execPath, ['-e', script], {
                env,
                encoding: 'utf8',
                timeout: 45000,
            });
            if (result.status !== 0) {
                const message =
                    result.stderr ||
                    result.error?.message ||
                    'Auth test server exited unexpectedly.';
                throw new Error(message);
            }
            const output = JSON.parse(
                result.stdout.trim().split(String.fromCharCode(10)).at(-1),
            );
            expect(output.unauthenticatedStatus).toBe(401);
            expect(output.unauthenticatedBody).toEqual({
                error: 'Unauthorized.',
            });
            expect(output.authenticatedStatus).toBe(200);
            expect(output.authenticatedBody).toMatchObject({
                configured: true,
                connected: false,
                webhookConfigured: false,
            });
            expect(JSON.stringify(output.authenticatedBody)).not.toContain(
                apiKey,
            );
        } finally {
            fs.rmSync(authDataDir, { recursive: true, force: true });
        }
    }, 60000);
});
