'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Transport-agnostic Drive helpers shared by the Express routes
// (app/routes/backup.js, tokens kept in an encrypted file under DATA_DIR) and
// the Netlify Function (netlify/functions/gdrive-backup.mjs, tokens handed to
// the browser as a SYNC_MASTER_KEY-sealed blob). The *WithToken / requestTokens
// / refreshTokens primitives never touch the file store; the un-suffixed
// wrappers below them are the Express path.

const BACKUP_FOLDER_NAME = 'fire-tracker-backups';
const GDRIVE_API = 'https://www.googleapis.com';
const GDRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GDRIVE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GDRIVE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

function tokenFilePath() {
    // Lazy: the hosted function has no data dir and never loads db.js.
    return path.join(require('./db').DATA_DIR, 'tokens-gdrive.json');
}

function isOAuthConfigured() {
    return Boolean(
        process.env.GDRIVE_CLIENT_ID &&
        process.env.GDRIVE_CLIENT_SECRET &&
        fs.existsSync(tokenFilePath()),
    );
}

function isConfigured() {
    return isOAuthConfigured();
}

// ─── Token storage (encrypted with SYNC_MASTER_KEY when available) ────────────

function encryptToken(json) {
    const masterKey = process.env.SYNC_MASTER_KEY;
    if (!masterKey || !/^[0-9a-fA-F]{64}$/.test(masterKey)) {
        throw new Error(
            'SYNC_MASTER_KEY must be set (64 hex chars) to store Drive tokens securely.',
        );
    }
    const key = Buffer.from(masterKey, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(json, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
        enc: true,
        iv: iv.toString('hex'),
        tag,
        data: enc,
    });
}

function decryptToken(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return raw;
    }
    if (!parsed.enc) return raw;
    const masterKey = process.env.SYNC_MASTER_KEY;
    if (!masterKey || !/^[0-9a-fA-F]{64}$/.test(masterKey))
        throw new Error(
            'SYNC_MASTER_KEY required (64 hex chars) to read stored Drive token',
        );
    const key = Buffer.from(masterKey, 'hex');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parsed.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    let dec = decipher.update(parsed.data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

function saveTokens(tokens) {
    const json = JSON.stringify(tokens);
    const stored = encryptToken(json);
    const finalPath = tokenFilePath();
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, stored, { mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, finalPath);
}

function loadTokens() {
    let raw;
    try {
        raw = fs.readFileSync(tokenFilePath(), 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw Object.assign(
                new Error(
                    'Google Drive not authorized. Visit /api/backup/drive/authorize to connect.',
                ),
                { status: 503 },
            );
        }
        throw e;
    }
    return JSON.parse(decryptToken(raw));
}

// ─── OAuth2 URL + callback ────────────────────────────────────────────────────

function getRedirectUri() {
    return (
        process.env.GDRIVE_REDIRECT_URI ||
        `http://localhost:${process.env.PORT || 3001}/api/backup/drive/callback`
    );
}

function generateAuthUrl(state, redirectUri = getRedirectUri()) {
    const params = new URLSearchParams({
        client_id: process.env.GDRIVE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
    });
    return `${GDRIVE_AUTH_ENDPOINT}?${params}`;
}

// Exchanges an authorization code for {access_token, refresh_token, expiry}
// without storing anything.
async function requestTokens(code, redirectUri = getRedirectUri()) {
    const res = await fetch(GDRIVE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: process.env.GDRIVE_CLIENT_ID,
            client_secret: process.env.GDRIVE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }).toString(),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const tokens = await res.json();
    if (!tokens.refresh_token) {
        throw new Error(
            'Google did not return a refresh token. Ensure the app was authorized with access_type=offline and prompt=consent.',
        );
    }
    return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: Date.now() + (tokens.expires_in || 3600) * 1000,
    };
}

async function exchangeCodeForTokens(code) {
    const tokens = await requestTokens(code);
    saveTokens(tokens);
    return tokens;
}

function isAccessTokenFresh(tokens) {
    return Boolean(
        tokens.access_token &&
        tokens.expiry &&
        tokens.expiry > Date.now() + 60_000,
    );
}

