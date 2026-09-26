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
    const currentRevision = Number.isInteger(current.stateRevision)
        ? current.stateRevision
        : 0;
    // Optimistic concurrency for full-state saves: a client says which
    // revision its copy was loaded at (baseRevision). If another full save
    // landed since, this copy is stale — refuse rather than overwrite newer
    // data with it. Saves without baseRevision (backup tools, older
    // clients) keep the previous last-write-wins behaviour.
    // stateRevision is server-owned: drop whatever the client echoed back.
    const { baseRevision, ...body } = req.body;
    delete body.stateRevision;
    if (baseRevision !== undefined && baseRevision !== currentRevision) {
        return res.status(409).json({
            error: 'State changed since this copy was loaded; reload and retry.',
            stateRevision: currentRevision,
        });
    }
    const merged = {
        ...defaultState(),
        ...current,
        ...body,
        stateRevision: currentRevision + 1,
        expenses: { ...current.expenses, ...(body.expenses || {}) },
        projectionSettings: {
            ...current.projectionSettings,
            ...(body.projectionSettings || {}),
        },
    };
    const success = writeState(merged);
    if (success) {
        res.json({
            message: 'State successfully updated.',
            stateRevision: merged.stateRevision,
            state: merged,
        });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

// Narrow write for the background live-price refresh (app/lib/prices.js).
// It must NOT post the whole client state: an older open tab would then
// overwrite everything else (ledger edits, new accounts…) with its stale
// copy every 5 minutes. Clients send only the quote (price + timestamp);
// value/PnL are recomputed here from the *stored* quantity, cost basis and
// weight, so a tab holding stale holdings can't write stale math, and an
// update is ignored unless its timestamp is newer than the stored one, so
// out-of-order refreshes can't roll prices back.
const finiteNum = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
const isoTime = (v) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? null : t;
};
// A quote timestamp comes from the browser's clock. One far in the future
// (skewed clock, bad client) would otherwise become the stored "newest" and
// block every correct refresh until real time caught up.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const isNewer = (incoming, stored) => {
    const inT = isoTime(incoming);
    if (inT === null || inT > Date.now() + MAX_CLOCK_SKEW_MS) return false;
    const curT = isoTime(stored);
    return curT === null || inT > curT;
};

function applyPositionQuote(pos, quote) {
    const price = finiteNum(quote.lastPrice);
    if (price === null || price <= 0) return false;
    if (!isNewer(quote.priceUpdatedAt, pos.priceUpdatedAt)) return false;
    pos.lastPrice = price;
    pos.priceUpdatedAt = new Date(isoTime(quote.priceUpdatedAt)).toISOString();
    // The daily move must describe this same quote: keep it only when this
    // update carries a sane one (|x| < 100%), otherwise clear the old one.
    const dayPct = finiteNum(quote.dayChangePercent);
    if (dayPct !== null && Math.abs(dayPct) < 100)
        pos.dayChangePercent = dayPct;
    else delete pos.dayChangePercent;
    if (pos.quantity > 0) pos.value = pos.quantity * price;
    if (pos.costBasis > 0) {
        pos.pnlDollar = pos.value - pos.costBasis;
        pos.pnlPercent = (pos.pnlDollar / pos.costBasis) * 100;
    }
    return true;
}

function applyMetalQuote(acc, quote) {
    const spot = finiteNum(quote.spotPricePerOz);
    const pct = finiteNum(quote.payoutPct);
    if (spot === null || spot <= 0 || pct === null || pct <= 0 || pct > 1)
        return false;
    if (!(acc.weightOz > 0)) return false;
    if (!isNewer(quote.valueLastRefreshed, acc.valueLastRefreshed))
        return false;
    acc.spotPricePerOz = spot;
    acc.payoutPct = pct;
    acc.value = spot * pct * acc.weightOz;
    acc.valueLastRefreshed = new Date(
        isoTime(quote.valueLastRefreshed),
    ).toISOString();
    return true;
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
        for (const q of positions) {
            const target = q && posById.get(q.id);
            if (target && applyPositionQuote(target, q)) updated++;
        }
        const accById = byId(db.customAccounts);
        for (const q of metals) {
            const target = q && accById.get(q.id);
            if (target?.type === 'Metal' && applyMetalQuote(target, q))
                updated++;
        }
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save.' });
    res.json({ updated });
});

module.exports = router;
