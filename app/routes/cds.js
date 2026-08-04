'use strict';

const express = require('express');
const { readState, writeState } = require('../lib/db');

const router = express.Router();

router.post('/', (req, res) => {
    const db = readState();
    const newCD = {
        id: Date.now().toString(),
        bank: req.body.bank,
        principal: parseFloat(req.body.principal) || 0,
        rate: parseFloat(req.body.rate) || 0,
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

    db.cds[cdIndex] = {
        ...db.cds[cdIndex],
        bank: req.body.bank || db.cds[cdIndex].bank,
        principal:
            req.body.principal !== undefined
                ? parseFloat(req.body.principal)
                : db.cds[cdIndex].principal,
        rate:
            req.body.rate !== undefined
                ? parseFloat(req.body.rate)
                : db.cds[cdIndex].rate,
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