// Returns {tokens, changed}: the stored grant as-is while its access token
// is fresh, otherwise refreshed. A dead refresh token throws
// {status: 401, code: 'gdrive_revoked'}.
async function refreshTokens(stored) {
    if (isAccessTokenFresh(stored)) return { tokens: stored, changed: false };
    const res = await fetch(GDRIVE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GDRIVE_CLIENT_ID,
            client_secret: process.env.GDRIVE_CLIENT_SECRET,
            refresh_token: stored.refresh_token,
            grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        if (res.status === 400 || res.status === 401) {
            throw Object.assign(
                new Error(
                    `Drive token revoked or expired. Re-authorize at /api/backup/drive/authorize`,
                ),
                { status: 401, code: 'gdrive_revoked' },
            );
        }
        throw Object.assign(
            new Error(`Token refresh failed (${res.status}): ${text}`),
            { status: res.status },
        );
    }
    const data = await res.json();
    return {
        tokens: {
            ...stored,
            access_token: data.access_token,
            expiry: Date.now() + (data.expires_in || 3600) * 1000,
        },
        changed: true,
    };
}

async function getOAuthAccessToken() {
    const stored = loadTokens();
    let result;
    try {
        result = await refreshTokens(stored);
    } catch (err) {
        if (err.code === 'gdrive_revoked') {
            try {
                fs.unlinkSync(tokenFilePath());
            } catch {
                /* already gone */
            }
        }
        throw err;
    }
    if (result.changed) saveTokens(result.tokens);
    return result.tokens.access_token;
}

// ─── Backup encryption ────────────────────────────────────────────────────────

function encryptForBackup(json) {
    const masterKey = process.env.SYNC_MASTER_KEY;
    if (!masterKey || !/^[0-9a-fA-F]{64}$/.test(masterKey)) {
        throw new Error(
            'SYNC_MASTER_KEY must be set (64 hex chars) to enable encrypted backup',
        );
    }
    const key = Buffer.from(masterKey, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(json, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
        enc: true,
        iv: iv.toString('hex'),
        tag,
        data: enc,
    });
}

