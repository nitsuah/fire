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
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-hardening-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_API_KEY = 'test-api-key-12345';
process.env.FIRE_ADMIN_KEY = 'test-admin-key-67890';

const request = require('supertest');
const app = require('../../app/server');

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
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

    it('bypasses the key check for the Drive OAuth callback redirect', async () => {
        const res = await request(app).get('/api/backup/drive/callback');
        expect(res.status).not.toBe(401);
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
