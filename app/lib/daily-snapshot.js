/* ==========================================================================
   daily-snapshot.js — Upsert one calendar day's net-worth point onto
   state.netWorthHistory. Split out of net-worth-history.js because both
   runtimes record these: the Node server on an hourly timer, and the
   browser on the hosted deploy (which has no /api/state, so the server
   never runs). Pure — callers pass the numbers — so it loads as-is under
   Node and in the browser (window.FireDailySnapshot).
   ========================================================================== */
/* global module */

(function (root) {
    'use strict';

    // ~10 years of daily points; the oldest are dropped beyond this.
    const MAX_HISTORY_DAYS = 3650;

    // YYYY-MM-DD in the host's local time.
    function dayKey(d) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    // Replaces today's entry if present (values move during the day), keeps
    // the list date-sorted and capped. Mutates `state`; returns the entry.
    function upsertDailySnapshot(state, fields, now = new Date()) {
        const date = dayKey(now);
        const history = (
            Array.isArray(state.netWorthHistory) ? state.netWorthHistory : []
        ).filter((e) => e && e.date !== date);
        history.push({ date, ...fields, recordedAt: now.toISOString() });
        history.sort((a, b) =>
            a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
        );
        state.netWorthHistory = history.slice(-MAX_HISTORY_DAYS);
        return state.netWorthHistory[state.netWorthHistory.length - 1];
    }

    const api = { MAX_HISTORY_DAYS, dayKey, upsertDailySnapshot };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireDailySnapshot = api;
})(globalThis);
