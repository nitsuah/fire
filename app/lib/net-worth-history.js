'use strict';

/* ==========================================================================
   net-worth-history.js — Daily net-worth snapshots (state.netWorthHistory)

   The server records one entry per calendar day (today's entry is updated
   in place as values move), so the dashboard can chart actual net worth
   over time — not just projections — and MCP get_net_worth_trend has data.
   Uses the same aggregates as the dashboard (finance-core.js), so side
   hustle income stays out of net worth there too.
   ========================================================================== */

const {
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getAggregateRealEstate,
    getAggregateVehicles,
} = require('./finance-core');
const { pricesAsOf } = require('./data-freshness');
const {
    MAX_HISTORY_DAYS,
    dayKey,
    upsertDailySnapshot,
} = require('./daily-snapshot');

const round2 = (n) => Math.round(n * 100) / 100;

function snapshotNetWorth(state) {
    const s = state || {};
    const parts = {
        cash: getAggregateCash(s.importedPositions, s.customAccounts),
        cds: getAggregateCDs(s.cds),
        equities: getAggregateEquities(s.importedPositions, s.customAccounts),
        otherAssets: getAggregateOtherAssets(s.customAccounts),
        realEstate: getAggregateRealEstate(s.realEstate),
        vehicles: getAggregateVehicles(s.vehicles),
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return {
        total: round2(total),
        ...Object.fromEntries(
            Object.entries(parts).map(([k, v]) => [k, round2(v)]),
        ),
    };
}

// Upserts today's snapshot into db.netWorthHistory (mutates db). Returns
// the entry. Skips an empty database so a fresh install doesn't start its
// history with a $0 point. Each entry records pricesAsOf (oldest market
// price behind it) and stale (older than STALE_AFTER_DAYS), so a flat run
// of snapshots taken on unrefreshed prices isn't mistaken for tracking.
function recordNetWorthSnapshot(db, now = new Date()) {
    const hasData =
        (db.importedPositions || []).length ||
        (db.customAccounts || []).length ||
        (db.cds || []).length ||
        (db.realEstate || []).length ||
        (db.vehicles || []).length;
    if (!hasData) return null;

    return upsertDailySnapshot(
        db,
        { ...snapshotNetWorth(db), ...pricesAsOf(db, now) },
        now,
    );
}

// Summary for MCP / UI: latest value plus change over 7/30/365 days and
// since the first snapshot (null when there's no point that far back).
function summarizeNetWorthHistory(history, now = new Date()) {
    const points = (Array.isArray(history) ? history : [])
        .filter(
            (e) => e && typeof e.date === 'string' && Number.isFinite(e.total),
        )
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!points.length) return { points: [], latest: null, changes: {} };
    const latest = points[points.length - 1];
    const changeSince = (days) => {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - days);
        const key = dayKey(cutoff);
        // Latest point on or before the cutoff.
        let base = null;
        for (const p of points) {
            if (p.date <= key) base = p;
            else break;
        }
        if (!base) return null;
        const delta = round2(latest.total - base.total);
        return {
            from: base.date,
            delta,
            pct: base.total ? round2((delta / base.total) * 100) : null,
        };
    };
    const first = points[0];
    return {
        points,
        latest,
        changes: {
            d7: changeSince(7),
            d30: changeSince(30),
            d365: changeSince(365),
            sinceStart:
                points.length > 1
                    ? {
                          from: first.date,
                          delta: round2(latest.total - first.total),
                          pct: first.total
                              ? round2(
                                    ((latest.total - first.total) /
                                        first.total) *
                                        100,
                                )
                              : null,
                      }
                    : null,
        },
    };
}

module.exports = {
    MAX_HISTORY_DAYS,
    dayKey,
    snapshotNetWorth,
    recordNetWorthSnapshot,
    summarizeNetWorthHistory,
};
