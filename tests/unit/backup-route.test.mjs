import {
    vi,
    describe,
    it,
    expect,
    beforeAll,
    afterEach,
    afterAll,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import express from 'express';
import request from 'supertest';

// Route-level coverage for app/routes/backup.js — the guard/validation
// branches backing the new "Google Drive Backup" Settings panel. The
// authorize/callback redirect flow needs a real session + browser round
// trip with Google and is intentionally left to manual/e2e verification;
// this focuses on the config-gate and input-validation logic every request
// passes through first, which is what the new UI actually surfaces to a
// user (disabled buttons + status text) when the server isn't configured.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-backup-route-test-'),
);
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');

function writeDb() {
    fs.writeFileSync(
        process.env.FIRE_DB_FILE,
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
}
writeDb();

let app;

beforeAll(async () => {
    const backupRouter = (await import('../../app/routes/backup.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/backup', backupRouter);
});

afterEach(() => {
    writeDb();
    delete process.env.GDRIVE_CLIENT_ID;
    delete process.env.GDRIVE_CLIENT_SECRET;
    delete process.env.SYNC_MASTER_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('GET /api/backup/drive/status', () => {
    it('reports everything unconfigured on a bare server', async () => {
        const res = await request(app).get('/api/backup/drive/status');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            authorized: false,
            clientConfigured: false,
            masterKeySet: false,
        });
    });

    it('reports clientConfigured once GDRIVE_CLIENT_ID/SECRET are set', async () => {
        process.env.GDRIVE_CLIENT_ID = 'id';
        process.env.GDRIVE_CLIENT_SECRET = 'secret';
        const res = await request(app).get('/api/backup/drive/status');
        expect(res.body.clientConfigured).toBe(true);
        expect(res.body.authorized).toBe(false);
    });

    it('reports masterKeySet once SYNC_MASTER_KEY is set', async () => {
        process.env.SYNC_MASTER_KEY = 'a'.repeat(64);
        const res = await request(app).get('/api/backup/drive/status');
        expect(res.body.masterKeySet).toBe(true);
    });
});

describe('GET /api/backup/drive/authorize', () => {
    it('returns 503 when the Google OAuth client is not configured', async () => {
        const res = await request(app).get('/api/backup/drive/authorize');
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/GDRIVE_CLIENT_ID/);
    });

    it('returns 503 when SYNC_MASTER_KEY is missing even with the client configured', async () => {
        process.env.GDRIVE_CLIENT_ID = 'id';
        process.env.GDRIVE_CLIENT_SECRET = 'secret';
        const res = await request(app).get('/api/backup/drive/authorize');
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/SYNC_MASTER_KEY/);
    });
});

describe('POST /api/backup/drive (backup now)', () => {
    it('returns 503 when Google Drive is not authorized', async () => {
        const res = await request(app).post('/api/backup/drive');
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not authorized/i);
    });
});

describe('GET /api/backup/drive/list', () => {
    it('returns 503 when Google Drive is not authorized', async () => {
        const res = await request(app).get('/api/backup/drive/list');
        expect(res.status).toBe(503);
    });
});

describe('POST /api/backup/drive/restore', () => {
    it('requires a fileId', async () => {
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/fileId/);
    });

    it('rejects a fileId with path-traversal-style characters', async () => {
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .send({ fileId: '../../etc/passwd' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid Google Drive file ID/);
    });

    it('returns 503 when Google Drive is not authorized', async () => {
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .send({ fileId: 'valid-file-id-123' });
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not authorized/i);
    });
});
