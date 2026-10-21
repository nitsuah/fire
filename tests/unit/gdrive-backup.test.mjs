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

// Lib-level coverage for app/lib/gdrive-backup.js, backing the new
// "Google Drive Backup" panel in Settings. Uses a scratch FIRE_DATA_DIR so
// the encrypted token file this module writes never touches the real
// data/ directory, and a fixed SYNC_MASTER_KEY so encrypt/decrypt round
// trips are deterministic.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-gdrive-backup-test-'),
);
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
process.env.SYNC_MASTER_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes
process.env.GDRIVE_CLIENT_ID = 'test-client-id';
process.env.GDRIVE_CLIENT_SECRET = 'test-client-secret';
process.env.GDRIVE_BACKUP_FOLDER_ID = 'test-folder-id';

let gdrive;

beforeAll(async () => {
    gdrive = await import('../../app/lib/gdrive-backup.js');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'tokens-gdrive.json'));
    } catch {
        /* not every test leaves a token file */
    }
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('isConfigured / isOAuthConfigured', () => {
    it('is false before any tokens are stored', () => {
        expect(gdrive.isOAuthConfigured()).toBe(false);
        expect(gdrive.isConfigured()).toBe(false);
    });
});

describe('generateAuthUrl', () => {
    it('builds a Google OAuth URL with offline access + consent + state', () => {
        const url = gdrive.generateAuthUrl('csrf-state-123');
        expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url).toContain('client_id=test-client-id');
        expect(url).toContain('access_type=offline');
        expect(url).toContain('prompt=consent');
        expect(url).toContain('state=csrf-state-123');
        expect(url).toContain(
            'scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file',
        );
    });
});

describe('exchangeCodeForTokens', () => {
    it('stores tokens and flips isOAuthConfigured to true', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'at-1',
                    refresh_token: 'rt-1',
                    expires_in: 3600,
                }),
            }),
        );
        expect(gdrive.isOAuthConfigured()).toBe(false);
        const tokens = await gdrive.exchangeCodeForTokens('auth-code');
        expect(tokens.access_token).toBe('at-1');
        expect(gdrive.isOAuthConfigured()).toBe(true);

        const raw = fs.readFileSync(
            path.join(TEST_DATA_DIR, 'tokens-gdrive.json'),
            'utf-8',
        );
        expect(raw).not.toContain('at-1');
        expect(raw).not.toContain('rt-1');
    });

    it('throws when Google does not return a refresh token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ access_token: 'at-1', expires_in: 3600 }),
            }),
        );
        await expect(gdrive.exchangeCodeForTokens('auth-code')).rejects.toThrow(
            /did not return a refresh token/i,
        );
    });

    it('throws on a non-ok token exchange response', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                text: async () => 'invalid_grant',
            }),
        );
        await expect(gdrive.exchangeCodeForTokens('bad-code')).rejects.toThrow(
            /Token exchange failed \(400\)/,
        );
    });
});

