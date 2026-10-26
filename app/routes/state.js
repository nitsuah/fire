'use strict';

const express = require('express');
const {
    defaultState,
    readState,
    writeState,
    mutateState,
} = require('../lib/db');
const { applyLiveValues } = require('../lib/live-values');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(readState());
});

router.post('/', (req, res) => {
    if (
        typeof req.body !== 'object' ||
        req.body === null ||
        Array.isArray(req.body)
    ) {
        return res
            .status(400)
            .json({ error: 'Request body must be a JSON object.' });
    }
    const isPlainObj = (v) =>
        v !== null && typeof v === 'object' && !Array.isArray(v);
    if (req.body.expenses !== undefined && !isPlainObj(req.body.expenses)) {
        return res.status(400).json({ error: 'expenses must be an object.' });
    }
    if (
        req.body.projectionSettings !== undefined &&
        !isPlainObj(req.body.projectionSettings)
    ) {
        return res
            .status(400)
            .json({ error: 'projectionSettings must be an object.' });
    }
    const current = readState();
    const currentRevision = Number.isInteger(current.stateRevision)
        ? current.stateRevision
        : 0;
    // Optimistic concurrency for full-state saves: a client says which
    // revision its copy was loaded at (baseRevision). If another full save
    // landed since, this copy is stale — refuse rather than overwrite newer
    // data with it. Saves without baseRevision (backup tools, older
    // clients) keep the previous last-write-wins behaviour.
    // Server-owned fields: drop whatever the client echoed back. (A tab's
    // copy of netWorthHistory would be missing snapshots recorded since it
    // loaded.)
    const { baseRevision, ...body } = req.body;
    delete body.stateRevision;
    delete body.netWorthHistory;
    // A restore replays a backup's own lastSavedAt (the data was last edited
    // then, not now), but a skewed or future-sent clock can't backdate it.
    const bodySavedAt = Date.parse(body.lastSavedAt);
    const savedAt =
        Number.isFinite(bodySavedAt) && bodySavedAt <= Date.now()
            ? new Date(bodySavedAt).toISOString()
            : new Date().toISOString();
    if (baseRevision !== undefined && baseRevision !== currentRevision) {
        return res.status(409).json({
            error: 'State changed since this copy was loaded; reload and retry.',
            stateRevision: currentRevision,
        });
    }
    const merged = {
        ...defaultState(),
        ...current,
        ...body,
        stateRevision: currentRevision + 1,
        lastSavedAt: savedAt,
        expenses: { ...current.expenses, ...(body.expenses || {}) },
        projectionSettings: {
            ...current.projectionSettings,
            ...(body.projectionSettings || {}),
        },
    };
    const success = writeState(merged);
    if (success) {
        res.json({
            message: 'State successfully updated.',
            stateRevision: merged.stateRevision,
            state: merged,
        });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

// Narrow write for the background live-price refresh (app/lib/prices.js).
// It must NOT post the whole client state: an older open tab would then
// overwrite everything else (ledger edits, new accounts…) with its stale
// copy every 5 minutes. See app/lib/live-values.js for the merge rules.
router.patch('/live-values', async (req, res) => {
    const { positions = [], metals = [] } = req.body || {};
    if (!Array.isArray(positions) || !Array.isArray(metals)) {
        return res
            .status(400)
            .json({ error: 'positions and metals must be arrays.' });
    }
    let updated = 0;
    const ok = await mutateState((db) => {
        updated = applyLiveValues(db, { positions, metals });
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save.' });
    res.json({ updated });
});

module.exports = router;
