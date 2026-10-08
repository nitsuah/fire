/* ==========================================================================
   marketplace-reports.js — Import sales exports from marketplaces that have
   no public seller API (Mercari, Poshmark, Facebook Marketplace) into the
   Side Gig Ledger, without double counting.

   Each platform is recognised by sniffing its header row, and every column
   is looked up through a list of aliases, because none of these exports is
   documented and their headers drift. The assumed columns are listed in
   docs/integrations.md ("Mercari, Poshmark and FB Marketplace CSV import").

   Pure functions (no DOM/state) so they run in the browser and in Vitest.
   Names carry an `mr` prefix: browser scripts share one global scope.
   ========================================================================== */
/* global module */

// Lower-case, punctuation to spaces, collapsed: "Item Price ($)" -> "item price".
function mrNorm(h) {
    return String(h == null ? '' : h)
        .replace(/^\uFEFF/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// "$1,234.50", "($18.42)", "-3.00", "" -> number
function mrMoney(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^\$/, ''));
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return negative ? -n : n;
}

const mrRound2 = (n) => Math.round(n * 100) / 100;

// "03/14/2026", "3/14/26", "2026-03-14", "2026-03-14T10:00:00Z",
// "Mar 14, 2026" -> "2026-03-14"; anything else -> null.
function mrDate(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    const t = Date.parse(`${s} UTC`);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    const t2 = Date.parse(s);
    return Number.isNaN(t2) ? null : new Date(t2).toISOString().slice(0, 10);
}

// FNV-1a, hex. Stable across runtimes; used only for rows with no order id.
function mrHash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// Index of the first header matching any alias: exact first, then prefix
// (exports append things like "(USD)" or "charged to seller").
function mrCol(header, aliases) {
    for (const a of aliases) {
        const i = header.indexOf(a);
        if (i >= 0) return i;
    }
    for (const a of aliases) {
        const i = header.findIndex((h) => h.startsWith(a));
        if (i >= 0) return i;
    }
    return -1;
}

// Assumed columns per platform. `id`/`title`/`date` and the money columns
// are optional unless listed in `required`; `sniff` decides whether a
// header row belongs to this platform.
const MR_PLATFORMS = {
    mercari: {
        category: 'Mercari',
        idPrefix: 'mercari',
        cols: {
            id: ['item id', 'order id', 'transaction id', 'item number'],
            title: ['item title', 'item name', 'title'],
            date: [
                'sold date',
                'completed date',
                'order date',
                'sale date',
                'date',
            ],
            itemPrice: ['item price', 'sale price', 'sold price', 'price'],
            buyerShipping: [
                'buyer shipping fee',
                'shipping paid by buyer',
                'buyer shipping',
            ],
            sellerShipping: [
                'seller shipping fee',
                'shipping label',
                'shipping fee',
                'seller shipping',
            ],
            sellingFee: ['mercari selling fee', 'selling fee', 'mercari fee'],
            processingFee: [
                'payment processing fee charged to seller',
                'payment processing fee',
                'processing fee',
            ],
            adjustmentFee: ['shipping adjustment fee'],
            penaltyFee: ['penalty fee'],
            net: ['net seller proceeds', 'net proceeds', 'net earnings', 'net'],
            status: ['order status', 'status'],
            canceled: ['canceled date', 'cancelled date'],
        },
        required: ['itemPrice'],
        sniff: (header) =>
            header.some((h) => h.includes('mercari')) ||
            header.includes('net seller proceeds'),
    },
    poshmark: {
        category: 'Poshmark',
        idPrefix: 'poshmark',
        cols: {
            id: ['order id', 'order number', 'order no'],
            title: ['listing title', 'item title', 'title', 'item'],
            date: ['order date', 'sold date', 'sale date', 'date'],
            itemPrice: ['order price', 'sale price', 'sold price', 'price'],
            sellingFee: ['poshmark fee', 'commission', 'selling fee'],
            shippingDiscount: ['seller shipping discount', 'shipping discount'],
            upgradedLabel: [
                'upgraded shipping label fee',
                'upgraded shipping fee',
            ],
            net: ['net earnings', 'net amount', 'earnings', 'net'],
            status: ['order status', 'status'],
        },
        required: ['itemPrice'],
        sniff: (header) =>
            header.some((h) => h.includes('poshmark')) ||
            (header.includes('net earnings') &&
                header.some((h) => h.startsWith('order'))),
    },
    fb: {
        category: 'FB Marketplace',
        idPrefix: 'fb',
        cols: {
            id: ['order id', 'order number', 'transaction id'],
            title: ['item', 'item title', 'listing title', 'title'],
            date: ['date', 'sold date', 'sale date'],
            itemPrice: ['sale price', 'item price', 'price'],
            buyerShipping: ['shipping charged', 'buyer shipping'],
            sellingFee: ['fb fees', 'fees', 'selling fee'],
            sellerShipping: ['shipping cost', 'shipping label'],
            costBasis: ['item cost', 'cost basis', 'cost'],
            basisType: ['tax tag', 'basis type'],
        },
        required: ['itemPrice', 'title', 'date'],
        // The template we ship (app/templates/fb-marketplace-sales.csv); its
        // headers are generic, so it's tried last.
        sniff: (header) =>
            header.includes('sale price') &&
            header.includes('item') &&
            header.includes('date'),
    },
};

