import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// Root-cause regression coverage for the wallet add/sync/lookup bug report
// ("Unexpected token '<', "<!DOCTYPE "... is not valid JSON"): any unmatched
// /api/* request used to fall through to Express's own default HTML 404
// page, which every client-side fetch() caller in this app then tried to
// parse as JSON. app/server.js now has a catch-all JSON 404 for /api/* —
// this asserts every unmatched path under it returns structured JSON, not
// wallet-specific code (the bug was systemic, not isolated to the wallet
// routes — see tests/unit/wallets-route.test.mjs for wallet CRUD coverage).
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-server-404-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
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

beforeAll(async () => {
    app = (await import('../../app/server.js')).default;
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
    if (PREV_FIRE_AUTH_DISABLED === undefined) {
        delete process.env.FIRE_AUTH_DISABLED;
    } else {
        process.env.FIRE_AUTH_DISABLED = PREV_FIRE_AUTH_DISABLED;
    }
});

describe('Unmatched /api/* routes', () => {
    it('returns JSON, not HTML, for a completely bogus /api path', async () => {
        const res = await request(app).get('/api/this-route-does-not-exist');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.error).toBeTruthy();
        // The whole point: this must never be an HTML doctype body that a
        // caller's res.json() would choke on.
        expect(res.text.trim().startsWith('<')).toBe(false);
    });

    it("returns JSON for a near-miss wallet path (nested/typo'd beyond the router's known routes)", async () => {
        const res = await request(app).get('/api/wallets/some-id/nested/bogus');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.error).toBeTruthy();
    });

    it('returns JSON for a wrong HTTP method on a known prefix', async () => {
        // No router mounts PATCH for /api/wallets.
        const res = await request(app).patch('/api/wallets/some-id');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('echoes the requested path to aid debugging', async () => {
        const res = await request(app).get('/api/sync/definitely-not-real');
        expect(res.body.path).toBe('/api/sync/definitely-not-real');
    });
});
