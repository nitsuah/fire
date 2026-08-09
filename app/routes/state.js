'use strict';

const express = require('express');
const { defaultState, readState, writeState } = require('../lib/db');

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
    const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (req.body.expenses !== undefined && !isPlainObj(req.body.expenses)) {
        return res.status(400).json({ error: 'expenses must be an object.' });
    }
    if (req.body.projectionSettings !== undefined && !isPlainObj(req.body.projectionSettings)) {
        return res.status(400).json({ error: 'projectionSettings must be an object.' });
    }
    const current = readState();
    const merged = {
        ...defaultState(),
        ...current,
        ...req.body,
        expenses: { ...current.expenses, ...(req.body.expenses || {}) },
        projectionSettings: { ...current.projectionSettings, ...(req.body.projectionSettings || {}) },
    };
    const success = writeState(merged);
    if (success) {
        res.json({ message: 'State successfully updated.', state: merged });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

module.exports = router;
