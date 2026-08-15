'use strict';

const fs = require('fs');
const crypto = require('crypto');

const BACKUP_FOLDER_NAME = 'fire-tracker-backups';
const GDRIVE_API = 'https://www.googleapis.com';
const GDRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

function isConfigured() {
    return Boolean(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
}

async function getServiceAccountToken(saKeyPath) {
    const key = JSON.parse(fs.readFileSync(saKeyPath, 'utf8'));

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
        JSON.stringify({
            iss: key.client_email,
            scope: 'https://www.googleapis.com/auth/drive.file',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        }),
    ).toString('base64url');

    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(key.private_key, 'base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }).toString(),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `Service account token fetch failed (${res.status}): ${text}`,
        );
    }
    const data = await res.json();
    return data.access_token;
}

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

async function getOrCreateFolder(token, folderName) {
    const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
    if (folderId) return folderId;

    const q = encodeURIComponent(
        `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
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
            name: folderName,
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
    const saKeyPath = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
    if (!saKeyPath || !fs.existsSync(saKeyPath)) {
        throw new Error(
            'GDRIVE_SERVICE_ACCOUNT_JSON path not set or file not found',
        );
    }
    const token = await getServiceAccountToken(saKeyPath);
    const folderId = await getOrCreateFolder(token, BACKUP_FOLDER_NAME);
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
    const saKeyPath = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
    if (!saKeyPath || !fs.existsSync(saKeyPath)) {
        throw new Error(
            'GDRIVE_SERVICE_ACCOUNT_JSON path not set or file not found',
        );
    }
    const token = await getServiceAccountToken(saKeyPath);
    const folderId = await getOrCreateFolder(token, BACKUP_FOLDER_NAME);
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
    const saKeyPath = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
    if (!saKeyPath || !fs.existsSync(saKeyPath)) {
        throw new Error(
            'GDRIVE_SERVICE_ACCOUNT_JSON path not set or file not found',
        );
    }
    const token = await getServiceAccountToken(saKeyPath);
    const res = await fetch(
        `${GDRIVE_API}/drive/v3/files/${fileId}?alt=media`,
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
    uploadBackup,
    listBackups,
    downloadAndDecryptBackup,
};