const MR_ORDER = ['mercari', 'poshmark', 'fb'];
const MR_SKIP_STATUS = /cancel|refund|return|void/;
const MR_BASIS = new Set(['business', 'personal', 'gift', 'free']);

// Fee schedule fallbacks when an export has neither fee nor net columns.
function mrPoshmarkFee(price) {
    const p = price || 0;
    if (p <= 0) return 0;
    return p < 15 ? 2.95 : p * 0.2;
}

function mrBuildEntry(platform, get, idRaw, occurrence) {
    const cfg = MR_PLATFORMS[platform];
    const itemPrice = mrMoney(get('itemPrice'));
    const buyerShipping = mrMoney(get('buyerShipping'));
    const revenue = mrRound2(itemPrice + buyerShipping);
    const net = get('net');
    let expenses;
    let feesEstimated = false;
    if (platform === 'mercari') {
        const parts = [
            'sellingFee',
            'processingFee',
            'sellerShipping',
            'adjustmentFee',
            'penaltyFee',
        ].map((k) => Math.abs(mrMoney(get(k))));
        const hasFeeCols = ['sellingFee', 'processingFee'].some(
            (k) => get(k) !== undefined,
        );
        if (hasFeeCols) expenses = parts.reduce((a, b) => a + b, 0);
        else if (net !== undefined) expenses = revenue - mrMoney(net);
        else {
            expenses = revenue * 0.1 + parts[2];
            feesEstimated = true;
        }
    } else if (platform === 'poshmark') {
        const extras =
            Math.abs(mrMoney(get('shippingDiscount'))) +
            Math.abs(mrMoney(get('upgradedLabel')));
        if (get('sellingFee') !== undefined)
            expenses = Math.abs(mrMoney(get('sellingFee'))) + extras;
        else if (net !== undefined) expenses = revenue - mrMoney(net);
        else {
            expenses = mrPoshmarkFee(itemPrice) + extras;
            feesEstimated = true;
        }
    } else {
        expenses =
            Math.abs(mrMoney(get('sellingFee'))) +
            Math.abs(mrMoney(get('sellerShipping')));
    }
    expenses = mrRound2(Math.max(0, expenses));

    const title = String(get('title') || '').trim();
    const date = mrDate(get('date'));
    const orderId = String(idRaw || '').trim();
    const id = orderId
        ? `${cfg.idPrefix}-${orderId}`
        : `${cfg.idPrefix}-csv-${mrHash(`${date}|${title}|${revenue}`)}-${occurrence}`;
    const entry = {
        id,
        ...(date ? { date } : {}),
        desc: title || `${cfg.category} sale`,
        category: cfg.category,
        revenue,
        expenses,
        net: mrRound2(revenue - expenses),
        source: 'csv',
        ...(orderId ? { marketplaceOrderId: orderId } : {}),
        ...(feesEstimated ? { feesEstimated: true } : {}),
    };
    const costRaw = get('costBasis');
    if (costRaw !== undefined && String(costRaw).trim() !== '') {
        entry.costBasis = mrRound2(Math.abs(mrMoney(costRaw)));
        entry.net = mrRound2(entry.net - entry.costBasis);
    }
    const basis = String(get('basisType') || '')
        .trim()
        .toLowerCase();
    if (MR_BASIS.has(basis)) entry.basisType = basis;
    return entry;
}

