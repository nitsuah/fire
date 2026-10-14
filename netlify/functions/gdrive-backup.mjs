// Google Drive backup routes for the browser-only deploy
// (/api/backup/drive/*, rewritten here by netlify.toml). Reuses the Drive API
// + AES-256-GCM helpers in app/lib/gdrive-backup.js. Stateless, like
// etsy.mjs: the OAuth state rides in a sealed HttpOnly cookie, the tokens go
// back to the browser sealed with SYNC_MASTER_KEY (it stores the blob but
// can't read it) and come back in each request body. There is no db.json
// here: the browser sends the state to back up, and restore hands the
// decrypted state back for the browser to apply.

import crypto from 'node:crypto';
import gdrive from '../../app/lib/gdrive-backup.js';
import { encrypt, decrypt } from '../../app/lib/crypto-utils.js';
import { json, redirect, methodNotAllowed, cookie } from '../lib/http.mjs';

const COOKIE_NAME = 'gdrive_oauth';
const COOKIE_PATH = '/api/backup/drive';
const CALLBACK_PATH = '/api/backup/drive/callback';
const PENDING_TTL_MS = 10 * 60 * 1000;
// Netlify caps a synchronous function request body at 6 MB.
const MAX_STATE_BYTES = 5 * 1024 * 1024;

const clientConfigured = () =>
    Boolean(process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET);
const masterKeySet = () =>
    /^[0-9a-f]{64}$/i.test(process.env.SYNC_MASTER_KEY || '');

function action(pathname) {
    // /api/backup/drive[/<action>] or /.netlify/functions/gdrive-backup[/<action>].
    const match = pathname.match(/\/(?:drive|gdrive-backup)(?:\/([^/]+))?\/?$/);
    return match ? match[1] || '' : null;
}

function redirectUriFor(origin) {
    return process.env.GDRIVE_REDIRECT_URI || `${origin}${CALLBACK_PATH}`;
}

