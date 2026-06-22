/* ==========================================================================
   csv-import.js — CSV Import and Parsing (Fidelity, Chase, Capital One)
   Depends on globals: state, saveState, refreshAllUI, schedulePriceRefresh
   ========================================================================== */

function initCSVImport() {
    const dragZone = document.getElementById('csv-drag-zone');
    const fileInput = document.getElementById('csv-file-input');

    dragZone.addEventListener('click', () => fileInput.click());

    dragZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dragZone.classList.add('dragover');
    });

    dragZone.addEventListener('dragleave', () => {
        dragZone.classList.remove('dragover');
    });

    dragZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            processCSVFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            processCSVFile(e.target.files[0]);
        }
    });
}

function processCSVFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const rows = parseCSVText(text);
        if (rows.length === 0) {
            alert('File appears to be empty.');
            return;
        }

        let source = 'Unknown';
        let records = 0;
        const headerRowStr = rows[0].join(',').toLowerCase();

        if (
            headerRowStr.includes('account number') &&
            headerRowStr.includes('symbol')
        ) {
            source = 'Fidelity Positions';
            records = parseFidelityPositions(rows);
        } else if (
            headerRowStr.includes('transaction date') &&
            headerRowStr.includes('amount') &&
            headerRowStr.includes('memo')
        ) {
            source = 'Chase Statement';
            records = parseChaseStatement(rows);
        } else if (
            headerRowStr.includes('card no.') &&
            headerRowStr.includes('debit') &&
            headerRowStr.includes('credit')
        ) {
            source = 'Capital One Statement';
            records = parseCapitalOneStatement(rows);
        } else {
            source = 'Generic Financial List';
            records = parseFidelityPositions(rows);
        }

        if (records > 0) {
            state.importedFiles.push({
                name: file.name,
                source: source,
                date:
                    new Date().toLocaleDateString() +
                    ' ' +
                    new Date().toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                    }),
                records: records,
            });
            await saveState();
            refreshAllUI();
            // Kick off price refresh for newly imported symbols
            schedulePriceRefresh();
            alert(
                `Successfully imported ${records} records from ${source} export.`,
            );
        } else {
            alert(
                'Unsupported CSV format or no data records found inside the file.',
            );
        }
    };
    reader.readAsText(file);
}

function parseCSVText(text) {
    let lines = [];
    let row = [''];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i];
        let next = text[i + 1];
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

    if (idxSymbol === -1 || idxCurrentValue === -1) return 0;

    let importedCount = 0;
    state.importedPositions = [];

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

        state.importedPositions.push({
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
    return importedCount;
}

const _CHASE_CAT_MAP = {
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
};

const _C1_CAT_MAP = {
    grocery: 'food',
    restaurant: 'food',
    'fast food': 'food',
    coffee: 'food',
    'gas/automobile': 'transport',
    automotive: 'transport',
    taxi: 'transport',
    utilities: 'utilities',
    phone: 'utilities',
    internet: 'utilities',
    'health care': 'healthcare',
    dentist: 'healthcare',
    pharmacy: 'healthcare',
    rent: 'housing',
    'home improvement': 'housing',
};

const _KEYWORD_MAP = [
    { keys: ['rent', 'lease', 'mortgage', 'hoa', 'apartment'], cat: 'housing' },
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
            'restaurant',
            'pizza',
            'burger',
            'mcdonald',
            'chipotle',
            'starbucks',
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
            'speedway',
            'gas station',
            'fuel',
            'uber ',
            'lyft ',
            'parking',
            'toll',
            'auto repair',
            'jiffy lube',
            'firestone',
            'car wash',
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
            'urgent care',
        ],
        cat: 'healthcare',
    },
];

function _descToExpenseCategory(desc) {
    const lower = (desc || '').toLowerCase();
    for (const { keys, cat } of _KEYWORD_MAP) {
        if (keys.some((k) => lower.includes(k))) return cat;
    }
    return 'discretionary';
}

function _calcStatementMonths(dates) {
    if (!dates.length) return 1;
    const ts = dates.map((d) => new Date(d).getTime()).filter((t) => !isNaN(t));
    if (ts.length < 2) return 1;
    return Math.max(
        1,
        Math.round(
            (Math.max(...ts) - Math.min(...ts)) / (1000 * 60 * 60 * 24 * 30.44),
        ),
    );
}

function _applyStatementCategories(cats, months) {
    const m = months || 1;
    let applied = false;
    for (const [cat, total] of Object.entries(cats)) {
        if (total > 0 && state.expenses[cat] !== undefined) {
            state.expenses[cat] = Math.round(total / m);
            const el = document.getElementById(`exp-${cat}`);
            if (el) el.value = state.expenses[cat];
            applied = true;
        }
    }
    return applied;
}

function parseChaseStatement(rows) {
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxDate = headers.findIndex((h) => h.includes('transaction date'));
    const idxDesc = headers.findIndex((h) => h.includes('description'));
    const idxCat = headers.findIndex((h) => h === 'category');
    const idxAmt = headers.findIndex((h) => h === 'amount');
    if (idxAmt === -1) return 0;

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
        const mappedCat = _CHASE_CAT_MAP[rawCat];
        if (mappedCat) {
            cats[mappedCat] += charge;
        } else {
            const desc = idxDesc !== -1 ? row[idxDesc] || '' : '';
            cats[_descToExpenseCategory(desc)] += charge;
        }
    }

    if (imported > 0) {
        const months = _calcStatementMonths(dates);
        _applyStatementCategories(cats, months);
    }
    return imported;
}

function parseCapitalOneStatement(rows) {
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxDate = headers.findIndex((h) => h.includes('transaction date'));
    const idxDesc = headers.findIndex((h) => h.includes('description'));
    const idxCat = headers.findIndex((h) => h === 'category');
    const idxDebit = headers.indexOf('debit');
    if (idxDebit === -1) return 0;

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
        for (const [key, val] of Object.entries(_C1_CAT_MAP)) {
            if (rawCat.includes(key)) {
                mapped = val;
                break;
            }
        }
        if (mapped) {
            cats[mapped] += debit;
        } else {
            const desc = idxDesc !== -1 ? row[idxDesc] || '' : '';
            cats[_descToExpenseCategory(desc)] += debit;
        }
    }

    if (imported > 0) {
        const months = _calcStatementMonths(dates);
        _applyStatementCategories(cats, months);
    }
    return imported;
}
