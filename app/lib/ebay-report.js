/* ==========================================================================
   ebay-report.js — Parse eBay Seller Hub "Listings sales report" CSVs into
   Side Gig Ledger entries, and merge them in without double counting.
   Pure functions (no DOM/state) so they run in the browser and in Vitest.
   ========================================================================== */
/* global module */

const EBAY_REPORT_COLS = {
    title: 'listing title',
    itemId: 'ebay item id',
    qty: 'quantity sold',
    itemSales: 'item sales',
    shipPaidByBuyer: 'shipping and handling paid by buyer to you',
    sellingCosts: 'total selling costs',
    labelCost: 'shipping labels cost',
};

// "$1,234.50", "($18.42)" (negative), "" -> number
function parseEbayMoney(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return negative ? -n : n;
}

const round2 = (n) => Math.round(n * 100) / 100;

function toIsoDate(text) {
    const t = Date.parse(`${text} UTC`);
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// rows: output of a CSV row parser. Returns null when this isn't an eBay
// listings sales report.
function parseEbayListingsReport(rows) {
    let headerIdx = -1;
    let range = null;
    for (let i = 0; i < rows.length; i++) {
        const first = String(rows[i][0] || '').trim();
        const m = first.match(/^Report for (.+?) to (.+)$/i);
        if (m) {
            const start = toIsoDate(m[1]);
            const end = toIsoDate(m[2]);
            if (start && end) range = { start, end };
        }
        if (
            first.toLowerCase() === EBAY_REPORT_COLS.title &&
            rows[i].some(
                (c) =>
                    String(c).trim().toLowerCase() === EBAY_REPORT_COLS.itemId,
            )
        ) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) return null;

    const header = rows[headerIdx].map((c) => String(c).trim().toLowerCase());
    // Some headers carry a parenthetical suffix, so fall back to a prefix match.
    const col = (name) => {
        const exact = header.indexOf(name);
        return exact >= 0 ? exact : header.findIndex((h) => h.startsWith(name));
    };
    const idx = {};
    for (const [k, name] of Object.entries(EBAY_REPORT_COLS))
        idx[k] = col(name);
    if (idx.itemId < 0 || idx.title < 0) return null;

    const items = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const itemId = String(r[idx.itemId] || '').trim();
        if (!/^\d+$/.test(itemId)) continue;
        const revenue = round2(
            parseEbayMoney(r[idx.itemSales]) +
                parseEbayMoney(r[idx.shipPaidByBuyer]),
        );
        // "Total selling costs" already includes the shipping labels you
        // bought (it's fees + labels − credits, matching eBay's own "Net
        // sales" column), so labels are only counted on their own when the
        // report has no selling-costs column.
        const expenses = round2(
            idx.sellingCosts >= 0
                ? parseEbayMoney(r[idx.sellingCosts])
                : parseEbayMoney(r[idx.labelCost]),
        );
        items.push({
            itemId,
            title: String(r[idx.title] || '').trim() || `eBay item ${itemId}`,
            qty: parseInt(r[idx.qty], 10) || 0,
            revenue,
            expenses,
            net: round2(revenue - expenses),
        });
    }
    return { range, items };
}

const entryRange = (e) =>
    e.reportStart && e.reportEnd ? [e.reportStart, e.reportEnd] : null;

// Merge into a ledger without mutating it.
//  - same item + same report range already imported  -> skipped when the
//    amounts match, otherwise refreshed in place (keeps the tax tag and any
//    item cost you entered)
//  - an older imported range for that item lies inside this report's range
//    (a later, cumulative report) -> replaced by the new row
//  - otherwise (disjoint / partially overlapping ranges) -> added alongside
function mergeEbayReport(ledger, report) {
    if (!report.range) {
        throw new Error('eBay report has no readable date range.');
    }
    const start = report.range?.start || null;
    const end = report.range?.end || null;
    let next = [...(ledger || [])];
    let added = 0;
    let skipped = 0;
    let replaced = 0;
    let updated = 0;
    for (const item of report.items) {
        const id = `ebay-csv-${item.itemId}-${start || 'x'}_${end || 'x'}`;
        const existingIdx = next.findIndex((e) => e.id === id);
        if (existingIdx >= 0) {
            const cur = next[existingIdx];
            if (
                cur.revenue === item.revenue &&
                cur.expenses === item.expenses &&
                cur.qty === item.qty
            ) {
                skipped++;
                continue;
            }
            // Same report re-imported with different amounts (e.g. parsed
            // by an older, buggier version) — refresh the numbers only.
            const costBasis = Number(cur.costBasis) || 0;
            next[existingIdx] = {
                ...cur,
                revenue: item.revenue,
                expenses: item.expenses,
                net: round2(item.revenue - item.expenses - costBasis),
                qty: item.qty,
            };
            updated++;
            continue;
        }
        if (start && end) {
            const before = next.length;
            next = next.filter((e) => {
                if (e.ebayItemId !== item.itemId) return true;
                const r = entryRange(e);
                return !(r && r[0] >= start && r[1] <= end);
            });
            replaced += before - next.length;
        }
        next.push({
            id,
            desc: item.title,
            category: 'eBay',
            revenue: item.revenue,
            expenses: item.expenses,
            net: item.net,
            qty: item.qty,
            ebayItemId: item.itemId,
            reportStart: start,
            reportEnd: end,
        });
        added++;
    }
    return { ledger: next, added, skipped, replaced, updated };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseEbayMoney,
        parseEbayListingsReport,
        mergeEbayReport,
    };
}