function pendingCookie(value, secure, maxAge = 600) {
    return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function unsealPending(value) {
    if (!value) return null;
    try {
        const pending = JSON.parse(decrypt(decodeURIComponent(value)));
        return pending?.exp > Date.now() ? pending : null;
    } catch {
        return null;
    }
}

function statesMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (!a || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const sealTokens = (tokens) => encrypt(JSON.stringify(tokens));

export function unsealTokens(blob) {
    try {
        const tokens = JSON.parse(decrypt(String(blob)));
        if (!tokens?.refresh_token) throw new Error('no refresh token');
        return tokens;
    } catch {
        throw Object.assign(
            new Error(
                'Stored Google Drive connection is unreadable. Reconnect Google Drive.',
            ),
            { status: 401, code: 'gdrive_token_invalid' },
        );
    }
}

function notConfigured() {
    console.error(
        '[Backup] Drive not configured: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET and a 64-hex SYNC_MASTER_KEY are required.',
    );
    return json(503, {
        error: 'Google Drive backup is not configured on this deploy.',
        code: 'not_configured',
    });
}

// authorize and callback are top-level navigations, so failures go back to
// the SPA as a fragment rather than leaving the user on a bare JSON page.
function authorize(url) {
    if (!clientConfigured() || !masterKeySet()) {
        notConfigured();
        return redirect('/#gdrive-error=not_configured');
    }
    const redirectUri = redirectUriFor(url.origin);
    const state = crypto.randomBytes(16).toString('hex');
    const sealed = encodeURIComponent(
        encrypt(
            JSON.stringify({
                state,
                redirectUri,
                exp: Date.now() + PENDING_TTL_MS,
            }),
        ),
    );
    return redirect(gdrive.generateAuthUrl(state, redirectUri), {
        'Set-Cookie': pendingCookie(sealed, url.protocol === 'https:'),
    });
}

async function callback(req, url) {
    const clear = pendingCookie('', url.protocol === 'https:', 0);
    const back = (fragment) =>
        redirect(`/#${fragment}`, { 'Set-Cookie': clear });
    if (!clientConfigured() || !masterKeySet())
        return back('gdrive-error=not_configured');
    const params = url.searchParams;
    const pending = unsealPending(cookie(req, COOKIE_NAME));
    if (!pending || !statesMatch(params.get('state'), pending.state))
        return back('gdrive-error=invalid_state');
    const code = params.get('code');
    if (!code) {
        const reason = String(params.get('error') || 'access_denied').slice(
            0,
            100,
        );
        return back(`gdrive-error=${encodeURIComponent(reason)}`);
    }
    try {
        const tokens = await gdrive.requestTokens(code, pending.redirectUri);
        return back(
            `gdrive-connected=${encodeURIComponent(sealTokens(tokens))}`,
        );
    } catch (err) {
        console.error('[Backup] Drive token exchange failed:', err.message);
        return back('gdrive-error=exchange_failed');
    }
}

async function readBody(req) {
    try {
        const body = JSON.parse((await req.text()) || '{}');
        return body && typeof body === 'object' && !Array.isArray(body)
            ? body
            : {};
    } catch {
        return {};
    }
}

function errorResponse(err, fallback, extra = {}) {
    if (err.code === 'gdrive_revoked' || err.code === 'gdrive_token_invalid')
        return json(401, { error: err.message, code: err.code });
    if (err.code === 'gdrive_backup_unreadable')
        return json(422, { error: err.message, code: err.code, ...extra });
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(`[Backup] ${fallback}:`, err.message);
    return json(timedOut ? 504 : err.status >= 400 ? err.status : 502, {
        error: timedOut
            ? 'Google Drive did not respond in time. Try again shortly.'
            : `${fallback}. Try again later.`,
        code: timedOut ? 'timeout' : 'gdrive_api_failed',
        ...extra,
    });
}

// Unseals + refreshes the grant, runs `fn(accessToken)`, and adds a resealed
// blob to the response whenever the access token was refreshed, so the
// browser's copy stays current even when the Drive call itself fails.
async function withDrive(body, fallback, fn) {
    let refreshed;
    try {
        refreshed = await gdrive.refreshTokens(unsealTokens(body.tokens));
    } catch (err) {
        return errorResponse(err, fallback);
    }
    const extra = refreshed.changed
        ? { tokens: sealTokens(refreshed.tokens) }
        : {};
    try {
        return json(200, {
            ...(await fn(refreshed.tokens.access_token)),
            ...extra,
        });
    } catch (err) {
        return errorResponse(err, fallback, extra);
    }
}

async function upload(req) {
    const body = await readBody(req);
    const state = body.state;
    if (!state || typeof state !== 'object' || Array.isArray(state))
        return json(400, { error: 'state (an object) is required.' });
    const payload = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES)
        return json(413, { error: 'State is too large to back up.' });
    return withDrive(body, 'Drive upload failed', async (token) => ({
        status: 'success',
        ...(await gdrive.uploadBackupWithToken(token, payload)),
    }));
}

async function list(req) {
    // GET can't carry a body, so the blob rides in a header here.
    const body = { tokens: req.headers.get('x-gdrive-tokens') };
    return withDrive(body, 'Drive list failed', async (token) => ({
        files: await gdrive.listBackupsWithToken(token),
    }));
}

async function restore(req) {
    const body = await readBody(req);
    const { fileId } = body;
    if (!fileId) return json(400, { error: 'fileId is required.' });
    if (typeof fileId !== 'string' || !gdrive.DRIVE_FILE_ID_RE.test(fileId))
        return json(400, { error: 'Invalid Google Drive file ID.' });
    return withDrive(body, 'Drive restore failed', async (token) => ({
        status: 'success',
        state: decryptRestored(
            await gdrive.downloadBackupWithToken(token, fileId),
        ),
    }));
}

// A backup sealed with another key, or a corrupted file, fails the GCM auth
// check or JSON parsing; either way it is a named 422, not a 502.
function decryptRestored(encrypted) {
    let restored = null;
    try {
        restored = JSON.parse(gdrive.decryptBackup(encrypted));
    } catch {
        /* handled below */
    }
    if (!restored || typeof restored !== 'object' || Array.isArray(restored))
        throw Object.assign(
            new Error(
                'This backup could not be decrypted. It may be corrupted or encrypted with a different SYNC_MASTER_KEY.',
            ),
            { code: 'gdrive_backup_unreadable' },
        );
    return restored;
}

export default async function handler(req) {
    const url = new URL(req.url);
    const name = action(url.pathname);
    const method = req.method;

    if (name === 'status') {
        if (method !== 'GET') return methodNotAllowed('GET');
        // `authorized` is the browser's call here: it holds the sealed blob.
        return json(200, {
            authorized: false,
            clientConfigured: clientConfigured(),
            masterKeySet: masterKeySet(),
            hosted: true,
        });
    }
    if (name === 'authorize' || name === 'callback') {
        if (method !== 'GET') return methodNotAllowed('GET');
        return name === 'authorize' ? authorize(url) : callback(req, url);
    }

    const routes = {
        '': ['POST', upload],
        list: ['GET', list],
        restore: ['POST', restore],
    };
    const route = Object.hasOwn(routes, name) ? routes[name] : null;
    if (!route)
        return json(404, { error: 'Unknown Google Drive backup endpoint.' });
    if (method !== route[0]) return methodNotAllowed(route[0]);
    if (!clientConfigured() || !masterKeySet()) return notConfigured();
    return route[1](req);
}
