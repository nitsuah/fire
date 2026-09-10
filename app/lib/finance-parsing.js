'use strict';

/* ==========================================================================
   finance-parsing.js — CSV parsing helpers for Fidelity, Chase, CapOne
   CommonJS module — require()'d by finance-core.js
   ========================================================================== */

function parseCSVText(text) {
    const lines = [];
    let row = [''];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    return lines;
}

function parseFidelityPositions(rows) {
    const headers = rows[0].map((h) => h.trim());

    const idxAccountName = headers.findIndex(
        (h) => h.toLowerCase() === 'account name',
    );
    const idxSymbol = headers.findIndex((h) => h.toLowerCase() === 'symbol');
    const idxDescription = headers.findIndex(
        (h) => h.toLowerCase() === 'description',
    );
    const idxQuantity = headers.findIndex(
        (h) => h.toLowerCase() === 'quantity',
    );
    const idxLastPrice = headers.findIndex(
        (h) => h.toLowerCase() === 'last price',
    );
    const idxCurrentValue = headers.findIndex(
        (h) => h.toLowerCase() === 'current value',
    );
    const idxCostBasis = headers.findIndex(
        (h) => h.toLowerCase() === 'cost basis total',
    );
    const idxGainLossDollar = headers.findIndex(
        (h) =>
            h.toLowerCase().includes('gain/loss dollar') &&
            !h.toLowerCase().includes('today'),
    );
    const idxGainLossPercent = headers.findIndex(
        (h) =>
            h.toLowerCase().includes('gain/loss percent') &&
            !h.toLowerCase().includes('today'),
    );

    if (idxSymbol === -1 || idxCurrentValue === -1)
        return { positions: [], count: 0 };

    let importedCount = 0;
    const positions = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;

        const sym = (row[idxSymbol] || '').trim();
        const rawVal = (row[idxCurrentValue] || '').trim();

        if (!sym || (sym.includes('*') && rawVal === '')) continue;
        if (
            row[0] &&
            (row[0].toLowerCase().includes('the data') ||
                row[0].toLowerCase().includes('brokerage services'))
        ) {
            break;
        }

        const cleanedValue = parseFloat(rawVal.replace(/[^0-9.-]/g, ''));
        const qty = parseFloat(
            (row[idxQuantity] || '0').replace(/[^0-9.-]/g, ''),
        );
        const price = parseFloat(
            (row[idxLastPrice] || '0').replace(/[^0-9.-]/g, ''),
        );
        const basis = parseFloat(
            (row[idxCostBasis] || '0').replace(/[^0-9.-]/g, ''),
        );

        const rawGainDollar = row[idxGainLossDollar] || '';
        const rawGainPercent = row[idxGainLossPercent] || '';
        const gainDollar =
            parseFloat(rawGainDollar.replace(/[^0-9.-]/g, '')) || 0;
        const gainPercent =
            parseFloat(rawGainPercent.replace(/[^0-9.-]/g, '')) || 0;

        if (isNaN(cleanedValue)) continue;

        const cleanBasis = isNaN(basis) ? 0 : basis;
        const finalGainDollar =
            gainDollar || (cleanBasis > 0 ? cleanedValue - cleanBasis : 0);
        const finalGainPercent =
            gainPercent ||
            (cleanBasis > 0
                ? ((cleanedValue - cleanBasis) / cleanBasis) * 100
                : 0);

        positions.push({
            account: row[idxAccountName] || 'Brokerage',
            symbol: sym,
            description: row[idxDescription] || '',
            quantity: isNaN(qty) ? 0 : qty,
            lastPrice: isNaN(price) ? 0 : price,
            value: cleanedValue,
            costBasis: cleanBasis,
            pnlDollar: finalGainDollar,
            pnlPercent: finalGainPercent,
        });
        importedCount++;
    }

    return { positions, count: importedCount };
}

// Maps Chase/CapOne category labels → our expense bucket keys
const CHASE_CATEGORY_MAP = {
    automotive: 'transport',
    'bills & utilities': 'utilities',
    'food & drink': 'food',
    gas: 'transport',
    groceries: 'food',
    'health & wellness': 'healthcare',
    medical: 'healthcare',
    home: 'housing',
    travel: 'transport',
    entertainment: 'discretionary',
    shopping: 'discretionary',
    personal: 'discretionary',
    'fees & adjustments': 'discretionary',
    'professional services': 'discretionary',
    education: 'discretionary',
    charity: 'discretionary',
};

const CAPITALONE_CATEGORY_MAP = {
    'grocery store/supermarket': 'food',
    restaurant: 'food',
    'fast food': 'food',
    'other food & beverage': 'food',
    'coffee shops': 'food',
    'gas/automobile': 'transport',
    automotive: 'transport',
    'taxi/ride shares': 'transport',
    utilities: 'utilities',
    'phone/cable': 'utilities',
    internet: 'utilities',
    'health care': 'healthcare',
    dentist: 'healthcare',
    pharmacy: 'healthcare',
    doctor: 'healthcare',
    'rent payment': 'housing',
    'home improvement': 'housing',
    'hotel/resort': 'discretionary',
    entertainment: 'discretionary',
    merchandise: 'discretionary',
    clothing: 'discretionary',
    'online shopping': 'discretionary',
    travel: 'transport',
};

