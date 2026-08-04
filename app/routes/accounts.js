'use strict';

const express = require('express');
const { readState, writeState } = require('../lib/db');

const router = express.Router();

router.post('/', (req, res) => {
    const db = readState();
    const newAcc = {
        id: Date.now().toString(),
        name: req.body.name,
        type: req.body.type || 'Cash',
        value: parseFloat(req.body.value) || 0,
        apy: parseFloat(req.body.apy) || 0,
    };
    db.customAccounts.push(newAcc);
    if (writeState(db)) {
        res.status(201).json(newAcc);
    } else {
        res.status(500).json({ error: 'Failed to save manual account.' });
    }
});

router.put('/:id', (req, res) => {
    const db = readState();
    const accountIndex = db.customAccounts.findIndex(
        (acc) => acc.id === req.params.id,
    );

    if (accountIndex === -1) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    db.customAccounts[accountIndex] = {
        ...db.customAccounts[accountIndex],
        name: req.body.name || db.customAccounts[accountIndex].name,
        type: req.body.type || db.customAccounts[accountIndex].type,
        value:
            req.body.value !== undefined
                ? parseFloat(req.body.value)
                : db.customAccounts[accountIndex].value,
        apy:
            req.body.apy !== undefined
                ? parseFloat(req.body.apy)
                : db.customAccounts[accountIndex].apy,
    };

    if (writeState(db)) {
        res.json(db.customAccounts[accountIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update manual account.' });
    }
});

router.delete('/:id', (req, res) => {
    const db = readState();
    const initialLength = db.customAccounts.length;
    db.customAccounts = db.customAccounts.filter(
        (acc) => acc.id !== req.params.id,
    );

    if (db.customAccounts.length === initialLength) {
        return res.status(444).json({ error: 'Account not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'Account successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete manual account.' });
    }
});

module.exports = router;
