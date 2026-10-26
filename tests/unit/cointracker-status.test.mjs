import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// GET /api/sync/cointracker/status — the authoritative "am I connected?"
// answer, in both runtimes. The token rides in the Authorization header, so
// these cases also pin that it never appears in the URL or the response.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-cointracker-status-'),
);
const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_AUTH_DISABLED',
    'SYNC_MASTER_KEY',
];
const PREV_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
// Test-only 64-hex-char key, not a real secret.
process.env.SYNC_MASTER_KEY = '55'.repeat(32);
process.env.FIRE_AUTH_DISABLED = 'true';

const TOKENS = {
    v: 1,
    client_id: 'ct-client',
    access_token: 'ct-access-token-do-not-leak',
    refresh_token: 'ct-refresh-token-do-not-leak',
    expires_at: Date.now() + 3600 * 1000,
    connected_at: '2026-10-01T00:00:00.000Z',
};

let app;
let ct;
let handlers;
let hosted;

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
    ct = (await import('../../app/lib/cointracker-connector.js')).default;
    handlers = (await import('../../app/lib/cointracker-handlers.js')).default;
    hosted = (await import('../../netlify/functions/cointracker.mjs')).default;
});

afterEach(() => {
    process.env.SYNC_MASTER_KEY = '55'.repeat(32);
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
        if (PREV_ENV[k] === undefined) delete process.env[k];
        else process.env[k] = PREV_ENV[k];
    }
});

const expressStatus = (token) => {
    const req = request(app).get('/api/sync/cointracker/status');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('CoinTracker status (Express)', () => {
    it('reports configured but disconnected when this browser has no token', async () => {
        const res = await expressStatus(null).expect(200);
        expect(res.body).toEqual({ configured: true, connected: false });
    });

    it('reports connected when the sealed blob unseals', async () => {
        const res = await expressStatus(ct.sealTokens(TOKENS)).expect(200);
        expect(res.body).toEqual({ configured: true, connected: true });
    });

    it('reports not configured when SYNC_MASTER_KEY is missing', async () => {
        // Seal first: without the key the connector cannot seal at all.
        const blob = ct.sealTokens(TOKENS);
        delete process.env.SYNC_MASTER_KEY;
        const res = await expressStatus(blob).expect(200);
        expect(res.body).toEqual({ configured: false, connected: false });
    });

    it('treats a blob it cannot unseal as disconnected', async () => {
        const res = await expressStatus('not-a-sealed-blob').expect(200);
        expect(res.body).toEqual({ configured: true, connected: false });
    });

    it('never echoes the token back', async () => {
        const blob = ct.sealTokens(TOKENS);
        const res = await expressStatus(blob).expect(200);
        const text = res.text + res.req.path;
        expect(text).not.toContain('ct-access-token');
        expect(text).not.toContain('ct-refresh-token');
        // And the blob itself, which the browser holds, is not repeated.
        expect(text).not.toContain(blob.slice(0, 24));
    });
});

describe('CoinTracker status (hosted function)', () => {
    const call = (token) =>
        hosted(
            new Request(
                'https://lifefire.netlify.app/api/sync/cointracker/status',
                {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                },
            ),
        );

    it('reports configured but disconnected with no token', async () => {
        const res = await call(null);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            configured: true,
            connected: false,
        });
    });

    it('reports connected for a sealed blob', async () => {
        const res = await call(ct.sealTokens(TOKENS));
        expect(await res.json()).toEqual({ configured: true, connected: true });
    });

    it('reports not configured without SYNC_MASTER_KEY', async () => {
        const blob = ct.sealTokens(TOKENS);
        delete process.env.SYNC_MASTER_KEY;
        const res = await call(blob);
        expect(await res.json()).toEqual({
            configured: false,
            connected: false,
        });
    });

    it('refuses a non-GET method', async () => {
        const res = await hosted(
            new Request(
                'https://lifefire.netlify.app/api/sync/cointracker/status',
                { method: 'POST' },
            ),
        );
        expect(res.status).toBe(405);
    });
});

describe('CoinTracker status handler', () => {
    it('is the same answer in both runtimes', async () => {
        const blob = ct.sealTokens(TOKENS);
        const viaHandler = handlers.status({ token: blob });
        const viaExpress = await expressStatus(blob).expect(200);
        expect(viaHandler).toEqual({ status: 200, body: viaExpress.body });
    });
});
