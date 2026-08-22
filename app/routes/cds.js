'use strict';

const crypto = require('crypto');
const express = require('express');
const { mutateState } = require('../lib/db');

const { strictNum } = require('../lib/server-utils');

const router = express.Router();

function isValidYMD(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

router.post('/', async (req, res) => {
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
    const ok = await mutateState((state) => {
        if (!state.cds) state.cds = [];
        state.cds.push(newCD);
    });
    if (ok) {
        res.status(201).json(newCD);
    } else {
        res.status(500).json({ error: 'Failed to save CD.' });
    }
});

router.put('/:id', async (req, res) => {
    if (
        req.body.principal !== undefined &&
        !Number.isFinite(strictNum(req.body.principal))
    ) {
        return res.status(400).json({ error: 'Invalid principal.' });
    }
    if (
        req.body.rate !== undefined &&
        !Number.isFinite(strictNum(req.body.rate))
    ) {
        return res.status(400).json({ error: 'Invalid rate.' });
    }
    if (req.body.maturity !== undefined && !isValidYMD(req.body.maturity)) {
        return res
            .status(400)
            .json({ error: 'A valid maturity date is required (YYYY-MM-DD).' });
    }

    let notFound = false;
    let updated = null;
    const ok = await mutateState((state) => {
        const idx = (state.cds || []).findIndex(
            (cd) => cd.id === req.params.id,
        );
        if (idx === -1) {
            notFound = true;
            return;
        }
        const cur = state.cds[idx];
        const principal =
            req.body.principal !== undefined
                ? strictNum(req.body.principal)
                : cur.principal;
        const rate =
            req.body.rate !== undefined ? strictNum(req.body.rate) : cur.rate;
        state.cds[idx] = {
            ...cur,
            bank: req.body.bank || cur.bank,
            principal,
            rate,
            startDate: req.body.startDate || cur.startDate,
            maturity: req.body.maturity || cur.maturity,
        };
        updated = state.cds[idx];
    });
    if (notFound) return res.status(404).json({ error: 'CD not found.' });
    if (ok) {
        res.json(updated);
    } else {
        res.status(500).json({ error: 'Failed to update CD.' });
    }
});

router.delete('/:id', async (req, res) => {
    let notFound = false;
    const ok = await mutateState((state) => {
        const before = (state.cds || []).length;
        state.cds = (state.cds || []).filter((cd) => cd.id !== req.params.id);
        if (state.cds.length === before) notFound = true;
    });
    if (notFound) return res.status(404).json({ error: 'CD not found.' });
    if (ok) {
        res.json({ message: 'CD successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete CD.' });
    }
});

module.exports = router;
