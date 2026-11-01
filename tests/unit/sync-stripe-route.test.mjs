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

beforeAll(async () => {
    ({ getTokenFile, loadTokens } = await import('../../app/lib/token-store.js'));
    app = (await import('../../app/server.js')).default;
});

beforeEach(() => {
    process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;
});

afterEach(() => {
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
        expect(JSON.stringify(res.body)).not.toContain(CREDENTIALS.restrictedKey);
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
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        expect(JSON.stringify(res.body)).not.toContain(CREDENTIALS.restrictedKey);
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
        expect(JSON.stringify(res.body)).not.toContain(CREDENTIALS.restrictedKey);
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
        });
        expect(fs.existsSync(getTokenFile('stripe'))).toBe(false);

        res = await request(app).delete('/api/sync/stripe/disconnect');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
