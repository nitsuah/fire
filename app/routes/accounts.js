'use strict';

const crypto = require('crypto');
const express = require('express');
const { readState, writeState } = require('../lib/db');

const router = express.Router();

function strictNum(v) {
    const s = String(v ?? '');
    if (s !== s.trim() || s === '') return NaN;
    return Number(s);
}

router.post('/', (req, res) => {
    const db = readState();
    const value = req.body.value !== undefined ? strictNum(req.body.value) : 0;
    if (req.body.value !== undefined && !Number.isFinite(value)) {
        return res.status(400).json({ error: 'Invalid value.' });
    }
    const apy = req.body.apy !== undefined ? strictNum(req.body.apy) : 0;
    if (req.body.apy !== undefined && !Number.isFinite(apy)) {
        return res.status(400).json({ error: 'Invalid apy.' });
    }
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
        return res.status(400).json({ error: 'Account name is required.' });
    }
    const newAcc = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        type: req.body.type || 'Cash',
        value,
        apy,
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

    const value =
        req.body.value !== undefined
            ? strictNum(req.body.value)
            : db.customAccounts[accountIndex].value;
    if (req.body.value !== undefined && !Number.isFinite(value)) {
        return res.status(400).json({ error: 'Invalid value.' });
    }
    const apy =
        req.body.apy !== undefined
            ? strictNum(req.body.apy)
            : db.customAccounts[accountIndex].apy;
    if (req.body.apy !== undefined && !Number.isFinite(apy)) {
        return res.status(400).json({ error: 'Invalid apy.' });
    }
    if (req.body.name !== undefined) {
        if (typeof req.body.name !== 'string' || req.body.name.trim() === '') {
            return res.status(400).json({ error: 'Account name is required.' });
        }
    }

    db.customAccounts[accountIndex] = {
        ...db.customAccounts[accountIndex],
        name: req.body.name !== undefined ? req.body.name.trim() : db.customAccounts[accountIndex].name,
        type: req.body.type || db.customAccounts[accountIndex].type,
        value,
        apy,
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
        return res.status(404).json({ error: 'Account not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'Account successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete manual account.' });
    }
});

module.exports = router;
