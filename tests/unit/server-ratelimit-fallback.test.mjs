import { describe, it, expect, vi, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// app/server.js requires the optional `express-rate-limit` dependency inside
// a try/catch and falls back to a pass-through middleware
// ((req, res, next) => next()) if it can't be loaded — so a deployment
// missing that optional dependency still boots and serves requests, just
// without rate limiting. That fallback path (app/server.js lines ~76-91)
// had zero coverage since express-rate-limit is always installed in this
// repo's own test runs. Mocking the module to throw on require() exercises
// the real fallback branch instead of just asserting it exists on paper.
vi.mock('express-rate-limit', () => {
    throw new Error('express-rate-limit not installed (simulated)');
});

const TEST_DB = path.join(
    os.tmpdir(),
    `fire-ratelimit-fallback-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_AUTH_DISABLED = 'true';
process.env.SESSION_SECRET = 'a-strong-non-placeholder-secret';

fs.writeFileSync(
    TEST_DB,
    JSON.stringify({
        importedPositions: [],
        customAccounts: [],
        cds: [],
        expenses: {},
        taxRate: 0,
        sideGigLedger: [],
        projectionSettings: {},
        importedFiles: [],
    }),
);

const { default: app } = await import('../../app/server.js');
const request = (await import('supertest')).default;

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

describe('server.js — express-rate-limit unavailable', () => {
    it('still serves /api requests via the pass-through fallback limiter', async () => {
        const res = await request(app).get('/api/state');
        expect(res.status).toBe(200);
    });
});
