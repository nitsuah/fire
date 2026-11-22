'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), `fire-health-test-${process.pid}-`),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');

const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_API_KEY',
    'FIRE_ADMIN_KEY',
    'FIRE_AUTH_DISABLED',
    'EBAY_CLIENT_ID',
    'ETSY_CLIENT_ID',
    'PLAID_CLIENT_ID',
    'GDRIVE_CLIENT_ID',
];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_API_KEY = 'test-api-key-12345';
process.env.FIRE_ADMIN_KEY = 'test-admin-key-67890';
delete process.env.FIRE_AUTH_DISABLED;

const request = require('supertest');

const app = require('../../app/server');

const INTEGRATION_KEYS = [
    'EBAY_CLIENT_ID',
    'ETSY_CLIENT_ID',
    'PLAID_CLIENT_ID',
    'GDRIVE_CLIENT_ID',
];

// Each test starts with no integrations configured.
beforeEach(() => {
    for (const k of INTEGRATION_KEYS) delete process.env[k];
});

const ALL_FALSE = { drive: false, ebay: false, etsy: false, plaid: false };

afterAll(() => {
    for (const k of ENV_KEYS) {
        if (PREV_ENV[k] === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = PREV_ENV[k];
        }
    }
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('GET /api/health (Express)', () => {
    it('returns 200 without X-Api-Key', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
    });

    it('returns status ok and every integration false when none is configured', async () => {
        const res = await request(app).get('/api/health');
        expect(res.body.status).toBe('ok');
        expect(Object.keys(res.body.configured).sort()).toEqual([
            'drive',
            'ebay',
            'etsy',
            'plaid',
        ]);
        expect(res.body.configured).toEqual(ALL_FALSE);
    });

    it('reflects EBAY_CLIENT_ID when set', async () => {
        process.env.EBAY_CLIENT_ID = 'secret-ebay-id-xyz';
        const res = await request(app).get('/api/health');
        expect(res.body.configured.ebay).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain('secret-ebay-id-xyz');
    });

    it('other /api/* routes still require API key', async () => {
        const res = await request(app).get('/api/state');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/health (hosted fire-api)', () => {
    let handler;

    beforeAll(async () => {
        const mod = await import('../../netlify/functions/fire-api.mjs');
        handler = mod.default;
    });

    it('returns 200 with every integration false when none is configured', async () => {
        const res = await handler(new Request('https://x.test/api/health'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(Object.keys(body.configured).sort()).toEqual([
            'drive',
            'ebay',
            'etsy',
            'plaid',
        ]);
        expect(body.configured).toEqual(ALL_FALSE);
    });

    it('reflects env when set and never leaks the value', async () => {
        process.env.EBAY_CLIENT_ID = 'secret-ebay-id-xyz';
        const res = await handler(new Request('https://x.test/api/health'));
        const text = await res.text();
        const body = JSON.parse(text);
        expect(body.configured.ebay).toBe(true);
        expect(text).not.toContain('secret-ebay-id-xyz');
    });
});
