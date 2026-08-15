'use strict';

const express = require('express');
const crypto = require('crypto');
const { readState, mutateState } = require('../lib/db');
const { refreshWalletBalance, loadChains } = require('../lib/web3-prices');

const router = express.Router();

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BTC_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateAddress(address, chain) {
    const chains = loadChains();
    const chainDef = chains.find((c) => c.id === chain);
    if (!chainDef) return false;
    if (chainDef.addressFormat === 'evm') return EVM_RE.test(address);
    if (chain === 'bitcoin') return BTC_RE.test(address);
    if (chain === 'solana') return SOL_RE.test(address);
    return true;
}

router.get('/', (req, res) => {
    const db = readState();
    const wallets = (db.wallets || []).map((w) => ({
        ...w,
        address: `...${w.address.slice(-8)}`,
    }));
    res.json({ wallets, count: wallets.length });
});

router.post('/', async (req, res) => {
    const { address, chain, label } = req.body;
    if (
        typeof address !== 'string' ||
        !address ||
        typeof chain !== 'string' ||
        !chain ||
        typeof label !== 'string' ||
        !label
    ) {
        return res
            .status(400)
            .json({ error: 'address, chain, and label are required.' });
    }
    if (!validateAddress(address, chain)) {
        return res
            .status(400)
            .json({ error: `Invalid address format for chain: ${chain}` });
    }
    const wallet = {
        id: crypto.randomBytes(8).toString('hex'),
        address,
        chain,
        label,
        lastBalance: null,
        lastUsdValue: null,
        lastFetched: null,
    };
    let duplicate = false;
    const ok = await mutateState((state) => {
        if (!state.wallets) state.wallets = [];
        duplicate = state.wallets.some(
            (w) =>
                w.address.toLowerCase() === address.toLowerCase() &&
                w.chain === chain,
        );
        if (!duplicate) state.wallets.push(wallet);
    });
    if (duplicate)
        return res.status(409).json({ error: 'Wallet already tracked.' });
    if (!ok) return res.status(500).json({ error: 'Failed to save wallet.' });
    res.status(201).json({
        ...wallet,
        address: `...${wallet.address.slice(-8)}`,
    });
});

router.delete('/:id', async (req, res) => {
    const db = readState();
    const wallet = (db.wallets || []).find((w) => w.id === req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });
    const ok = await mutateState((state) => {
        state.wallets = state.wallets.filter((w) => w.id !== req.params.id);
    });
    if (!ok) return res.status(500).json({ error: 'Failed to remove wallet.' });
    res.json({ message: 'Wallet removed.' });
});

router.post('/:id/refresh', async (req, res) => {
    const db = readState();
    const wallet = (db.wallets || []).find((w) => w.id === req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found.' });
    try {
        const updated = await refreshWalletBalance(wallet);
        const ok = await mutateState((state) => {
            const idx = state.wallets.findIndex((w) => w.id === req.params.id);
            if (idx !== -1) state.wallets[idx] = updated;
        });
        if (!ok)
            return res.status(500).json({ error: 'Failed to update wallet.' });
        res.json({
            ...updated,
            address: `...${updated.address.slice(-8)}`,
        });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

router.post('/refresh-all', async (req, res) => {
    const db = readState();
    const wallets = db.wallets || [];
    if (wallets.length === 0) return res.json({ updated: 0, wallets: [] });
    const settled = await Promise.allSettled(
        wallets.map((w) => refreshWalletBalance(w)),
    );
    const results = settled.map((s, i) =>
        s.status === 'fulfilled'
            ? s.value
            : {
                  ...wallets[i],
                  warning: s.reason?.message || 'Refresh failed',
                  lastFetched: new Date().toISOString(),
              },
    );
    const ok = await mutateState((state) => {
        const refreshedById = new Map(results.map((w) => [w.id, w]));
        state.wallets = (state.wallets || []).map(
            (w) => refreshedById.get(w.id) || w,
        );
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to update wallets.' });
    const summary = results.map((w) => ({
        id: w.id,
        chain: w.chain,
        label: w.label,
        address: `...${w.address.slice(-8)}`,
        lastUsdValue: w.lastUsdValue,
        lastFetched: w.lastFetched,
        warning: w.warning,
    }));
    res.json({ updated: summary.length, wallets: summary });
});

module.exports = router;
