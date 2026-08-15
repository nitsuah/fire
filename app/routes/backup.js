'use strict';

const express = require('express');
const { readState, mutateState } = require('../lib/db');
const {
    isConfigured,
    uploadBackup,
    listBackups,
    downloadAndDecryptBackup,
} = require('../lib/gdrive-backup');

const router = express.Router();

router.post('/drive', async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({
            error: 'Google Drive backup not configured. Set GDRIVE_SERVICE_ACCOUNT_JSON.',
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
            error: 'Google Drive backup not configured. Set GDRIVE_SERVICE_ACCOUNT_JSON.',
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
    if (!isConfigured()) {
        return res.status(503).json({
            error: 'Google Drive backup not configured. Set GDRIVE_SERVICE_ACCOUNT_JSON.',
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
