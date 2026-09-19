'use strict';

const crypto = require('crypto');
const express = require('express');
const { mutateState } = require('../lib/db');
const { strictNum } = require('../lib/server-utils');
const { resolveCryptoValue } = require('../lib/crypto-balance');
const { resolveMetalValue } = require('../lib/metals-prices');

const router = express.Router();

const VALID_TYPES = new Set([
    'Cash',
    'Savings',
    'Brokerage',
    'Crypto',
    'Metal',
    'Other',
]);
const VALID_METAL_TYPES = new Set(['gold', 'silver']);

const looksLikeCryptoId = (v) =>
    /^0x[0-9a-fA-F]{40}$/.test(v) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(v) ||
    /^[A-Z0-9]{2,6}$/.test(v);

router.post('/', async (req, res) => {
    const value = req.body.value !== undefined ? strictNum(req.body.value) : 0;
    if (req.body.value !== undefined && !Number.isFinite(value)) {
        return res.status(400).json({ error: 'Invalid value.' });
    }
    const apy = req.body.apy !== undefined ? strictNum(req.body.apy) : 0;
    if (
        req.body.apy !== undefined &&
        (!Number.isFinite(apy) || apy < 0 || apy > 100)
    ) {
        return res
            .status(400)
            .json({ error: 'Invalid apy. Must be between 0 and 100.' });
    }
    let name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    let cryptoIdentifier =
        typeof req.body.identifier === 'string'
            ? req.body.identifier.trim()
            : '';
    // Crypto: Name and identifier are interchangeable (ENS / 0x / ticker).
    if ((req.body.type || 'Cash') === 'Crypto') {
        if (!cryptoIdentifier && looksLikeCryptoId(name)) {
            cryptoIdentifier = name;
        } else if (
            cryptoIdentifier &&
            !looksLikeCryptoId(cryptoIdentifier) &&
            looksLikeCryptoId(name)
        ) {
            [name, cryptoIdentifier] = [cryptoIdentifier, name];
        }
        if (!name) name = cryptoIdentifier;
    }
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
    if (type === 'Metal') {
        const metalType = String(req.body.metalType || '').toLowerCase();
        if (!VALID_METAL_TYPES.has(metalType)) {
            return res.status(400).json({
                error: `Invalid metalType. Must be one of: ${[...VALID_METAL_TYPES].join(', ')}.`,
            });
        }
        const weightOz =
            req.body.weightOz !== undefined
                ? strictNum(req.body.weightOz)
                : null;
        if (weightOz === null || !Number.isFinite(weightOz) || weightOz <= 0) {
            return res
                .status(400)
                .json({ error: 'weightOz is required and must be > 0.' });
        }
    }
    const newAcc = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        type,
        value,
        apy,
        ...(type === 'Crypto' && cryptoIdentifier
            ? { identifier: cryptoIdentifier }
            : {}),
        ...(type === 'Crypto' && quantity !== null ? { quantity } : {}),
        ...(type === 'Metal'
            ? {
                  metalType: String(req.body.metalType).toLowerCase(),
                  weightOz: strictNum(req.body.weightOz),
              }
            : {}),
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
    if (req.body.apy !== undefined) {
        const apyVal = strictNum(req.body.apy);
        if (!Number.isFinite(apyVal) || apyVal < 0 || apyVal > 100) {
            return res
                .status(400)
                .json({ error: 'Invalid apy. Must be between 0 and 100.' });
        }
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
    if (
        req.body.metalType !== undefined &&
        !VALID_METAL_TYPES.has(String(req.body.metalType).toLowerCase())
    ) {
        return res.status(400).json({
            error: `Invalid metalType. Must be one of: ${[...VALID_METAL_TYPES].join(', ')}.`,
        });
    }
    if (
        req.body.weightOz !== undefined &&
        (!Number.isFinite(strictNum(req.body.weightOz)) ||
            strictNum(req.body.weightOz) <= 0)
    ) {
        return res
            .status(400)
            .json({ error: 'weightOz must be a number > 0.' });
    }

    let invalidMetal = false;
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
        let metalValueStale = false;
        if (type === 'Metal') {
            const mType =
                req.body.metalType !== undefined
                    ? String(req.body.metalType).toLowerCase()
                    : cur.metalType;
            const mWeight =
                req.body.weightOz !== undefined
                    ? strictNum(req.body.weightOz)
                    : cur.weightOz;
            if (
                !VALID_METAL_TYPES.has(mType) ||
                !Number.isFinite(mWeight) ||
                mWeight <= 0
            ) {
                invalidMetal = true;
                return;
            }
            metalValueStale =
                req.body.value === undefined &&
                (mType !== cur.metalType || mWeight !== cur.weightOz);
        }
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
                      metalType: undefined,
                      weightOz: undefined,
                      // A Metal quote's timestamp doesn't describe a Crypto value.
                      ...(cur.type !== 'Crypto' && req.body.value === undefined
                          ? { valueLastRefreshed: undefined }
                          : {}),
                  }
                : type === 'Metal'
                  ? {
                        metalType:
                            req.body.metalType !== undefined
                                ? String(req.body.metalType).toLowerCase()
                                : cur.metalType,
                        weightOz:
                            req.body.weightOz !== undefined
                                ? strictNum(req.body.weightOz)
                                : cur.weightOz,
                        identifier: undefined,
                        quantity: undefined,
                        resolvedAddress: undefined,
                        balance: undefined,
                    }
                  : {
                        identifier: undefined,
                        quantity: undefined,
                        resolvedAddress: undefined,
                        balance: undefined,
                        valueLastRefreshed: undefined,
                        metalType: undefined,
                        weightOz: undefined,
                    }),
        };
        if (metalValueStale) {
            // Pricing inputs changed without a new value: don't keep the
            // old holdings' total.
            state.customAccounts[idx].value = 0;
            state.customAccounts[idx].valueLastRefreshed = undefined;
        }
        updated = state.customAccounts[idx];
    });
    if (invalidMetal) {
        return res.status(400).json({
            error: 'Metal accounts need a valid metalType and a positive weightOz.',
        });
    }
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

