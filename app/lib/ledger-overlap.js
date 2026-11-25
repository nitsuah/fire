/* global module */
'use strict';

function parseDateUTC(dateStr) {
    if (typeof dateStr !== 'string') return NaN;
    const iso = dateStr.slice(0, 10);
    const parsed = Date.parse(iso + 'T00:00:00Z');
    return Number.isFinite(parsed) ? parsed : NaN;
}

function daysApart(tsA, tsB) {
    const MS_PER_DAY = 86400000;
    return Math.abs(Math.round((tsA - tsB) / MS_PER_DAY));
}

function findStripeManualOverlapCandidates(ledger, { windowDays = 3 } = {}) {
    if (!Array.isArray(ledger)) return [];

    const stripeRows = [];
    const manualRows = [];

    for (const row of ledger) {
        const id = typeof row?.id === 'string' ? row.id : '';
        const gross = typeof row?.gross === 'number' ? row.gross : NaN;
        const dateStr = typeof row?.date === 'string' ? row.date : '';
        const dateMs = parseDateUTC(dateStr);

        if (!Number.isFinite(gross) || !Number.isFinite(dateMs)) {
            continue;
        }

        if (id.startsWith('stripe-')) {
            stripeRows.push({ id, gross, dateMs });
        } else if (id.startsWith('ebay-') || id.startsWith('etsy-')) {
            continue;
        } else if (id) {
            manualRows.push({ id, gross, dateMs });
        }
    }

    const candidates = [];
    for (const stripe of stripeRows) {
        for (const manual of manualRows) {
            const grossMatch =
                Math.sign(stripe.gross) === Math.sign(manual.gross) &&
                Math.round(stripe.gross * 100) ===
                    Math.round(manual.gross * 100);
            if (!grossMatch) continue;

            const dApart = daysApart(stripe.dateMs, manual.dateMs);
            if (dApart > windowDays) continue;

            candidates.push({
                stripeId: stripe.id,
                manualId: manual.id,
                gross: stripe.gross,
                daysApart: dApart,
            });
        }
    }

    candidates.sort((a, b) => {
        if (a.daysApart !== b.daysApart) return a.daysApart - b.daysApart;
        if (a.stripeId !== b.stripeId)
            return a.stripeId.localeCompare(b.stripeId);
        return a.manualId.localeCompare(b.manualId);
    });

    const usedManual = new Set();
    const accepted = [];
    for (const c of candidates) {
        if (usedManual.has(c.manualId)) continue;
        usedManual.add(c.manualId);
        accepted.push(c);
    }

    accepted.sort((a, b) => {
        if (a.stripeId !== b.stripeId)
            return a.stripeId.localeCompare(b.stripeId);
        return a.manualId.localeCompare(b.manualId);
    });

    return accepted;
}

module.exports = { findStripeManualOverlapCandidates };