// rows: output of a CSV row parser (parseCSVText). Returns
// {platform, category, entries, skipped} or null when no supported header
// row is found in the first 10 rows (exports sometimes carry a preamble).
function parseMarketplaceReport(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const header = (rows[r] || []).map(mrNorm);
        for (const platform of MR_ORDER) {
            const cfg = MR_PLATFORMS[platform];
            if (!cfg.sniff(header)) continue;
            const idx = {};
            for (const [k, aliases] of Object.entries(cfg.cols))
                idx[k] = mrCol(header, aliases);
            if (cfg.required.some((k) => idx[k] < 0)) continue;
            return mrParseRows(platform, rows.slice(r + 1), idx);
        }
    }
    return null;
}

function mrParseRows(platform, dataRows, idx) {
    const cfg = MR_PLATFORMS[platform];
    const entries = [];
    const seen = new Map();
    let skipped = 0;
    for (const row of dataRows) {
        if (!row || row.every((c) => String(c).trim() === '')) continue;
        const get = (k) => (idx[k] >= 0 ? row[idx[k]] : undefined);
        const status = mrNorm(get('status'));
        const canceled = String(get('canceled') || '').trim();
        if (MR_SKIP_STATUS.test(status) || canceled) {
            skipped++;
            continue;
        }
        const priceCell = String(get('itemPrice') || '').trim();
        if (!priceCell || !/\d/.test(priceCell)) {
            skipped++;
            continue;
        }
        // Rows without an order id are told apart by content; identical
        // rows in one file get an occurrence number so re-importing the
        // same file still maps every row to the same id.
        const key = `${get('date')}|${get('title')}|${priceCell}`;
        const occurrence = (seen.get(key) || 0) + 1;
        seen.set(key, occurrence);
        entries.push(mrBuildEntry(platform, get, get('id'), occurrence));
    }
    return { platform, category: cfg.category, entries, skipped };
}

// Merge into a ledger without mutating it; rows whose id is already there
// are skipped, so the same export can be uploaded again safely and any tax
// tag or cost entered on an imported row is kept.
function mergeMarketplaceEntries(ledger, entries) {
    const next = [...(ledger || [])];
    const ids = new Set(next.map((e) => e.id));
    let added = 0;
    let skipped = 0;
    for (const entry of entries || []) {
        if (ids.has(entry.id)) {
            skipped++;
            continue;
        }
        next.push(entry);
        ids.add(entry.id);
        added++;
    }
    return { ledger: next, added, skipped };
}

const MR_FB_TEMPLATE_HEADER =
    'Date,Item,Sale Price,Shipping Charged,FB Fees,Shipping Cost,Item Cost,Tax Tag,Order ID';

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MR_PLATFORMS,
        MR_FB_TEMPLATE_HEADER,
        mrMoney,
        mrDate,
        mrPoshmarkFee,
        parseMarketplaceReport,
        mergeMarketplaceEntries,
    };
}
