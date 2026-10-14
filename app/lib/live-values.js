'use strict';

/* ==========================================================================
   live-values.js — Apply live quotes to stored holdings

   Shared by PATCH /api/state/live-values (quotes from an open dashboard tab,
   app/lib/prices.js) and the server's own scheduled refresh
   (app/lib/server-reprice.js). Callers send only the quote (price +
   timestamp); value/PnL are recomputed from the *stored* quantity, cost
   basis and weight, so a tab holding stale holdings can't write stale math,
   and an update is ignored unless its timestamp is newer than the stored
   one, so out-of-order refreshes can't roll prices back.
   ========================================================================== */

const finiteNum = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
const isoTime = (v) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? null : t;
};
// A quote timestamp may come from the browser's clock. One far in the future
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

// Applies { positions, metals } quote lists to db (mutates it) by id.
// Returns how many holdings changed.
function applyLiveValues(db, { positions = [], metals = [] } = {}) {
    const byId = (list) =>
        new Map((list || []).filter((x) => x?.id).map((x) => [x.id, x]));
    let updated = 0;
    const posById = byId(db.importedPositions);
    for (const q of positions) {
        const target = q && posById.get(q.id);
        if (target && applyPositionQuote(target, q)) updated++;
    }
    const accById = byId(db.customAccounts);
    for (const q of metals) {
        const target = q && accById.get(q.id);
        if (target?.type === 'Metal' && applyMetalQuote(target, q)) updated++;
    }
    return updated;
}

module.exports = { applyLiveValues, applyPositionQuote, applyMetalQuote };
