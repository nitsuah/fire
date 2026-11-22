// /api and the admin key-rotation route compare keys in constant time
// (app/lib/safe-compare.js); behaviour must be unchanged: right key passes,
// wrong, partial or missing keys are 401.
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-api-key-test-'),
);
const API_KEY = 'api-key-for-tests-0123456789';
const ADMIN_KEY = 'admin-key-for-tests-0123456789';
const NAMES = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_AUTH_DISABLED',
    'FIRE_RATE_LIMIT_DISABLED',
    'FIRE_API_KEY',
    'FIRE_ADMIN_KEY',
    'SYNC_MASTER_KEY',
];
const PREVIOUS = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
delete process.env.FIRE_AUTH_DISABLED;
process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
process.env.FIRE_API_KEY = API_KEY;
process.env.FIRE_ADMIN_KEY = ADMIN_KEY;
process.env.SYNC_MASTER_KEY = '33'.repeat(32);

let app;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
});

afterAll(() => {
    for (const n of NAMES) {
        if (PREVIOUS[n] === undefined) delete process.env[n];
        else process.env[n] = PREVIOUS[n];
    }
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('/api key check', () => {
    it('accepts the configured key', async () => {
        const res = await request(app)
            .get('/api/state')
            .set('x-api-key', API_KEY);
        expect(res.status).not.toBe(401);
    });

    it.each([
        ['missing', undefined],
        ['wrong, same length', `${API_KEY.slice(0, -1)}x`],
        ['prefix', API_KEY.slice(0, 8)],
        ['extended', `${API_KEY}x`],
    ])('rejects a %s key with 401', async (_label, key) => {
        let req = request(app).get('/api/state');
        if (key !== undefined) req = req.set('x-api-key', key);
        expect((await req).status).toBe(401);
    });
});

describe('admin key check', () => {
    it.each([
        ['missing', undefined],
        ['wrong, same length', `${ADMIN_KEY.slice(0, -1)}x`],
    ])('rejects a %s admin key with 401', async (_label, key) => {
        let req = request(app)
            .post('/api/admin/rotate-key')
            .set('x-api-key', API_KEY);
        if (key !== undefined) req = req.set('x-admin-key', key);
        expect((await req).status).toBe(401);
    });
});
