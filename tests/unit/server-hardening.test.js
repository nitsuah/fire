'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Isolated temp DB + env vars set BEFORE requiring server.js so this file's
// module instance boots with FIRE_API_KEY/FIRE_ADMIN_KEY set — exercising
// the API-key gate and admin rotate-key endpoint that app/server.test.js's
// instance (no keys set) never touches. Vitest gives each test file its own
// module registry, so this doesn't affect other test files' server.js copy.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), `fire-hardening-test-${process.pid}-`),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');

// process.env is process-global — save whatever was there before this suite
// touches it (including SYNC_MASTER_KEY, which the key-rotation test below
// mutates as a side effect of hitting the admin rotate-key endpoint) so it
// can be restored in afterAll, rather than leaking test values into any
// other suite sharing this worker process.
const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_API_KEY',
    'FIRE_ADMIN_KEY',
    'FIRE_AUTH_DISABLED',
    'SYNC_MASTER_KEY',
    'GDRIVE_CLIENT_ID',
    'GDRIVE_CLIENT_SECRET',
];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_API_KEY = 'test-api-key-12345';
process.env.FIRE_ADMIN_KEY = 'test-admin-key-67890';
delete process.env.FIRE_AUTH_DISABLED;
delete process.env.SYNC_MASTER_KEY;
delete process.env.GDRIVE_CLIENT_ID;
delete process.env.GDRIVE_CLIENT_SECRET;

const request = require('supertest');
const app = require('../../app/server');

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
        if (PREV_ENV[key] === undefined) delete process.env[key];
        else process.env[key] = PREV_ENV[key];
    }
});

describe('FIRE_API_KEY middleware', () => {
    it('rejects /api/* requests with no X-Api-Key header', async () => {
        const res = await request(app).get('/api/state');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/unauthorized/i);
    });

    it('rejects requests with the wrong X-Api-Key', async () => {
        const res = await request(app)
            .get('/api/state')
            .set('X-Api-Key', 'totally-wrong-key');
        expect(res.status).toBe(401);
    });

    it('allows requests with the correct X-Api-Key', async () => {
        const res = await request(app)
            .get('/api/state')
            .set('X-Api-Key', 'test-api-key-12345');
        expect(res.status).toBe(200);
    });

    it('exempts the Drive OAuth callback from the API key but still rejects invalid state', async () => {
        const res = await request(app).get('/api/backup/drive/callback');
        expect(res.status).toBe(403);
        expect(res.text).toMatch(/Invalid OAuth state/i);
    });

    it('bypasses the key check for the eBay Marketplace Account Deletion endpoint (eBay cannot send X-Api-Key)', async () => {
        const res = await request(app).get(
            '/api/sync/ebay/marketplace-account-deletion',
        );
        expect(res.status).not.toBe(401);
    });
});

describe('Google Drive backup API-key boundary', () => {
    const apiKey = 'test-api-key-12345';
    const protectedRoutes = [
        ['GET', '/api/backup/drive/status'],
        ['GET', '/api/backup/drive/authorize'],
        ['GET', '/api/backup/drive/list'],
        ['POST', '/api/backup/drive'],
        ['POST', '/api/backup/drive/restore'],
    ];

    for (const [method, route] of protectedRoutes) {
        it(`rejects ${method} ${route} without X-Api-Key`, async () => {
            const req = request(app)[method.toLowerCase()](route);
            if (method === 'POST') {
                req.send(
                    route.endsWith('/restore')
                        ? { fileId: 'valid-file-id' }
                        : {},
                );
            }
            const res = await req;
            expect(res.status).toBe(401);
        });
    }

    it('rejects restore with a wrong API key before route handling', async () => {
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .set('X-Api-Key', 'wrong-test-key')
            .send({ fileId: 'valid-file-id' });
        expect(res.status).toBe(401);
    });

    it('returns only redacted status flags for the valid API key', async () => {
        const res = await request(app)
            .get('/api/backup/drive/status')
            .set('X-Api-Key', apiKey);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            authorized: false,
            clientConfigured: false,
            masterKeySet: false,
        });
        expect(JSON.stringify(res.body)).not.toContain(apiKey);
    });

    it('requires Drive setup before an authenticated restore can reach provider calls', async () => {
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .set('X-Api-Key', apiKey)
            .send({ fileId: 'valid-file-id' });
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not authorized/i);
    });
});

describe('POST /api/admin/rotate-key', () => {
    const auth = (req) => req.set('X-Api-Key', 'test-api-key-12345');

    it('rejects a request with no X-Admin-Key', async () => {
        const res = await auth(request(app).post('/api/admin/rotate-key')).send(
            { newKey: 'a'.repeat(64) },
        );
        expect(res.status).toBe(401);
    });

    it('rejects a request with the wrong X-Admin-Key', async () => {
        const res = await auth(request(app).post('/api/admin/rotate-key'))
            .set('X-Admin-Key', 'not-the-admin-key')
            .send({ newKey: 'a'.repeat(64) });
        expect(res.status).toBe(401);
    });

    it('rejects a malformed newKey', async () => {
        const res = await auth(request(app).post('/api/admin/rotate-key'))
            .set('X-Admin-Key', 'test-admin-key-67890')
            .send({ newKey: 'not-64-hex-chars' });
        expect(res.status).toBe(400);
    });

    it('rejects a missing newKey', async () => {
        const res = await auth(request(app).post('/api/admin/rotate-key'))
            .set('X-Admin-Key', 'test-admin-key-67890')
            .send({});
        expect(res.status).toBe(400);
    });

    it('re-encrypts the database with a valid new key', async () => {
        const newKey = crypto.randomBytes(32).toString('hex');
        const res = await auth(request(app).post('/api/admin/rotate-key'))
            .set('X-Admin-Key', 'test-admin-key-67890')
            .send({ newKey });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('success');
    });
});

describe('Security headers', () => {
    it('sets CSP and related headers on every response', async () => {
        const res = await request(app)
            .get('/api/state')
            .set('X-Api-Key', 'test-api-key-12345');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['content-security-policy']).toMatch(
            /default-src 'self'/,
        );
    });
});