const FALLBACK_KEYWORD_MAP = [
    {
        keys: [
            'rent',
            'lease',
            'mortgage',
            'hoa',
            'apartment',
            'property mgmt',
        ],
        cat: 'housing',
    },
    {
        keys: [
            'electric',
            'water bill',
            'gas company',
            'internet',
            'comcast',
            'xfinity',
            'spectrum',
            'at&t',
            'verizon fios',
            't-mobile',
            'tmobile',
            'cox ',
            'frontier',
        ],
        cat: 'utilities',
    },
    {
        keys: [
            'grocery',
            'safeway',
            'kroger',
            'trader joe',
            'whole foods',
            'aldi',
            'publix',
            'costco',
            'walmart',
            'food lion',
            'stop & shop',
            'giant',
            'meijer',
            'heb ',
            'wegman',
            'stater bros',
            'restaurant',
            'pizza',
            'burger',
            'mcdonald',
            'chipotle',
            'taco bell',
            'subway',
            'starbucks',
            'dunkin',
            'panera',
            'chick-fil',
            'doordash',
            'grubhub',
            'ubereats',
            'instacart',
        ],
        cat: 'food',
    },
    {
        keys: [
            'shell ',
            'exxon',
            'bp ',
            'chevron',
            'mobil ',
            'sunoco',
            'speedway',
            'wawa ',
            'gas station',
            'fuel',
            'uber ',
            'lyft ',
            'parking',
            'toll',
            'ez pass',
            'metro card',
            'auto repair',
            'jiffy lube',
            'firestone',
            'valvoline',
            'car wash',
            'pep boys',
            "o'reilly",
            'advance auto',
        ],
        cat: 'transport',
    },
    {
        keys: [
            'pharmacy',
            'cvs ',
            'walgreens',
            'rite aid',
            'hospital',
            'medical',
            'dental',
            'vision',
            'kaiser',
            'labcorp',
            'quest diag',
            'urgent care',
        ],
        cat: 'healthcare',
    },
];

function _descToCategory(desc) {
    const lower = desc.toLowerCase();
    for (const { keys, cat } of FALLBACK_KEYWORD_MAP) {
        if (keys.some((k) => lower.includes(k))) return cat;
    }
    return 'discretionary';
}

function _parseDateRange(dates) {
    if (!dates.length) return 1;
    const ts = dates.map((d) => new Date(d).getTime()).filter((t) => !isNaN(t));
    if (ts.length < 2) return 1;
    const rangeMs = Math.max(...ts) - Math.min(...ts);
    const months = Math.max(
        1,
        Math.round(rangeMs / (1000 * 60 * 60 * 24 * 30.44)),
    );
    return months;
}

function parseChaseStatement(rows) {
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxDate = headers.findIndex((h) => h.includes('transaction date'));
    const idxDesc = headers.findIndex((h) => h.includes('description'));
    const idxCat = headers.findIndex((h) => h === 'category');
    const idxAmt = headers.findIndex((h) => h === 'amount');

    if (idxAmt === -1)
        return { imported: 0, totalOutflow: 0, categories: {}, months: 1 };

    const cats = {
        housing: 0,
        utilities: 0,
        food: 0,
        transport: 0,
        healthcare: 0,
        discretionary: 0,
    };
    const dates = [];
    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 3) continue;
        const amount = parseFloat(row[idxAmt]);
        if (isNaN(amount) || amount >= 0) continue;
        const charge = Math.abs(amount);
        imported++;
        if (idxDate !== -1 && row[idxDate]) dates.push(row[idxDate]);
        const rawCat =
            idxCat !== -1 ? (row[idxCat] || '').toLowerCase().trim() : '';
        const mappedCat = CHASE_CATEGORY_MAP[rawCat];
        if (mappedCat) {
            cats[mappedCat] += charge;
        } else {
            const desc = idxDesc !== -1 ? row[idxDesc] || '' : '';
            cats[_descToCategory(desc)] += charge;
        }
    }

    const months = _parseDateRange(dates);
    const totalOutflow = Object.values(cats).reduce((s, v) => s + v, 0);
    return { imported, totalOutflow, categories: cats, months };
}

