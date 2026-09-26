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

// ~10 years of daily points; the oldest are dropped beyond this.
const MAX_HISTORY_DAYS = 3650;

const round2 = (n) => Math.round(n * 100) / 100;

// YYYY-MM-DD in the server's local time.
function dayKey(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

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
// history with a $0 point.
function recordNetWorthSnapshot(db, now = new Date()) {
    const snap = snapshotNetWorth(db);
    const hasData =
        (db.importedPositions || []).length ||
        (db.customAccounts || []).length ||
        (db.cds || []).length ||
        (db.realEstate || []).length ||
        (db.vehicles || []).length;
    if (!hasData) return null;

    const date = dayKey(now);
    const entry = { date, ...snap, recordedAt: now.toISOString() };
    const history = Array.isArray(db.netWorthHistory)
        ? db.netWorthHistory.filter((e) => e && e.date !== date)
        : [];
    history.push(entry);
    history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    db.netWorthHistory = history.slice(-MAX_HISTORY_DAYS);
    return entry;
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
