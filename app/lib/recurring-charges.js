'use strict';

/* ==========================================================================
   recurring-charges.js — Detect subscriptions and bills from the spending
   transactions the app already stores. Pure functions (no DOM/state) so the
   MCP server and Vitest can both use it; there is no subscriptions model
   and this does not add one — it infers recurrence from charge history.

   A merchant counts as recurring when it has enough charges at a steady
   interval to rule out coincidence:
     monthly — 3+ charges ~30 days apart
     weekly  — 3+ charges ~7 days apart
     annual  — 2+ charges ~365 days apart
   Amounts must agree within AMOUNT_TOLERANCE, so a price rise is still the
   same subscription but an unrelated charge at the same merchant is not.
   ========================================================================== */
/* global module */

const DAY_MS = 24 * 60 * 60 * 1000;

// Median gap each cadence accepts, in days.
const CADENCES = [
    { name: 'weekly', min: 5, max: 9, minCharges: 3 },
    { name: 'monthly', min: 24, max: 35, minCharges: 3 },
    { name: 'annual', min: 330, max: 400, minCharges: 2 },
];

// A price change up to this fraction of the median keeps the same series.
const AMOUNT_TOLERANCE = 0.1;

const CHARGES_PER_YEAR = { weekly: 52, monthly: 12, annual: 1 };

const round2 = (n) => Math.round(n * 100) / 100;

// Merchant strings carry per-store noise ("NETFLIX.COM 866-579-7172",
// "AMZN Mktp US*2K4LM9"), so group on a stripped, lowercased form: drop
// punctuation and any token that mixes in digits and runs 4+ characters.
// Short numbers ("7 Eleven", "24 Hour Fitness") survive.
const isNoiseToken = (tok) =>
    /\d/.test(tok) && (tok.length >= 4 || /^\d{3,}$/.test(tok));

function normalizeMerchant(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9&]+/g, ' ')
        .split(' ')
        .filter((tok) => tok && !isNoiseToken(tok))
        .join(' ');
}

const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Transactions carry either Plaid's `YYYY-MM-DD` or a CSV locale date like
// `9/20/2026 02:20 AM`, so compare parsed instants, never string prefixes.
const toTime = (d) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : t;
};

const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

function detectRecurringCharges(transactions, { now = Date.now() } = {}) {
    const groups = new Map();
    for (const txn of transactions || []) {
        if (!txn || typeof txn !== 'object') continue;
        const amount = Number(txn.amount);
        const t = toTime(txn.date);
        const merchant = normalizeMerchant(txn.merchant);
        // Refunds and credits are negative or zero here; a subscription is
        // an outgoing charge.
        if (!merchant || !Number.isFinite(amount) || amount <= 0) continue;
        if (t === null) continue;
        if (!groups.has(merchant)) groups.set(merchant, []);
        groups.get(merchant).push({
            t,
            amount,
            merchant: String(txn.merchant).trim(),
            category: txn.category || 'Other',
        });
    }

    const charges = [];
    for (const series of groups.values()) {
        if (series.length < 2) continue;
        series.sort((a, b) => a.t - b.t);

        const amounts = series.map((c) => c.amount);
        const typicalAmount = median(amounts);
        if (typicalAmount <= 0) continue;
        // Drop outliers so one unrelated big charge doesn't stretch the gaps.
        const kept = series.filter(
            (c) =>
                Math.abs(c.amount - typicalAmount) / typicalAmount <=
                AMOUNT_TOLERANCE,
        );
        if (kept.length < 2) continue;

        const gaps = [];
        for (let i = 1; i < kept.length; i++) {
            gaps.push((kept[i].t - kept[i - 1].t) / DAY_MS);
        }
        const gap = median(gaps);
        const cadence = CADENCES.find(
            (c) => gap >= c.min && gap <= c.max && kept.length >= c.minCharges,
        );
        if (!cadence) continue;

        const last = kept[kept.length - 1];
        const nextT = last.t + gap * DAY_MS;
        charges.push({
            merchant: last.merchant,
            category: last.category,
            cadence: cadence.name,
            typicalAmount: round2(median(kept.map((c) => c.amount))),
            lastDate: isoDate(last.t),
            nextExpectedDate: isoDate(nextT),
            daysUntilNext: Math.round((nextT - now) / DAY_MS),
            monthlyEquivalent: round2(
                (median(kept.map((c) => c.amount)) *
                    CHARGES_PER_YEAR[cadence.name]) /
                    12,
            ),
            occurrences: kept.length,
        });
    }

    charges.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
    return {
        charges,
        count: charges.length,
        monthlyTotal: round2(
            charges.reduce((s, c) => s + c.monthlyEquivalent, 0),
        ),
        annualTotal: round2(
            charges.reduce((s, c) => s + c.monthlyEquivalent * 12, 0),
        ),
    };
}

module.exports = {
    AMOUNT_TOLERANCE,
    CADENCES,
    detectRecurringCharges,
    normalizeMerchant,
};
