'use strict';

/* ==========================================================================
   data-freshness.js — How old are the prices behind the numbers?

   Net worth is only as current as the last re-price. This summarizes the
   timestamps already stored on holdings (importedPositions[].priceUpdatedAt,
   Metal accounts' valueLastRefreshed, vehicles' valueLastRefreshed) plus the
   last CSV import, so MCP tools and net-worth snapshots can say "prices are
   N days old" instead of presenting stale values as current.
   ========================================================================== */

const DAY_MS = 24 * 60 * 60 * 1000;

// Prices older than this are flagged stale (covers a weekend plus a holiday).
const STALE_AFTER_DAYS = 3;

const CASH_SYMBOLS = ['SPAXX', 'FDRXX', 'FCASH', 'FDIC'];

// Money-market / sweep positions are held at $1 and never need a quote.
function isCashLike(pos) {
    const sym = String(pos.symbol || '').toUpperCase();
    return (
        CASH_SYMBOLS.some((c) => sym.includes(c)) ||
        String(pos.description || '').includes('MONEY MARKET')
    );
}

// Symbol as the quote APIs expect it ("SPAXX**" → "SPAXX").
const cleanSymbol = (sym) =>
    String(sym || '')
        .trim()
        .replace(/\*+$/, '');

// A CUSIP-style identifier (e.g. 92202V344, a 401k collective investment
// trust) has no ticker on Yahoo / Alpha Vantage / Polygon; its value only
// moves when a new positions CSV is imported.
const hasQuoteSource = (pos) => {
    const s = cleanSymbol(pos.symbol);
    return s.length > 0 && !/^\d/.test(s);
};

function quotableSymbols(positions) {
    return [
        ...new Set(
            (positions || [])
                .filter((p) => p && !isCashLike(p) && hasQuoteSource(p))
                .map((p) => cleanSymbol(p.symbol)),
        ),
    ];
}

const toTime = (v) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? null : t;
};
const iso = (t) => (t === null ? null : new Date(t).toISOString());
const daysSince = (t, now) =>
    t === null ? null : Math.max(0, Math.floor((now - t) / DAY_MS));

// Market-priced timestamps: quoted positions and Metal accounts.
function marketPriceTimes(state) {
    const times = [];
    for (const p of state.importedPositions || []) {
        if (!p || isCashLike(p) || !hasQuoteSource(p)) continue;
        const t = toTime(p.priceUpdatedAt);
        if (t !== null) times.push(t);
    }
    for (const a of state.customAccounts || []) {
        if (a?.type !== 'Metal') continue;
        const t = toTime(a.valueLastRefreshed);
        if (t !== null) times.push(t);
    }
    return times;
}

// importedFiles[].date is a locale string ("9/24/2026 02:20 AM").
function lastImportTime(state) {
    let latest = null;
    for (const f of state.importedFiles || []) {
        const t = toTime(f?.date);
        if (t !== null && (latest === null || t > latest)) latest = t;
    }
    return latest;
}

// Oldest market-price timestamp (ISO) and whether it's past the stale
// threshold. Used to tag each net-worth snapshot.
function pricesAsOf(state, now = new Date()) {
    const times = marketPriceTimes(state || {});
    if (!times.length) return { pricesAsOf: null, stale: false };
    const oldest = Math.min(...times);
    return {
        pricesAsOf: iso(oldest),
        stale: daysSince(oldest, now.getTime()) > STALE_AFTER_DAYS,
    };
}

function summarizeDataFreshness(state, now = new Date()) {
    const s = state || {};
    const nowMs = now.getTime();
    const times = marketPriceTimes(s);
    const oldest = times.length ? Math.min(...times) : null;
    const newest = times.length ? Math.max(...times) : null;
    const daysStale = daysSince(oldest, nowMs);

    const positionsWithoutPriceSource = [];
    for (const p of s.importedPositions || []) {
        if (!p || isCashLike(p)) continue;
        const noSource = !hasQuoteSource(p);
        if (!noSource && p.priceUpdatedAt) continue;
        positionsWithoutPriceSource.push({
            symbol: p.symbol,
            description: p.description || null,
            account: p.account || null,
            value: Math.round(p.value || 0),
            reason: noSource ? 'no_ticker' : 'never_priced',
        });
    }

    const vehicleTimes = (s.vehicles || [])
        .map((v) => toTime(v?.valueLastRefreshed))
        .filter((t) => t !== null);
    const vehiclesOldest = vehicleTimes.length
        ? Math.min(...vehicleTimes)
        : null;
    const importT = lastImportTime(s);

    return {
        pricesAsOf: { oldest: iso(oldest), newest: iso(newest) },
        daysStale,
        stale: daysStale !== null && daysStale > STALE_AFTER_DAYS,
        staleAfterDays: STALE_AFTER_DAYS,
        lastImport: iso(importT),
        daysSinceImport: daysSince(importT, nowMs),
        positionsWithoutPriceSource,
        vehicles: {
            oldestValuation: iso(vehiclesOldest),
            neverValued: (s.vehicles || []).filter(
                (v) => v && !toTime(v.valueLastRefreshed),
            ).length,
        },
    };
}

module.exports = {
    STALE_AFTER_DAYS,
    cleanSymbol,
    isCashLike,
    quotableSymbols,
    pricesAsOf,
    summarizeDataFreshness,
};
