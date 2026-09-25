/* ==========================================================================
   side-gig-tax.js — Tag Side Gig Ledger sales by how the item was acquired
   (bought to resell, personal, gift, free) and roll them up into a rough
   tax picture. Pure functions (no DOM/state) so they run in the browser,
   the MCP server, and Vitest.

   General rules this encodes (a planning aid, not tax advice):
   - business: resale/side-business income. Profit is taxable, and a loss
     offsets it (Schedule C).
   - personal / gift: selling your own stuff. A gain over what it cost is
     taxable; a loss is not deductible (and isn't income either). A gift's
     basis is generally what the giver paid.
   - free: acquired for nothing (e.g. equipment an employer let you keep),
     so basis is $0 and the proceeds after selling costs are a gain.
   ========================================================================== */
/* global module */

const SIDE_GIG_BASIS_TYPES = {
    business: "Business / bought to resell",
    personal: "Personal item",
    gift: "Gift (giver's cost)",
    free: "Free / $0 cost",
};

// round2 is defined in ebay-report.js (loads first); reuse it to avoid redeclaration error

function isBasisType(t) {
    return Object.prototype.hasOwnProperty.call(SIDE_GIG_BASIS_TYPES, t);
}

// First value that is a finite number; blank strings count as absent.
function firstNumber(...values) {
    for (const v of values) {
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

// Legacy entries were written with platform/gross/fees field names.
function saleAmounts(entry) {
    return {
        revenue: firstNumber(entry.revenue, entry.gross) ?? 0,
        sellingCosts: firstNumber(entry.expenses, entry.fees) ?? 0,
        costBasis: firstNumber(entry.costBasis),
    };
}

// YYYY-MM-DD in local time, so a late-evening sale keeps its calendar year.
function localIsoDate(d = new Date()) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Rows the eBay calculator wrote before costBasis was split out carry the
// item cost inside `expenses`.
function isLegacyCalculatorRow(entry) {
    return (
        entry.category === 'eBay' &&
        /^eBay Sale: \$/.test(entry.desc || '') &&
        !('costBasis' in entry)
    );
}

// Returns a copy of `entry` with its cost basis set (blank = unknown). For
// legacy calculator rows the same amount is moved out of `expenses` exactly
// once, and moved back if the basis is changed or cleared.
function applyCostBasis(entry, value) {
    const next = { ...entry };
    const legacy =
        'legacyCostInExpenses' in next || isLegacyCalculatorRow(next);
    if ('legacyCostInExpenses' in next) {
        next.expenses = round2(
            (firstNumber(next.expenses) ?? 0) + next.legacyCostInExpenses,
        );
        delete next.legacyCostInExpenses;
    }
    const basis = firstNumber(value);
    if (basis === null) {
        delete next.costBasis;
    } else {
        next.costBasis = basis;
        if (legacy) {
            const expenses = firstNumber(next.expenses) ?? 0;
            const moved = Math.min(basis, expenses);
            next.expenses = round2(expenses - moved);
            next.legacyCostInExpenses = moved;
        }
    }
    const { revenue, sellingCosts } = saleAmounts(next);
    next.net = round2(revenue - sellingCosts - (next.costBasis || 0));
    return next;
}

// ISO date -> year; falls back to the eBay report range or a Date.now() id.
function entryYear(entry) {
    const iso = entry.date || entry.reportEnd || entry.reportStart;
    if (iso && /^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
    const ms = Number(entry.id);
    if (Number.isFinite(ms) && ms > 1e12) return new Date(ms).getUTCFullYear();
    return null;
}

// Returns the tax treatment for one ledger entry. `taxable` is null when it
// can't be computed yet (untagged, or a personal/gift sale with no cost).
function classifySideGigSale(entry) {
    const basisType = isBasisType(entry.basisType) ? entry.basisType : null;
    const { revenue, sellingCosts, costBasis } = saleAmounts(entry);
    const out = {
        basisType,
        revenue: round2(revenue),
        sellingCosts: round2(sellingCosts),
        costBasis: costBasis === null ? null : round2(costBasis),
        gain: null,
        taxable: null,
        needsBasis: false,
    };
    if (!basisType) return out;

    const basis =
        basisType === 'free'
            ? 0
            : basisType === 'business'
              ? costBasis || 0
              : costBasis;
    if (basis === null) {
        out.needsBasis = true;
        return out;
    }
    const gain = round2(revenue - sellingCosts - basis);
    out.gain = gain;
    out.taxable = basisType === 'business' ? gain : Math.max(0, gain);
    return out;
}

// Roll a ledger up by tax treatment. Pass { year } to limit to one year
// (entries with no readable date are only included when no year is given).
function summarizeSideGigTax(ledger, { year } = {}) {
    const bucket = () => ({ count: 0, revenue: 0 });
    const summary = {
        year: year ?? null,
        business: { ...bucket(), sellingCosts: 0, costBasis: 0, net: 0 },
        personalSales: {
            ...bucket(),
            taxableGains: 0,
            nonDeductibleLosses: 0,
        },
        needsCostBasis: bucket(),
        untagged: bucket(),
        estimatedTaxableIncome: 0,
        note: 'Planning estimate only, not tax advice. Personal/gift sales below cost are neither income nor deductible; confirm with a CPA.',
    };

    for (const entry of ledger || []) {
        if (year != null && entryYear(entry) !== year) continue;
        const c = classifySideGigSale(entry);
        let b;
        if (!c.basisType) b = summary.untagged;
        else if (c.needsBasis) b = summary.needsCostBasis;
        else if (c.basisType === 'business') {
            b = summary.business;
            b.sellingCosts += c.sellingCosts;
            b.costBasis += c.costBasis || 0;
            b.net += c.taxable;
        } else {
            b = summary.personalSales;
            b.taxableGains += c.taxable;
            if (c.gain < 0) b.nonDeductibleLosses += -c.gain;
        }
        b.count++;
        b.revenue += c.revenue;
    }

    for (const b of [
        summary.business,
        summary.personalSales,
        summary.needsCostBasis,
        summary.untagged,
    ]) {
        for (const k of Object.keys(b)) {
            if (k !== 'count') b[k] = round2(b[k]);
        }
    }
    summary.estimatedTaxableIncome = round2(
        summary.business.net + summary.personalSales.taxableGains,
    );
    return summary;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SIDE_GIG_BASIS_TYPES,
        saleAmounts,
        localIsoDate,
        applyCostBasis,
        classifySideGigSale,
        summarizeSideGigTax,
        entryYear,
    };
}

// Make functions globally available for browser scripts
if (typeof window !== 'undefined') {
    window.SIDE_GIG_BASIS_TYPES = SIDE_GIG_BASIS_TYPES;
    window.saleAmounts = saleAmounts;
    window.localIsoDate = localIsoDate;
    window.applyCostBasis = applyCostBasis;
    window.classifySideGigSale = classifySideGigSale;
    window.summarizeSideGigTax = summarizeSideGigTax;
    window.entryYear = entryYear;
}