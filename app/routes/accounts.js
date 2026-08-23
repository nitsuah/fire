'use strict';

const crypto = require('crypto');
const express = require('express');
const { mutateState } = require('../lib/db');
const { strictNum } = require('../lib/server-utils');
const { resolveCryptoValue } = require('../lib/crypto-balance');

const router = express.Router();

const VALID_TYPES = new Set([
    'Cash',
    'Savings',
    'Brokerage',
    'Crypto',
    'Other',
]);

router.post('/', async (req, res) => {
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
    const type = req.body.type || 'Cash';
    if (!VALID_TYPES.has(type)) {
        return res.status(400).json({
            error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}.`,
        });
    }
    const quantity =
        req.body.quantity !== undefined ? strictNum(req.body.quantity) : null;
    if (quantity !== null && !Number.isFinite(quantity)) {
        return res.status(400).json({ error: 'Invalid quantity.' });
    }
    const newAcc = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        type,
        value,
        apy,
        ...(type === 'Crypto' && req.body.identifier
            ? { identifier: String(req.body.identifier).trim() }
            : {}),
        ...(type === 'Crypto' && quantity !== null ? { quantity } : {}),
    };
    const ok = await mutateState((state) => {
        if (!state.customAccounts) state.customAccounts = [];
        state.customAccounts.push(newAcc);
    });
    if (ok) {
        res.status(201).json(newAcc);
    } else {
        res.status(500).json({ error: 'Failed to save manual account.' });
    }
});

router.put('/:id', async (req, res) => {
    if (
        req.body.value !== undefined &&
        !Number.isFinite(strictNum(req.body.value))
    ) {
        return res.status(400).json({ error: 'Invalid value.' });
    }
    if (
        req.body.apy !== undefined &&
        !Number.isFinite(strictNum(req.body.apy))
    ) {
        return res.status(400).json({ error: 'Invalid apy.' });
    }
    if (req.body.name !== undefined) {
        if (typeof req.body.name !== 'string' || req.body.name.trim() === '') {
            return res.status(400).json({ error: 'Account name is required.' });
        }
    }
    if (req.body.type !== undefined && !VALID_TYPES.has(req.body.type)) {
        return res.status(400).json({
            error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}.`,
        });
    }
    if (
        req.body.quantity !== undefined &&
        !Number.isFinite(strictNum(req.body.quantity))
    ) {
        return res.status(400).json({ error: 'Invalid quantity.' });
    }

    let notFound = false;
    let updated = null;
    const ok = await mutateState((state) => {
        const idx = (state.customAccounts || []).findIndex(
            (acc) => acc.id === req.params.id,
        );
        if (idx === -1) {
            notFound = true;
            return;
        }
        const cur = state.customAccounts[idx];
        const value =
            req.body.value !== undefined
                ? strictNum(req.body.value)
                : cur.value;
        const apy =
            req.body.apy !== undefined ? strictNum(req.body.apy) : cur.apy;
        const type = req.body.type || cur.type;
        state.customAccounts[idx] = {
            ...cur,
            name: req.body.name !== undefined ? req.body.name.trim() : cur.name,
            type,
            value,
            apy,
            ...(type === 'Crypto'
                ? {
                      identifier:
                          req.body.identifier !== undefined
                              ? String(req.body.identifier).trim()
                              : cur.identifier,
                      quantity:
                          req.body.quantity !== undefined
                              ? strictNum(req.body.quantity)
                              : cur.quantity,
                  }
                : {}),
        };
        updated = state.customAccounts[idx];
    });
    if (notFound) return res.status(404).json({ error: 'Account not found.' });
    if (ok) {
        res.json(updated);
    } else {
        res.status(500).json({ error: 'Failed to update manual account.' });
    }
});

router.delete('/:id', async (req, res) => {
    let notFound = false;
    const ok = await mutateState((state) => {
        const before = (state.customAccounts || []).length;
        state.customAccounts = (state.customAccounts || []).filter(
            (acc) => acc.id !== req.params.id,
        );
        if (state.customAccounts.length === before) notFound = true;
    });
    if (notFound) return res.status(404).json({ error: 'Account not found.' });
    if (ok) {
        res.json({ message: 'Account successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete manual account.' });
    }
});

// Resolve a crypto account's identifier → update value in state
router.post('/:id/refresh-crypto', async (req, res) => {
    const db = require('../lib/db').readState();
    const account = (db.customAccounts || []).find(
        (a) => a.id === req.params.id,
    );
    if (!account) return res.status(404).json({ error: 'Account not found.' });
    if (account.type !== 'Crypto') {
        return res
            .status(400)
            .json({ error: 'refresh-crypto only applies to Crypto accounts.' });
    }
    if (!account.identifier) {
        return res.status(400).json({
            error: 'Account has no identifier. Set a coin ticker, ENS name, or 0x address.',
        });
    }

    const origIdentifier = account.identifier;
    try {
        const result = await resolveCryptoValue(
            origIdentifier,
            account.quantity,
        );
        let updated = null;
        const ok = await mutateState((state) => {
            const idx = (state.customAccounts || []).findIndex(
                (a) => a.id === req.params.id,
            );
            if (idx === -1) return;
            // Revalidate: account must still be Crypto with the same identifier
            const current = state.customAccounts[idx];
            if (
                current.type !== 'Crypto' ||
                current.identifier !== origIdentifier
            )
                return;
            state.customAccounts[idx] = {
                ...state.customAccounts[idx],
                value: result.usdValue,
                valueLastRefreshed: new Date().toISOString(),
                ...(result.resolvedAddress
                    ? { resolvedAddress: result.resolvedAddress }
                    : {}),
                ...(result.ethBalance != null
                    ? {
                          balance: result.ethBalance,
                          quantity: result.ethBalance,
                      }
                    : {}),
            };
            updated = state.customAccounts[idx];
        });
        if (!ok)
            return res.status(500).json({ error: 'Failed to update account.' });
        if (!updated)
            return res.status(409).json({
                error: 'Account was modified concurrently; please retry.',
            });
        res.json({ ...updated, cryptoResult: result });
    } catch (err) {
        res.status(err.status || 502).json({ error: err.message });
    }
});

module.exports = router;
