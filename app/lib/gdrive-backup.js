'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR } = require('./db');

const BACKUP_FOLDER_NAME = 'fire-tracker-backups';
const GDRIVE_API = 'https://www.googleapis.com';
const GDRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GDRIVE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GDRIVE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

function tokenFilePath() {
    return path.join(DATA_DIR, 'tokens-gdrive.json');
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
    if (!masterKey || !/^[0-9a-fA-F]{64}$/.test(masterKey)) return json;
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
    if (!masterKey)
        throw new Error('SYNC_MASTER_KEY required to read stored Drive token');
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
    fs.writeFileSync(tokenFilePath(), stored, { mode: 0o600 });
}

function loadTokens() {
    const raw = fs.readFileSync(tokenFilePath(), 'utf8');
    return JSON.parse(decryptToken(raw));
}

// ─── OAuth2 URL + callback ────────────────────────────────────────────────────

function getRedirectUri() {
    return (
        process.env.GDRIVE_REDIRECT_URI ||
        'http://localhost:2081/api/backup/drive/callback'
    );
}

function generateAuthUrl() {
    const params = new URLSearchParams({
        client_id: process.env.GDRIVE_CLIENT_ID,
        redirect_uri: getRedirectUri(),
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${GDRIVE_AUTH_ENDPOINT}?${params}`;
}

async function exchangeCodeForTokens(code) {
    const res = await fetch(GDRIVE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: process.env.GDRIVE_CLIENT_ID,
            client_secret: process.env.GDRIVE_CLIENT_SECRET,
            redirect_uri: getRedirectUri(),
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
    saveTokens({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: Date.now() + (tokens.expires_in || 3600) * 1000,
    });
    return tokens;
}

async function getOAuthAccessToken() {
    const stored = loadTokens();
    if (
        stored.access_token &&
        stored.expiry &&
        stored.expiry > Date.now() + 60_000
    ) {
        return stored.access_token;
    }
    // Refresh
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
        throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    const updated = {
        ...stored,
        access_token: data.access_token,
        expiry: Date.now() + (data.expires_in || 3600) * 1000,
    };
    saveTokens(updated);
    return updated.access_token;
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
        throw new Error(`Drive folder search failed (${listRes.status})`);
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
        throw new Error(`Drive folder creation failed (${createRes.status})`);
    const folder = await createRes.json();
    return folder.id;
}

async function uploadBackup(dbJson) {
    const token = await getOAuthAccessToken();
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
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive upload failed (${res.status}): ${text}`);
    }
    const file = await res.json();
    return { fileId: file.id, fileName, folderId };
}

async function listBackups() {
    const token = await getOAuthAccessToken();
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
    if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
    const { files } = await res.json();
    return files || [];
}

async function downloadAndDecryptBackup(fileId) {
    if (typeof fileId !== 'string' || !DRIVE_FILE_ID_RE.test(fileId)) {
        throw new Error('Invalid Google Drive file ID.');
    }
    const token = await getOAuthAccessToken();
    const encodedFileId = encodeURIComponent(fileId);
    const res = await fetch(
        `${GDRIVE_API}/drive/v3/files/${encodedFileId}?alt=media`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
        },
    );
    if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
    const encrypted = await res.text();
    return decryptBackup(encrypted);
}

module.exports = {
    isConfigured,
    isOAuthConfigured,
    generateAuthUrl,
    exchangeCodeForTokens,
    uploadBackup,
    listBackups,
    downloadAndDecryptBackup,
};
