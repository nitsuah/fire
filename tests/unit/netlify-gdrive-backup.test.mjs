import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler, {
    sealTokens,
    unsealTokens,
} from '../../netlify/functions/gdrive-backup.mjs';
import gdrive from '../../app/lib/gdrive-backup.js';

// netlify/functions/gdrive-backup.mjs on the browser-only deploy. Google's
// OAuth + Drive APIs are a stubbed global fetch; the function never stores
// anything, so every call carries a sealed token blob.
const ORIGIN = 'https://lifefire.netlify.app';
const BASE = `${ORIGIN}/api/backup/drive`;
// Test-only 64-hex-char keys, not real secrets.
const KEY_A = '66'.repeat(32);
const KEY_B = '77'.repeat(32);
const ENV = {
    GDRIVE_CLIENT_ID: 'test-client-id',
    GDRIVE_CLIENT_SECRET: 'test-client-secret',
    GDRIVE_BACKUP_FOLDER_ID: 'folder-1',
    SYNC_MASTER_KEY: KEY_A,
    GDRIVE_REDIRECT_URI: undefined,
};
const saved = {};

beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

afterEach(() => {
    for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const jsonRes = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const freshTokens = () => ({
    access_token: 'ya29.plain-access',
    refresh_token: '1//plain-refresh',
    expiry: Date.now() + 3600_000,
});

const post = (path, body) =>
    handler(
        new Request(`${BASE}${path}`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    );

const listReq = (blob) =>
    handler(
        new Request(`${BASE}/list`, {
            headers: blob ? { 'x-gdrive-tokens': blob } : {},
        }),
    );

// A stand-in Drive: stores uploaded files and serves them back.
function fakeDrive({ refresh } = {}) {
    const files = new Map();
    const calls = [];
    const fetchMock = vi.fn(async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === 'https://oauth2.googleapis.com/token') {
            const params = new URLSearchParams(init.body);
            if (params.get('grant_type') === 'refresh_token')
                return refresh
                    ? refresh()
                    : jsonRes(200, {
                          access_token: 'ya29.refreshed',
                          expires_in: 3600,
                      });
            return jsonRes(200, {
                access_token: 'ya29.plain-access',
                refresh_token: '1//plain-refresh',
                expires_in: 3600,
            });
        }
        if (url.startsWith('https://www.googleapis.com/upload/drive/v3/')) {
            // multipart/related: metadata part, then the media part.
            const parts = init.body.split('--fire_backup_boundary');
            const media = parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, '');
            const id = `file${files.size + 1}`;
            files.set(id, media);
            return jsonRes(200, { id });
        }
        const meta = url.match(/\/drive\/v3\/files\/([^?]+)\?fields=/);
        if (meta) {
            const id = decodeURIComponent(meta[1]);
            // Only files this mock uploaded exist, and they all live in the
            // one backup folder — anything else 404s, as Drive would.
            return files.has(id)
                ? jsonRes(200, { id, parents: ['folder-1'], trashed: false })
                : jsonRes(404, { error: { code: 404 } });
        }
        const download = url.match(/\/drive\/v3\/files\/([^?]+)\?alt=media$/);
        if (download) {
            const content = files.get(decodeURIComponent(download[1]));
            return content === undefined
                ? jsonRes(404, { error: { code: 404 } })
                : new Response(content, { status: 200 });
        }
        if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
            return jsonRes(200, {
                files: [...files.keys()].map((id) => ({
                    id,
                    name: `fire-backup-2026-10-14.json`,
                    size: String(files.get(id).length),
                    createdTime: '2026-10-14T12:00:00Z',
                })),
            });
        }
        return jsonRes(500, { error: `unexpected ${url}` });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { files, calls, fetchMock };
}

const SAMPLE_STATE = {
    customAccounts: [
        { type: 'Savings', name: 'PLAINTEXT-MARKER-ACCOUNT', value: 12345 },
    ],
    cds: [],
    sideGigLedger: [{ id: 'm1', amount: 42 }],
};

describe('netlify gdrive-backup function — OAuth', () => {
    it('authorize redirects to Google with the hosted callback and a Secure state cookie', async () => {
        const res = await handler(new Request(`${BASE}/authorize`));
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location'));
        expect(location.origin + location.pathname).toBe(
            'https://accounts.google.com/o/oauth2/v2/auth',
        );
        expect(location.searchParams.get('redirect_uri')).toBe(
            `${BASE}/callback`,
        );
        expect(location.searchParams.get('access_type')).toBe('offline');
        expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
        const cookie = res.headers.get('set-cookie');
        expect(cookie).toMatch(/^gdrive_oauth=/);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toMatch(/; Secure$/);
    });

    it('authorize honours GDRIVE_REDIRECT_URI when set', async () => {
        process.env.GDRIVE_REDIRECT_URI = 'https://example.test/cb';
        const res = await handler(new Request(`${BASE}/authorize`));
        expect(
            new URL(res.headers.get('location')).searchParams.get(
                'redirect_uri',
            ),
        ).toBe('https://example.test/cb');
    });

    it('callback hands the browser a sealed token blob in the fragment', async () => {
        const auth = await handler(new Request(`${BASE}/authorize`));
        const state = new URL(auth.headers.get('location')).searchParams.get(
            'state',
        );
        const cookie = auth.headers.get('set-cookie').split(';')[0];
        const { calls } = fakeDrive();
        const res = await handler(
            new Request(`${BASE}/callback?code=c0de&state=${state}`, {
                headers: { cookie },
            }),
        );
        expect(res.status).toBe(302);
        const location = res.headers.get('location');
        const match = location.match(/^\/#gdrive-connected=(.+)$/);
        expect(match).not.toBeNull();
        expect(location).not.toContain('plain-access');
        expect(location).not.toContain('plain-refresh');
        expect(unsealTokens(decodeURIComponent(match[1]))).toMatchObject({
            access_token: 'ya29.plain-access',
            refresh_token: '1//plain-refresh',
        });
        // The pending cookie is cleared, and the code exchange used the same
        // redirect URI as authorize.
        expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
        const exchange = new URLSearchParams(calls[0].init.body);
        expect(exchange.get('code')).toBe('c0de');
        expect(exchange.get('redirect_uri')).toBe(`${BASE}/callback`);
    });

    it('callback rejects a missing or mismatched state without calling Google', async () => {
        const { fetchMock } = fakeDrive();
        const res = await handler(
            new Request(`${BASE}/callback?code=c&state=abc`),
        );
        expect(res.headers.get('location')).toBe(
            '/#gdrive-error=invalid_state',
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('callback reports a denied consent and a failed exchange as fragments', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const start = async () => {
            const auth = await handler(new Request(`${BASE}/authorize`));
            return {
                state: new URL(auth.headers.get('location')).searchParams.get(
                    'state',
                ),
                cookie: auth.headers.get('set-cookie').split(';')[0],
            };
        };
        let { state, cookie } = await start();
        let res = await handler(
            new Request(`${BASE}/callback?error=access_denied&state=${state}`, {
                headers: { cookie },
            }),
        );
        expect(res.headers.get('location')).toBe(
            '/#gdrive-error=access_denied',
        );

        ({ state, cookie } = await start());
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonRes(400, { error: 'invalid_grant' })),
        );
        res = await handler(
            new Request(`${BASE}/callback?code=c&state=${state}`, {
                headers: { cookie },
            }),
        );
        expect(res.headers.get('location')).toBe(
            '/#gdrive-error=exchange_failed',
        );
    });

    it('fails closed when unconfigured', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        delete process.env.GDRIVE_CLIENT_SECRET;
        const auth = await handler(new Request(`${BASE}/authorize`));
        expect(auth.headers.get('location')).toBe(
            '/#gdrive-error=not_configured',
        );
        const res = await post('', { state: {}, tokens: 'x' });
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('not_configured');
        const status = await (
            await handler(new Request(`${BASE}/status`))
        ).json();
        expect(status).toMatchObject({
            clientConfigured: false,
            masterKeySet: true,
            hosted: true,
        });
    });
});

describe('netlify gdrive-backup function — backup, list, restore', () => {
    it('upload sends only ciphertext to Drive', async () => {
        const { files, calls } = fakeDrive();
        const res = await post('', {
            tokens: sealTokens(freshTokens()),
            state: SAMPLE_STATE,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            status: 'success',
            fileId: 'file1',
            folderId: 'folder-1',
        });
        expect(body.fileName).toMatch(/^fire-backup-\d{4}-\d{2}-\d{2}\.json$/);
        // Fresh access token: no refresh, no resealed blob.
        expect(body.tokens).toBeUndefined();

        const upload = calls.find((c) => c.url.includes('/upload/'));
        expect(upload.init.headers.Authorization).toBe(
            'Bearer ya29.plain-access',
        );
        expect(upload.init.body).not.toContain('PLAINTEXT-MARKER-ACCOUNT');
        expect(upload.init.body).not.toContain('sideGigLedger');
        const stored = JSON.parse(files.get('file1'));
        expect(stored).toEqual({
            enc: true,
            iv: expect.stringMatching(/^[0-9a-f]{24}$/),
            tag: expect.stringMatching(/^[0-9a-f]{32}$/),
            data: expect.stringMatching(/^[0-9a-f]+$/),
        });
    });

    it('upload refreshes an expired access token and returns a resealed blob', async () => {
        const { calls } = fakeDrive();
        const res = await post('', {
            tokens: sealTokens({ ...freshTokens(), expiry: Date.now() - 1 }),
            state: SAMPLE_STATE,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(unsealTokens(body.tokens)).toMatchObject({
            access_token: 'ya29.refreshed',
            refresh_token: '1//plain-refresh',
        });
        const upload = calls.find((c) => c.url.includes('/upload/'));
        expect(upload.init.headers.Authorization).toBe('Bearer ya29.refreshed');
    });

    it('upload rejects a missing state', async () => {
        fakeDrive();
        const res = await post('', { tokens: sealTokens(freshTokens()) });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/state/);
    });

    it('list returns the Drive backup files', async () => {
        const { files } = fakeDrive();
        files.set('abc_123', 'x');
        const res = await listReq(sealTokens(freshTokens()));
        expect(res.status).toBe(200);
        expect((await res.json()).files).toEqual([
            expect.objectContaining({
                id: 'abc_123',
                name: 'fire-backup-2026-10-14.json',
            }),
        ]);
    });

    it('restore decrypts back to the original payload (round trip)', async () => {
        fakeDrive();
        const tokens = sealTokens(freshTokens());
        const up = await (
            await post('', { tokens, state: SAMPLE_STATE })
        ).json();
        const listed = await (await listReq(tokens)).json();
        expect(listed.files.map((f) => f.id)).toEqual([up.fileId]);

        const res = await post('/restore', { tokens, fileId: up.fileId });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('success');
        expect(body.state).toEqual(SAMPLE_STATE);
    });

    it('restore of a backup encrypted with a different key fails cleanly with JSON', async () => {
        const { files } = fakeDrive();
        files.set(
            'fileA',
            gdrive.encryptForBackup(JSON.stringify(SAMPLE_STATE)),
        );
        process.env.SYNC_MASTER_KEY = KEY_B;
        const res = await post('/restore', {
            tokens: sealTokens(freshTokens()),
            fileId: 'fileA',
        });
        expect(res.status).toBe(422);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json();
        expect(body.code).toBe('gdrive_backup_unreadable');
        expect(body.error).toMatch(/different SYNC_MASTER_KEY/);
        expect(body.state).toBeUndefined();
    });

    it('restore of a corrupted backup fails cleanly with JSON', async () => {
        const { files } = fakeDrive();
        const good = JSON.parse(
            gdrive.encryptForBackup(JSON.stringify(SAMPLE_STATE)),
        );
        const flipped = (good.data[0] === 'a' ? 'b' : 'a') + good.data.slice(1);
        files.set('tampered', JSON.stringify({ ...good, data: flipped }));
        files.set('garbage', '<html>not a backup</html>');
        files.set('plain-array', '[1,2,3]');
        const tokens = sealTokens(freshTokens());
        for (const fileId of ['tampered', 'garbage', 'plain-array']) {
            const res = await post('/restore', { tokens, fileId });
            expect(res.status).toBe(422);
            expect(res.headers.get('content-type')).toContain(
                'application/json',
            );
            expect((await res.json()).code).toBe('gdrive_backup_unreadable');
        }
    });

    it('restore validates the file id and maps a missing Drive file to JSON', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fakeDrive();
        const tokens = sealTokens(freshTokens());
        expect((await post('/restore', { tokens })).status).toBe(400);
        expect(
            (await post('/restore', { tokens, fileId: '../etc' })).status,
        ).toBe(400);
        const res = await post('/restore', { tokens, fileId: 'missing' });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect((await res.json()).code).toBe('gdrive_api_failed');
    });

    it('restore refuses a file outside the backup folder without reading it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { files, calls } = fakeDrive();
        // A real, readable, correctly-encrypted file the token can see — but
        // in someone else's folder. Ownership, not decryption, must refuse it.
        const elsewhere = 'someone-elses-doc';
        files.set(
            elsewhere,
            gdrive.encryptForBackup(JSON.stringify(SAMPLE_STATE)),
        );
        process.env.GDRIVE_BACKUP_FOLDER_ID = 'a-different-folder';
        const res = await post('/restore', {
            tokens: sealTokens(freshTokens()),
            fileId: elsewhere,
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.code).toBe('gdrive_not_a_backup');
        expect(body.state).toBeUndefined();
        expect(calls.some((c) => c.url.includes('alt=media'))).toBe(false);
    });

    it('an unreadable or wrong-key token blob is a 401 drop-it code', async () => {
        fakeDrive();
        for (const res of [
            await listReq(undefined),
            await listReq('not-a-blob'),
            await post('/restore', { tokens: 'nope', fileId: 'f' }),
        ]) {
            expect(res.status).toBe(401);
            expect((await res.json()).code).toBe('gdrive_token_invalid');
        }
        const blob = sealTokens(freshTokens());
        process.env.SYNC_MASTER_KEY = KEY_B;
        const res = await listReq(blob);
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('gdrive_token_invalid');
    });

    it('a revoked refresh token is a 401 gdrive_revoked', async () => {
        fakeDrive({ refresh: () => jsonRes(400, { error: 'invalid_grant' }) });
        const res = await listReq(
            sealTokens({ ...freshTokens(), expiry: Date.now() - 1 }),
        );
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.code).toBe('gdrive_revoked');
        expect(body.tokens).toBeUndefined();
    });

    it('a Drive outage is JSON, with the refreshed blob still returned', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) =>
                String(url).includes('oauth2')
                    ? jsonRes(200, { access_token: 'ya29.r2', expires_in: 60 })
                    : new Response('<html>oops</html>', { status: 500 }),
            ),
        );
        const res = await listReq(
            sealTokens({ ...freshTokens(), expiry: Date.now() - 1 }),
        );
        expect(res.status).toBe(500);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json();
        expect(body.code).toBe('gdrive_api_failed');
        expect(unsealTokens(body.tokens).access_token).toBe('ya29.r2');
    });

    it("surfaces Google's reason, e.g. a disabled Drive API, instead of a generic error", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const googleMessage =
            'Google Drive API has not been used in project 123 before or it is disabled.';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonRes(403, {
                    error: {
                        code: 403,
                        message: googleMessage,
                        errors: [{ reason: 'accessNotConfigured' }],
                        status: 'PERMISSION_DENIED',
                    },
                }),
            ),
        );
        delete process.env.GDRIVE_BACKUP_FOLDER_ID;
        const res = await listReq(sealTokens(freshTokens()));
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body).toMatchObject({
            code: 'gdrive_api_failed',
            reason: 'accessNotConfigured',
        });
        expect(body.error).toBe(
            `Drive folder search failed (403): ${googleMessage}`,
        );
    });

    it('rejects wrong methods and unknown actions with JSON', async () => {
        const unknown = await handler(new Request(`${BASE}/nope`));
        expect(unknown.status).toBe(404);
        expect(unknown.headers.get('content-type')).toContain(
            'application/json',
        );
        expect((await handler(new Request(`${BASE}/__proto__`))).status).toBe(
            404,
        );
        expect((await handler(new Request(BASE))).status).toBe(405);
        expect((await post('/list', {})).status).toBe(405);
        expect((await post('/status', {})).status).toBe(405);
    });

    it('serves the rewritten function path as well as the public path', async () => {
        fakeDrive();
        const res = await handler(
            new Request(`${ORIGIN}/.netlify/functions/gdrive-backup/list`, {
                headers: { 'x-gdrive-tokens': sealTokens(freshTokens()) },
            }),
        );
        expect(res.status).toBe(200);
        const bare = await handler(
            new Request(`${ORIGIN}/.netlify/functions/gdrive-backup/`, {
                method: 'POST',
                body: JSON.stringify({
                    tokens: sealTokens(freshTokens()),
                    state: SAMPLE_STATE,
                }),
            }),
        );
        expect(bare.status).toBe(200);
    });
});
