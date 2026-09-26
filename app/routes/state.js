'use strict';

const express = require('express');
const {
    defaultState,
    readState,
    writeState,
    mutateState,
} = require('../lib/db');

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
    const merged = {
        ...defaultState(),
        ...current,
        ...req.body,
        expenses: { ...current.expenses, ...(req.body.expenses || {}) },
        projectionSettings: {
            ...current.projectionSettings,
            ...(req.body.projectionSettings || {}),
        },
    };
    const success = writeState(merged);
    if (success) {
        res.json({ message: 'State successfully updated.', state: merged });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

// Narrow write for the background live-price refresh (app/lib/prices.js).
// It must NOT post the whole client state: an older open tab would then
// overwrite everything else (ledger edits, new accounts…) with its stale
// copy every 5 minutes. Only the price-derived fields of the given
// positions / Metal accounts are updated, matched by id.
const POSITION_LIVE_FIELDS = [
    'lastPrice',
    'value',
    'pnlDollar',
    'pnlPercent',
    'priceUpdatedAt',
];
const METAL_LIVE_FIELDS = [
    'value',
    'spotPricePerOz',
    'payoutPct',
    'valueLastRefreshed',
];

function pickLiveFields(src, fields) {
    const out = {};
    for (const f of fields) {
        const v = src[f];
        if (f.endsWith('At') || f === 'valueLastRefreshed') {
            if (typeof v === 'string' && !Number.isNaN(Date.parse(v)))
                out[f] = v;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
            out[f] = v;
        }
    }
    return out;
}

router.patch('/live-values', async (req, res) => {
    const { positions = [], metals = [] } = req.body || {};
    if (!Array.isArray(positions) || !Array.isArray(metals)) {
        return res
            .status(400)
            .json({ error: 'positions and metals must be arrays.' });
    }
    let updated = 0;
    const ok = await mutateState((db) => {
        const byId = (list) =>
            new Map((list || []).filter((x) => x?.id).map((x) => [x.id, x]));
        const posById = byId(db.importedPositions);
        for (const p of positions) {
            const target = p && posById.get(p.id);
            if (!target) continue;
            Object.assign(target, pickLiveFields(p, POSITION_LIVE_FIELDS));
            updated++;
        }
        const accById = byId(db.customAccounts);
        for (const m of metals) {
            const target = m && accById.get(m.id);
            if (!target || target.type !== 'Metal') continue;
            Object.assign(target, pickLiveFields(m, METAL_LIVE_FIELDS));
            updated++;
        }
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save.' });
    res.json({ updated });
});

module.exports = router;
