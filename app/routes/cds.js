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

function isValidYMD(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

router.post('/', (req, res) => {
    const db = readState();
    const principal =
        req.body.principal !== undefined ? strictNum(req.body.principal) : 0;
    if (req.body.principal !== undefined && !Number.isFinite(principal)) {
        return res.status(400).json({ error: 'Invalid principal.' });
    }
    const rate = req.body.rate !== undefined ? strictNum(req.body.rate) : 0;
    if (req.body.rate !== undefined && !Number.isFinite(rate)) {
        return res.status(400).json({ error: 'Invalid rate.' });
    }
    if (!isValidYMD(req.body.maturity)) {
        return res
            .status(400)
            .json({ error: 'A valid maturity date is required (YYYY-MM-DD).' });
    }
    const newCD = {
        id: crypto.randomBytes(8).toString('hex'),
        bank: req.body.bank,
        principal,
        rate,
        startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
        maturity: req.body.maturity,
    };
    db.cds.push(newCD);
    if (writeState(db)) {
        res.status(201).json(newCD);
    } else {
        res.status(500).json({ error: 'Failed to save CD.' });
    }
});

router.put('/:id', (req, res) => {
    const db = readState();
    const cdIndex = db.cds.findIndex((cd) => cd.id === req.params.id);

    if (cdIndex === -1) {
        return res.status(404).json({ error: 'CD not found.' });
    }

    const principal =
        req.body.principal !== undefined
            ? strictNum(req.body.principal)
            : db.cds[cdIndex].principal;
    if (req.body.principal !== undefined && !Number.isFinite(principal)) {
        return res.status(400).json({ error: 'Invalid principal.' });
    }
    const rate =
        req.body.rate !== undefined
            ? strictNum(req.body.rate)
            : db.cds[cdIndex].rate;
    if (req.body.rate !== undefined && !Number.isFinite(rate)) {
        return res.status(400).json({ error: 'Invalid rate.' });
    }
    if (req.body.maturity !== undefined && !isValidYMD(req.body.maturity)) {
        return res
            .status(400)
            .json({ error: 'A valid maturity date is required (YYYY-MM-DD).' });
    }

    db.cds[cdIndex] = {
        ...db.cds[cdIndex],
        bank: req.body.bank || db.cds[cdIndex].bank,
        principal,
        rate,
        startDate: req.body.startDate || db.cds[cdIndex].startDate,
        maturity: req.body.maturity || db.cds[cdIndex].maturity,
    };

    if (writeState(db)) {
        res.json(db.cds[cdIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update CD.' });
    }
});

router.delete('/:id', (req, res) => {
    const db = readState();
    const initialLength = db.cds.length;
    db.cds = db.cds.filter((cd) => cd.id !== req.params.id);

    if (db.cds.length === initialLength) {
        return res.status(404).json({ error: 'CD not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'CD successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete CD.' });
    }
});

module.exports = router;