describe('uploadBackup / listBackups / downloadAndDecryptBackup', () => {
    async function connectAccount() {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'at-1',
                    refresh_token: 'rt-1',
                    expires_in: 3600,
                }),
            }),
        );
        await gdrive.exchangeCodeForTokens('auth-code');
    }

    it('uploads an encrypted snapshot and round-trips it back through download', async () => {
        await connectAccount();

        let capturedBody = null;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url, opts) => {
                const u = String(url);
                if (u.includes('/upload/drive/v3/files')) {
                    capturedBody = opts.body;
                    return { ok: true, json: async () => ({ id: 'file-123' }) };
                }
                if (u.includes('/drive/v3/files/file-123')) {
                    // Verification read-back: serve what was uploaded.
                    return {
                        ok: true,
                        text: async () =>
                            capturedBody
                                .split('\r\n')
                                .find((l) => l.startsWith('{"enc":true')),
                    };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );

        const dbJson = JSON.stringify({ hello: 'world', n: 42 });
        const result = await gdrive.uploadBackup(dbJson);
        expect(result.verified).toBe(true);
        expect(result.fileId).toBe('file-123');
        expect(result.folderId).toBe('test-folder-id');
        expect(result.fileName).toMatch(
            /^fire-backup-\d{4}-\d{2}-\d{2}\.json$/,
        );
        expect(capturedBody).toContain('"enc":true');

        // Pull the encrypted JSON payload back out of the multipart body so
        // we can feed it through the real download+decrypt path exactly as
        // Drive would return it via `alt=media`.
        const encryptedPayload = capturedBody
            .split('\r\n')
            .find((line) => line.startsWith('{"enc":true'));
        expect(encryptedPayload).toBeTruthy();

        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.includes('/drive/v3/files/file-123')) {
                    return { ok: true, text: async () => encryptedPayload };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        const decrypted = await gdrive.downloadAndDecryptBackup('file-123');
        expect(JSON.parse(decrypted)).toEqual({ hello: 'world', n: 42 });
    });

    it('fails the backup when the file read back does not match', async () => {
        await connectAccount();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.includes('/upload/drive/v3/files')) {
                    return { ok: true, json: async () => ({ id: 'file-123' }) };
                }
                if (u.includes('/drive/v3/files/file-123')) {
                    return {
                        ok: true,
                        text: async () =>
                            gdrive.encryptForBackup(JSON.stringify({ x: 1 })),
                    };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        await expect(
            gdrive.uploadBackup('{"hello":"world"}'),
        ).rejects.toMatchObject({ code: 'gdrive_verify_failed', status: 502 });
    });

    it('fails the backup when the read-back cannot be decrypted', async () => {
        await connectAccount();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.includes('/upload/drive/v3/files')) {
                    return { ok: true, json: async () => ({ id: 'file-123' }) };
                }
                if (u.includes('/drive/v3/files/file-123')) {
                    return { ok: true, text: async () => 'not-json' };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        await expect(gdrive.uploadBackup('{"a":1}')).rejects.toThrow(
            /Backup verification failed/,
        );
    });

    it('rejects a plaintext read-back and deletes the unverified file', async () => {
        await connectAccount();
        const deleted = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url, opts) => {
                const u = String(url);
                if (opts?.method === 'DELETE') {
                    deleted.push(u);
                    return { ok: true, status: 204 };
                }
                if (u.includes('/upload/drive/v3/files')) {
                    return { ok: true, json: async () => ({ id: 'file-123' }) };
                }
                if (u.includes('/drive/v3/files/file-123')) {
                    return { ok: true, text: async () => '{"a":1}' };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        await expect(gdrive.uploadBackup('{"a":1}')).rejects.toMatchObject({
            code: 'gdrive_verify_failed',
        });
        expect(deleted).toHaveLength(1);
        expect(deleted[0]).toContain('/drive/v3/files/file-123');
    });

    it('says so when the unverified file cannot be deleted', async () => {
        await connectAccount();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url, opts) => {
                const u = String(url);
                if (opts?.method === 'DELETE')
                    return { ok: false, status: 403 };
                if (u.includes('/upload/drive/v3/files')) {
                    return { ok: true, json: async () => ({ id: 'file-123' }) };
                }
                if (u.includes('/drive/v3/files/file-123')) {
                    return { ok: true, text: async () => 'not-json' };
                }
                throw new Error(`Unexpected fetch: ${u}`);
            }),
        );
        await expect(gdrive.uploadBackup('{"a":1}')).rejects.toThrow(
            /could not be removed from Drive/,
        );
    });

    it('lists backups from the configured folder', async () => {
        await connectAccount();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    files: [
                        {
                            id: 'f1',
                            name: 'fire-backup-2026-09-01.json',
                            size: '2048',
                            createdTime: '2026-09-01T00:00:00Z',
                        },
                    ],
                }),
            }),
        );
        const files = await gdrive.listBackups();
        expect(files).toHaveLength(1);
        expect(files[0].id).toBe('f1');
    });

    it('rejects a malformed Drive file id without making a network call', async () => {
        await connectAccount();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        await expect(
            gdrive.downloadAndDecryptBackup('../../etc/passwd'),
        ).rejects.toThrow(/Invalid Google Drive file ID/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