function decryptBackup(raw) {
    const masterKey = process.env.SYNC_MASTER_KEY;
    if (!masterKey)
        throw new Error('SYNC_MASTER_KEY is required to decrypt a backup');
    const key = Buffer.from(masterKey, 'hex');
    const parsed = JSON.parse(raw);
    if (!parsed.enc) return raw;
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parsed.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    let dec = decipher.update(parsed.data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

// ─── Drive operations ─────────────────────────────────────────────────────────

// Builds an Error from a failed Drive response, carrying Google's own
// explanation (e.g. "Google Drive API has not been used in project … or it
// is disabled") so callers can show why, not just the status code. Google's
// error bodies hold no credentials. `driveReason` is Google's reason code.
async function driveError(res, label) {
    let message = '';
    let reason;
    try {
        const text = await res.text();
        try {
            const err = JSON.parse(text).error;
            message = typeof err === 'string' ? err : err?.message || '';
            reason = err?.errors?.[0]?.reason || err?.status;
        } catch {
            message = text;
        }
    } catch {
        /* body unreadable */
    }
    message = String(message).replace(/\s+/g, ' ').trim().slice(0, 300);
    return Object.assign(
        new Error(`${label} (${res.status})${message ? `: ${message}` : ''}`),
        { status: res.status, driveReason: reason },
    );
}

async function getOrCreateFolder(token) {
    if (process.env.GDRIVE_BACKUP_FOLDER_ID) {
        return process.env.GDRIVE_BACKUP_FOLDER_ID;
    }
    const q = encodeURIComponent(
        `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const listRes = await fetch(
        `${GDRIVE_API}/drive/v3/files?q=${q}&fields=files(id,name)`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        },
    );
    if (!listRes.ok)
        throw await driveError(listRes, 'Drive folder search failed');
    const { files } = await listRes.json();
    if (files?.length) return files[0].id;

    const createRes = await fetch(`${GDRIVE_API}/drive/v3/files`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: BACKUP_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
        }),
        signal: AbortSignal.timeout(10000),
    });
    if (!createRes.ok)
        throw await driveError(createRes, 'Drive folder creation failed');
    const folder = await createRes.json();
    return folder.id;
}

async function uploadBackupWithToken(token, dbJson) {
    const folderId = await getOrCreateFolder(token);
    const encrypted = encryptForBackup(dbJson);
    const date = new Date().toISOString().split('T')[0];
    const fileName = `fire-backup-${date}.json`;

    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const boundary = 'fire_backup_boundary';
    const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadata,
        `--${boundary}`,
        'Content-Type: application/json',
        '',
        encrypted,
        `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch(`${GDRIVE_UPLOAD_API}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw await driveError(res, 'Drive upload failed');
    const file = await res.json();
    // Round trip: fetch the stored file back and decrypt it. Success is only
    // reported when it matches what was sent, so an upload that Drive accepted
    // but stored wrong (or that this key can't decrypt) is never "saved".
    await verifyUploadedBackup(token, file.id, dbJson);
    return { fileId: file.id, fileName, folderId, verified: true };
}

async function verifyUploadedBackup(token, fileId, expectedJson) {
    let restored;
    try {
        restored = decryptBackup(await downloadBackupWithToken(token, fileId));
    } catch (err) {
        throw Object.assign(
            new Error(
                `Backup verification failed: the uploaded file could not be read back (${err.message})`,
            ),
            { status: err.status || 502, code: 'gdrive_verify_failed' },
        );
    }
    if (restored !== expectedJson) {
        throw Object.assign(
            new Error(
                'Backup verification failed: the file read back from Drive does not match the data sent.',
            ),
            { status: 502, code: 'gdrive_verify_failed' },
        );
    }
}

async function listBackupsWithToken(token) {
    const folderId = await getOrCreateFolder(token);
    const q = encodeURIComponent(
        `'${folderId}' in parents and name contains 'fire-backup-' and trashed=false`,
    );
    const res = await fetch(
        `${GDRIVE_API}/drive/v3/files?q=${q}&fields=files(id,name,size,createdTime)&orderBy=createdTime desc`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        },
    );
    if (!res.ok) throw await driveError(res, 'Drive list failed');
    const { files } = await res.json();
    return files || [];
}

// Returns the backup file as stored (ciphertext).
async function downloadBackupWithToken(token, fileId) {
    if (typeof fileId !== 'string' || !DRIVE_FILE_ID_RE.test(fileId)) {
        throw new Error('Invalid Google Drive file ID.');
    }
    const encodedFileId = encodeURIComponent(fileId);
    const res = await fetch(
        `${GDRIVE_API}/drive/v3/files/${encodedFileId}?alt=media`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
        },
    );
    if (!res.ok) throw await driveError(res, 'Drive download failed');
    return res.text();
}

async function downloadAndDecryptBackupWithToken(token, fileId) {
    return decryptBackup(await downloadBackupWithToken(token, fileId));
}

async function uploadBackup(dbJson) {
    return uploadBackupWithToken(await getOAuthAccessToken(), dbJson);
}

async function listBackups() {
    return listBackupsWithToken(await getOAuthAccessToken());
}

async function downloadAndDecryptBackup(fileId) {
    if (typeof fileId !== 'string' || !DRIVE_FILE_ID_RE.test(fileId)) {
        throw new Error('Invalid Google Drive file ID.');
    }
    return downloadAndDecryptBackupWithToken(
        await getOAuthAccessToken(),
        fileId,
    );
}

module.exports = {
    DRIVE_FILE_ID_RE,
    isConfigured,
    isOAuthConfigured,
    generateAuthUrl,
    exchangeCodeForTokens,
    uploadBackup,
    listBackups,
    downloadAndDecryptBackup,
    // Store-free primitives for the hosted function.
    requestTokens,
    refreshTokens,
    encryptForBackup,
    decryptBackup,
    uploadBackupWithToken,
    listBackupsWithToken,
    downloadBackupWithToken,
};