function parseCapitalOneStatement(rows) {
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxDate = headers.findIndex((h) => h.includes('transaction date'));
    const idxDesc = headers.findIndex((h) => h.includes('description'));
    const idxCat = headers.findIndex((h) => h === 'category');
    const idxDebit = headers.indexOf('debit');

    if (idxDebit === -1)
        return { imported: 0, totalOutflow: 0, categories: {}, months: 1 };

    const cats = {
        housing: 0,
        utilities: 0,
        food: 0,
        transport: 0,
        healthcare: 0,
        discretionary: 0,
    };
    const dates = [];
    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= idxDebit) continue;
        const debit = parseFloat(row[idxDebit]);
        if (isNaN(debit) || debit <= 0) continue;
        imported++;
        if (idxDate !== -1 && row[idxDate]) dates.push(row[idxDate]);
        const rawCat =
            idxCat !== -1 ? (row[idxCat] || '').toLowerCase().trim() : '';
        let mapped = null;
        for (const [key, val] of Object.entries(CAPITALONE_CATEGORY_MAP)) {
            if (rawCat.includes(key)) {
                mapped = val;
                break;
            }
        }
        if (mapped) {
            cats[mapped] += debit;
        } else {
            const desc = idxDesc !== -1 ? row[idxDesc] || '' : '';
            cats[_descToCategory(desc)] += debit;
        }
    }

    const months = _parseDateRange(dates);
    const totalOutflow = Object.values(cats).reduce((s, v) => s + v, 0);
    return { imported, totalOutflow, categories: cats, months };
}

// ─── Per-transaction spending import (Expenses tab CSV upload) ────────────
// Unlike parseChaseStatement/parseCapitalOneStatement above (which only
// return aggregated category totals for the budget sliders), this keeps one
// record per row so it can populate an editable/deletable transaction table.

function _sniffSpendingFormat(headerRowStr) {
    if (
        headerRowStr.includes('transaction date') &&
        headerRowStr.includes('amount') &&
        (headerRowStr.includes('memo') || headerRowStr.includes('description'))
    ) {
        return 'chase';
    }
    if (
        headerRowStr.includes('card no.') &&
        headerRowStr.includes('debit') &&
        headerRowStr.includes('credit')
    ) {
        return 'capitalone';
    }
    return 'generic';
}

// User-provided merchant-keyword → category overrides always win over the
// statement's own category column and the built-in fallback keyword map.
function matchMerchantOverride(merchant, overrides) {
    if (!overrides) return null;
    const lower = (merchant || '').toLowerCase();
    for (const [keyword, cat] of Object.entries(overrides)) {
        if (keyword && lower.includes(keyword.toLowerCase())) return cat;
    }
    return null;
}

function parseSpendingTransactions(rows, overrides = {}) {
    if (!rows || rows.length < 2) return [];
    const headerRowStr = rows[0].join(',').toLowerCase();
    const format = _sniffSpendingFormat(headerRowStr);
    const headers = rows[0].map((h) => h.trim().toLowerCase());

    const findIdx = (candidates) =>
        headers.findIndex((h) => candidates.some((c) => h.includes(c)));
    const idxDate = findIdx(['transaction date', 'date']);
    const idxDesc = findIdx(['description', 'memo', 'merchant', 'payee']);
    const idxCat = headers.findIndex((h) => h === 'category');
    const idxAmount = headers.findIndex((h) => h === 'amount');
    const idxDebit = headers.indexOf('debit');

    const txns = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;

        let amount = null;
        if (format === 'chase' && idxAmount !== -1) {
            const raw = parseFloat(row[idxAmount]);
            if (isNaN(raw) || raw >= 0) continue; // only outflows are spending
            amount = Math.abs(raw);
        } else if (format === 'capitalone' && idxDebit !== -1) {
            const raw = parseFloat(row[idxDebit]);
            if (isNaN(raw) || raw <= 0) continue;
            amount = raw;
        } else {
            const raw = idxAmount !== -1 ? parseFloat(row[idxAmount]) : NaN;
            if (isNaN(raw) || raw === 0) continue;
            amount = Math.abs(raw);
        }

        const merchant = idxDesc !== -1 ? (row[idxDesc] || '').trim() : '';
        if (!merchant) continue;
        const date = idxDate !== -1 ? (row[idxDate] || '').trim() : '';
        const rawCat =
            idxCat !== -1 ? (row[idxCat] || '').toLowerCase().trim() : '';

        let category = matchMerchantOverride(merchant, overrides);
        if (!category && format === 'chase' && CHASE_CATEGORY_MAP[rawCat]) {
            category = CHASE_CATEGORY_MAP[rawCat];
        }
        if (!category && format === 'capitalone') {
            for (const [key, val] of Object.entries(CAPITALONE_CATEGORY_MAP)) {
                if (rawCat.includes(key)) {
                    category = val;
                    break;
                }
            }
        }
        if (!category) category = _descToCategory(merchant);

        txns.push({
            date,
            merchant,
            amount: Math.round(amount * 100) / 100,
            category,
        });
    }
    return txns;
}

module.exports = {
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
    parseSpendingTransactions,
    matchMerchantOverride,
    CHASE_CATEGORY_MAP,
    CAPITALONE_CATEGORY_MAP,
};
