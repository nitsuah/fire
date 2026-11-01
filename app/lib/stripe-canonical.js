/* global module */
'use strict';

const SALE_TYPES = new Set(['charge', 'payment']);
const REFUND_TYPES = new Set(['refund', 'payment_refund', 'adjustment']);
const PAYOUT_TYPES = new Set(['payout', 'payout_cancel', 'payout_failure']);

function toMinorUnits(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function toDollars(minorUnits) {
    return Math.round(minorUnits) / 100;
}

function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateFromCreated(created) {
    if (typeof created !== 'number' && typeof created !== 'string') return null;
    const seconds = Number(created);
    if (!Number.isFinite(seconds) || seconds < 0) return null;

    const date = new Date(seconds * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function skippedRow(transaction, reason) {
    return {
        id: typeof transaction?.id === 'string' ? transaction.id : null,
        type: typeof transaction?.type === 'string' ? transaction.type : null,
        reason,
    };
}

function stripeBalanceTransactionsToEntries(transactions) {
    const entries = [];
    const skipped = [];
    const seen = new Set();

    for (const transaction of Array.isArray(transactions) ? transactions : []) {
        const id = typeof transaction?.id === 'string' ? transaction.id : '';
        const type =
            typeof transaction?.type === 'string' && transaction.type
                ? transaction.type
                : 'unknown';

        if (!id.startsWith('txn_')) {
            skipped.push(skippedRow(transaction, 'invalid_id'));
            continue;
        }
        if (seen.has(id)) {
            skipped.push(skippedRow(transaction, 'duplicate'));
            continue;
        }
        // First occurrence wins, even if it is later skipped as malformed or unsupported.
        seen.add(id);

        if (String(transaction.currency || '').toUpperCase() !== 'USD') {
            skipped.push(skippedRow(transaction, 'non_usd'));
            continue;
        }
        if (PAYOUT_TYPES.has(type)) {
            skipped.push(skippedRow(transaction, 'payout'));
            continue;
        }
        if (
            !SALE_TYPES.has(type) &&
            !REFUND_TYPES.has(type) &&
            type !== 'stripe_fee'
        ) {
            skipped.push(skippedRow(transaction, `unsupported:${type}`));
            continue;
        }

        const date = dateFromCreated(transaction.created);
        if (!date) {
            skipped.push(skippedRow(transaction, 'invalid_created'));
            continue;
        }

        const amount = toMinorUnits(transaction.amount);
        if (amount === null) {
            skipped.push(skippedRow(transaction, 'invalid_amount'));
            continue;
        }
        const fee = toMinorUnits(transaction.fee ?? 0);
        if (fee === null) {
            skipped.push(skippedRow(transaction, 'invalid_fee'));
            continue;
        }

        let gross;
        let fees;
        if (type === 'stripe_fee') {
            gross = 0;
            fees = toDollars(Math.abs(amount));
        } else {
            gross = toDollars(amount);
            if (REFUND_TYPES.has(type)) gross = -Math.abs(gross);
            fees = toDollars(fee);
        }

        const description =
            typeof transaction.description === 'string' &&
            transaction.description.trim()
                ? transaction.description.trim()
                : type;

        entries.push({
            id: `stripe-${id}`,
            platform: 'Stripe',
            date,
            description,
            gross,
            fees,
            net: roundMoney(gross - fees),
            stripeTxnId: id,
            kind: type,
        });
    }

    return { entries, skipped };
}

module.exports = { stripeBalanceTransactionsToEntries };