// Resolve a Metal account's (metalType, weightOz) to a live spot value —
// mirrors refresh-crypto above.
router.post('/:id/refresh-metal', async (req, res) => {
    const db = require('../lib/db').readState();
    const account = (db.customAccounts || []).find(
        (a) => a.id === req.params.id,
    );
    if (!account) return res.status(404).json({ error: 'Account not found.' });
    if (account.type !== 'Metal') {
        return res
            .status(400)
            .json({ error: 'refresh-metal only applies to Metal accounts.' });
    }
    if (!account.metalType || !account.weightOz) {
        return res.status(400).json({
            error: 'Account has no metalType/weightOz. Set both first.',
        });
    }

    const origMetalType = account.metalType;
    const origWeightOz = account.weightOz;
    try {
        const result = await resolveMetalValue(origMetalType, origWeightOz);
        let updated = null;
        const ok = await mutateState((state) => {
            const idx = (state.customAccounts || []).findIndex(
                (a) => a.id === req.params.id,
            );
            if (idx === -1) return;
            // Revalidate: account must still be Metal with the same
            // metalType/weightOz (not edited concurrently).
            const current = state.customAccounts[idx];
            if (
                current.type !== 'Metal' ||
                current.metalType !== origMetalType ||
                current.weightOz !== origWeightOz
            )
                return;
            state.customAccounts[idx] = {
                ...state.customAccounts[idx],
                value: result.usdValue,
                valueLastRefreshed: new Date().toISOString(),
            };
            updated = state.customAccounts[idx];
        });
        if (!ok)
            return res.status(500).json({ error: 'Failed to update account.' });
        if (!updated)
            return res.status(409).json({
                error: 'Account was modified concurrently; please retry.',
            });
        res.json({ ...updated, metalResult: result });
    } catch (err) {
        res.status(err.status || 502).json({ error: err.message });
    }
});

module.exports = router;
