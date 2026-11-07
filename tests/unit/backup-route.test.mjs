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

describe('POST /api/backup/drive/restore — account binding', () => {
    const drive = (storedFile, account) =>
        vi.fn(async (url, opts) => {
            const u = String(url);
            if (new URL(u).host === 'oauth2.googleapis.com')
                return {
                    ok: true,
                    json: async () => ({
                        access_token: 'at-1',
                        refresh_token: 'rt-1',
                        expires_in: 3600,
                    }),
                };
            if (new URL(u).pathname === '/drive/v3/about')
                return {
                    ok: true,
                    json: async () => ({ user: { permissionId: account } }),
                };
            if (new URL(u).searchParams.get('fields') === 'id,parents,trashed')
                return {
                    ok: true,
                    json: async () => ({
                        id: 'file-1',
                        parents: ['folder-1'],
                    }),
                };
            if (new URL(u).pathname === '/drive/v3/files/file-1')
                return { ok: true, text: async () => storedFile };
            throw new Error(`Unexpected fetch: ${u} ${opts?.method || ''}`);
        });

    async function setup(storedFile, account) {
        process.env.GDRIVE_CLIENT_ID = 'cid';
        process.env.GDRIVE_CLIENT_SECRET = 'csecret';
        process.env.GDRIVE_BACKUP_FOLDER_ID = 'folder-1';
        process.env.SYNC_MASTER_KEY = 'ab'.repeat(32);
        const gdrive = (await import('../../app/lib/gdrive-backup.js')).default;
        vi.stubGlobal('fetch', drive(storedFile, account));
        await gdrive.exchangeCodeForTokens('code');
        return gdrive;
    }
    const sealed = (gdrive, account, extra = {}) =>
        JSON.stringify({
            ...JSON.parse(
                gdrive.encryptForBackup(
                    JSON.stringify({ customAccounts: [{ name: 'X' }] }),
                    account,
                ),
            ),
            ...extra,
        });

    afterEach(() => {
        delete process.env.GDRIVE_BACKUP_FOLDER_ID;
        delete process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE;
        try {
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'tokens-gdrive.json'));
        } catch {
            /* none written */
        }
    });

    async function restore() {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const before = fs.readFileSync(process.env.FIRE_DB_FILE, 'utf8');
        const res = await request(app)
            .post('/api/backup/drive/restore')
            .send({ fileId: 'file-1' });
        const after = fs.readFileSync(process.env.FIRE_DB_FILE, 'utf8');
        return { res, unchanged: before === after };
    }

    it('restores a file sealed for the same account', async () => {
        const g = await setup('', 'acct-A');
        vi.stubGlobal('fetch', drive(sealed(g, 'acct-A'), 'acct-A'));
        const { res } = await restore();
        expect(res.status).toBe(200);
    });

    it('returns 422 and leaves state unchanged for another account', async () => {
        const g = await setup('', 'acct-B');
        vi.stubGlobal('fetch', drive(sealed(g, 'acct-A'), 'acct-B'));
        const { res, unchanged } = await restore();
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('gdrive_backup_unreadable');
        expect(res.body.error).not.toMatch(/auth|GCM|unsupported state/i);
        expect(unchanged).toBe(true);
    });

    it.each(['null', '"text"', '[1,2]', '42'])(
        'returns 422 unreadable when the decrypted payload is %s',
        async (payload) => {
            process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE = '1';
            const g = await setup('', 'acct-A');
            vi.stubGlobal(
                'fetch',
                drive(g.encryptForBackup(payload), 'acct-A'),
            );
            const { res, unchanged } = await restore();
            expect(res.status).toBe(422);
            expect(res.body.code).toBe('gdrive_backup_unreadable');
            expect(unchanged).toBe(true);
        },
    );

    it('maps coded crypto errors to unreadable instead of passing them through', async () => {
        process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE = '1';
        const g = await setup('', 'acct-A');
        const bad = JSON.stringify({
            ...JSON.parse(g.encryptForBackup('{"a":1}')),
            tag: '00',
        });
        // Node rejects a short auth tag with an ERR_* coded error.
        const crypto = await import('node:crypto');
        let nodeCode;
        try {
            crypto
                .createDecipheriv(
                    'aes-256-gcm',
                    Buffer.alloc(32),
                    Buffer.alloc(12),
                )
                .setAuthTag(Buffer.from('00', 'hex'));
        } catch (err) {
            nodeCode = err.code;
        }
        expect(nodeCode).toMatch(/^ERR_/);
        vi.stubGlobal('fetch', drive(bad, 'acct-A'));
        const { res, unchanged } = await restore();
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('gdrive_backup_unreadable');
        expect(unchanged).toBe(true);
    });

    it.each([
        ['stripped', (o) => (delete o.v, o)],
        ['altered', (o) => ((o.v = 3), o)],
        ['downgraded to 1', (o) => ((o.v = 1), o)],
    ])(
        'rejects a v2 file with v %s, with and without the legacy flag',
        async (_label, mutate) => {
            const g = await setup('', 'acct-A');
            const file = JSON.stringify(
                mutate(JSON.parse(sealed(g, 'acct-A'))),
            );
            for (const flag of [undefined, '1']) {
                if (flag) process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE = flag;
                else delete process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE;
                vi.stubGlobal('fetch', drive(file, 'acct-A'));
                const { res, unchanged } = await restore();
                expect(res.status).toBe(422);
                expect(unchanged).toBe(true);
            }
        },
    );
});

describe('POST /api/backup/drive/restore — plaintext and lookups', () => {
    it('does not need the account lookup for a permitted legacy restore', async () => {
        const g = (await import('../../app/lib/gdrive-backup.js')).default;
        process.env.GDRIVE_CLIENT_ID = 'cid';
        process.env.GDRIVE_CLIENT_SECRET = 'csecret';
        process.env.GDRIVE_BACKUP_FOLDER_ID = 'folder-1';
        process.env.SYNC_MASTER_KEY = 'ab'.repeat(32);
        process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE = '1';
        const legacy = g.encryptForBackup(
            JSON.stringify({ customAccounts: [] }),
        );
        const calls = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = new URL(String(url));
                calls.push(u.pathname);
                if (u.host === 'oauth2.googleapis.com')
                    return {
                        ok: true,
                        json: async () => ({
                            access_token: 'at-1',
                            refresh_token: 'rt-1',
                            expires_in: 3600,
                        }),
                    };
                if (u.searchParams.get('fields') === 'id,parents,trashed')
                    return {
                        ok: true,
                        json: async () => ({
                            id: 'file-1',
                            parents: ['folder-1'],
                        }),
                    };
                if (u.pathname === '/drive/v3/files/file-1')
                    return { ok: true, text: async () => legacy };
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        await g.exchangeCodeForTokens('code');
        try {
            const res = await request(app)
                .post('/api/backup/drive/restore')
                .send({ fileId: 'file-1' });
            expect(res.status).toBe(200);
            expect(calls).not.toContain('/drive/v3/about');
        } finally {
            delete process.env.FIRE_ALLOW_LEGACY_BACKUP_RESTORE;
            delete process.env.GDRIVE_BACKUP_FOLDER_ID;
            fs.rmSync(path.join(TEST_DATA_DIR, 'tokens-gdrive.json'), {
                force: true,
            });
        }
    });
});
