import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

const TEST_DB = path.join(
    os.tmpdir(),
    `fire-state-revision-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
// Drives /api/state unauthenticated (auth gate is covered elsewhere).
process.env.FIRE_AUTH_DISABLED = 'true';
fs.writeFileSync(TEST_DB, JSON.stringify({ taxRate: 10 }));

const app = (await import('../../app/server.js')).default;
const getState = async () => (await request(app).get('/api/state')).body;

beforeEach(async () => {
    // Reset contents; the revision keeps counting, which is fine — each
    // test reads the current one first.
    await request(app).post('/api/state').send({ taxRate: 10 });
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        // ignore
    }
});

describe('POST /api/state revision check', () => {
    it('accepts a save based on the current revision and bumps it', async () => {
        const { stateRevision: rev } = await getState();
        const res = await request(app)
            .post('/api/state')
            .send({ taxRate: 20, baseRevision: rev });
        expect(res.status).toBe(200);
        expect(res.body.stateRevision).toBe(rev + 1);
        const s = await getState();
        expect(s.taxRate).toBe(20);
        expect(s.stateRevision).toBe(rev + 1);
        expect(s.baseRevision).toBeUndefined();
    });

    it('refuses a stale copy instead of overwriting newer data (two tabs)', async () => {
        const { stateRevision: loadedAt } = await getState();
        // Tab A saves first.
        await request(app)
            .post('/api/state')
            .send({ taxRate: 25, baseRevision: loadedAt });
        // Tab B still holds the copy loaded at the same revision.
        const stale = await request(app)
            .post('/api/state')
            .send({ taxRate: 99, baseRevision: loadedAt });
        expect(stale.status).toBe(409);
        expect(stale.body.stateRevision).toBe(loadedAt + 1);
        expect((await getState()).taxRate).toBe(25);
    });

    it('ignores a client-supplied stateRevision and keeps saves without a base working', async () => {
        const { stateRevision: rev } = await getState();
        const res = await request(app)
            .post('/api/state')
            .send({ taxRate: 30, stateRevision: 9999 });
        expect(res.status).toBe(200);
        const s = await getState();
        expect(s.taxRate).toBe(30);
        expect(s.stateRevision).toBe(rev + 1);
    });
});
