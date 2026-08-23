'use strict';

const crypto = require('crypto');
const express = require('express');
const { readState, mutateState } = require('../lib/db');
const {
    isConfigured,
    isOAuthConfigured,
    generateAuthUrl,
    exchangeCodeForTokens,
    uploadBackup,
    listBackups,
    downloadAndDecryptBackup,
} = require('../lib/gdrive-backup');

const router = express.Router();
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

// ─── OAuth2 authorize / callback ──────────────────────────────────────────────

router.get('/drive/status', (req, res) => {
    const clientConfigured = Boolean(
        process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET,
    );
    res.json({
        authorized: isOAuthConfigured(),
        clientConfigured,
        masterKeySet: Boolean(process.env.SYNC_MASTER_KEY),
    });
});

router.get('/drive/authorize', (req, res) => {
    if (!process.env.GDRIVE_CLIENT_ID || !process.env.GDRIVE_CLIENT_SECRET) {
        return res.status(503).json({
            error: 'GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set to authorize Google Drive.',
        });
    }
    if (!process.env.SYNC_MASTER_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.SYNC_MASTER_KEY)) {
        return res.status(503).json({
            error: 'SYNC_MASTER_KEY must be set (64 hex chars) before connecting Google Drive — tokens cannot be stored securely without it.',
        });
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.driveOauthState = state;
    const url = generateAuthUrl(state);
    res.redirect(url);
});

router.get('/drive/callback', async (req, res) => {
    const { code, error, state } = req.query;
    if (!state || state !== req.session?.driveOauthState) {
        return res
            .status(403)
            .send('<p>Invalid OAuth state. Please try authorizing again.</p>');
    }
    delete req.session.driveOauthState;
    if (error) {
        const safeError = String(error).replace(
            /[<>&"]/g,
            (c) =>
                ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
        );
        return res
            .status(400)
            .send(`<p>Google Drive authorization denied: ${safeError}</p>`);
    }
    if (!code || typeof code !== 'string') {
        return res.status(400).send('<p>Missing authorization code.</p>');
    }
    if (!process.env.GDRIVE_CLIENT_ID || !process.env.GDRIVE_CLIENT_SECRET) {
        return res
            .status(503)
            .send(
                '<p>GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET not set on server.</p>',
            );
    }
    try {
        await exchangeCodeForTokens(code);
        res.send(`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Drive Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.card{background:#1e293b;border-radius:12px;padding:40px;max-width:400px;text-align:center}
h2{color:#10b981;margin-top:0}p{color:#94a3b8}button{background:#6366f1;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:15px}</style>
</head>
<body><div class="card">
<h2>✓ Google Drive connected</h2>
<p>Your FIRE tracker can now back up encrypted snapshots to your personal Google Drive folder <strong>fire-tracker-backups</strong>.</p>
<button onclick="window.close()">Close this tab</button>
</div></body></html>`);
    } catch (err) {
        console.error('[Backup] OAuth callback error:', err);
        res.status(500).send(
            '<p>Authorization failed. Check server logs for details.</p>',
        );
    }
});

// ─── Backup / restore ─────────────────────────────────────────────────────────

router.post('/drive', async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({
            error: 'Google Drive not authorized. Visit /api/backup/drive/authorize to connect.',
        });
    }
    if (!process.env.SYNC_MASTER_KEY) {
        return res.status(503).json({
            error: 'SYNC_MASTER_KEY is required for encrypted backup.',
        });
    }
    try {
        const db = readState();
        const json = JSON.stringify(db, null, 2);
        const result = await uploadBackup(json);
        res.json({ status: 'success', ...result });
    } catch (err) {
        console.error('[Backup] Drive upload error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.get('/drive/list', async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({
            error: 'Google Drive not authorized. Visit /api/backup/drive/authorize to connect.',
        });
    }
    try {
        const files = await listBackups();
        res.json({ files });
    } catch (err) {
        console.error('[Backup] Drive list error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.post('/drive/restore', async (req, res) => {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId is required.' });
    if (typeof fileId !== 'string' || !DRIVE_FILE_ID_RE.test(fileId)) {
        return res.status(400).json({ error: 'Invalid Google Drive file ID.' });
    }
    if (!isConfigured()) {
        return res.status(503).json({
            error: 'Google Drive not authorized. Visit /api/backup/drive/authorize to connect.',
        });
    }
    if (!process.env.SYNC_MASTER_KEY) {
        return res
            .status(503)
            .json({ error: 'SYNC_MASTER_KEY is required to decrypt backup.' });
    }
    try {
        const json = await downloadAndDecryptBackup(fileId);
        const restored = JSON.parse(json);
        const ok = await mutateState((state) => {
            for (const key of Object.keys(state)) {
                delete state[key];
            }
            Object.assign(state, restored);
        });
        if (!ok)
            return res
                .status(500)
                .json({ error: 'Failed to write restored state.' });
        res.json({
            status: 'success',
            message: 'Database restored from backup.',
        });
    } catch (err) {
        console.error('[Backup] Drive restore error:', err);
        res.status(502).json({ error: err.message });
    }
});

module.exports = router;
