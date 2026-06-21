/* ==========================================================================
   FIRE Calculator & Tracker - Application Controller
   ========================================================================== */

// Global State
var state = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    expenses: {
        housing: 1500,
        utilities: 250,
        food: 400,
        transport: 300,
        healthcare: 150,
        discretionary: 500
    },
    insurances: {
        car: { amt: 0, freq: '6month' },
        home: { amt: 0, freq: 'monthly' }
    },
    taxRate: 20,
    sideGigLedger: [],
    projectionSettings: {
        annualSavings: 25000,
        expectedReturn: 8.0,
        inflationRate: 2.5,
        swr: 4.0,
        spanYears: 30,
        currentAge: 30,
        retireAge: 60
    },
    importedFiles: []
};

// Editing track states
var editingAccounts = [];
var editingCDs = [];
var editingRealEstate = [];
var editingVehicles = [];

// Chart.js instance trackers
var assetAllocationChart = null;
var projectionsChart = null;
var dashboardProjectionsChart = null;

// Collapsible state per account name
var collapsedAccounts = {};

// Active allocation filter (null = all visible)
var activeAllocationFilter = null;

// Investment table sort state (default: P&L descending within each account group)
var tableSortColumn = 'pnl';
var tableSortDir = 'desc';

// Chart time-window state ('1m'|'1y'|'5y'|'10y'|'15y'|'all')
var dashProjWindow = 'all';
var projWindow = 'all';

// Projection chart line toggle state (which datasets are visible)
var projLineToggles = {
    nw: true, fire: true, lean: true, fat: true, coast: false, benchmark: false, scenarios: false
};

// US median retirement savings by age (Vanguard How America Saves 2023)
const US_MEDIAN_SAVINGS = {
    20: 8000, 25: 19000, 30: 45000, 35: 97000,
    40: 130000, 45: 160000, 50: 200000, 55: 250000,
    60: 330000, 65: 400000, 70: 420000
};

// Base return rate before scenario offset is applied (null = use projectionSettings)
var scenarioOffset = 0; // +2 = bull, -2 = bear, 0 = base

// Price refresh timer
var priceRefreshTimer = null;

// Returns the number of data-points to display for a given window key.
// Projection data is annual; null means show all.
function windowToPoints(windowKey) {
    switch (windowKey) {
        case '1m': return 2;    // show ~1 year — monthly granularity isn't available
        case '1y': return 2;
        case '5y': return 6;
        case '10y': return 11;
        case '15y': return 16;
        default:   return null; // all
    }
}

function sliceProjectionData(data, windowKey) {
    const n = windowToPoints(windowKey);
    if (!n) return data;
    return {
        ...data,
        labels: data.labels.slice(0, n),
        nwData: data.nwData.slice(0, n),
        fireLine: data.fireLine.slice(0, n),
        leanFireLine: data.leanFireLine.slice(0, n),
        fatFireLine: data.fatFireLine.slice(0, n),
        coastFireLine: data.coastFireLine.slice(0, n),
        bullData: data.bullData ? data.bullData.slice(0, n) : [],
        bearData: data.bearData ? data.bearData.slice(0, n) : [],
        benchData: data.benchData ? data.benchData.slice(0, n) : [],
        retirementLineIndex: data.retirementLineIndex < n ? data.retirementLineIndex : -1,
        cdEvents: data.cdEvents.filter(e => e.yearIndex < n)
    };
}

function setPeriodBtnActive(containerId, windowKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.period-btn').forEach(btn => {
        const match = btn.textContent.toLowerCase().replace(' ', '') === windowKey
            || (windowKey === 'all' && btn.textContent === 'All');
        btn.classList.toggle('active', match);
    });
}

window.setDashProjWindow = function(windowKey) {
    dashProjWindow = windowKey;
    setPeriodBtnActive('dash-period-btns', windowKey);
    renderDashboardProjectionsChart();
};

window.setProjWindow = function(windowKey) {
    projWindow = windowKey;
    setPeriodBtnActive('proj-period-btns', windowKey);
    calculateAndRenderProjections();
};

window.toggleProjLine = function(key) {
    projLineToggles[key] = !projLineToggles[key];
    const btn = document.querySelector(`.chart-toggle-btn[data-line="${key}"]`);
    if (btn) btn.classList.toggle('active', projLineToggles[key]);
    calculateAndRenderProjections();
};

window.applyScenario = function(offset) {
    // offset: +2 for bull, -2 for bear, 0 for base
    scenarioOffset = offset;
    document.querySelectorAll('.scenario-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.offset) === offset);
    });
    calculateAndRenderProjections();
};

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
    await loadStateFromServer();
    initNavigation();
    initCSVImport();
    initAccountsManager();
    initCDManager();
    initUnifiedAssetForm();
    initRealEstateManager();
    initVehiclesManager();
    initExpenseManager();
    initSideGigManager();
    initPlatformCalculators();
    initProjectionsManager();

    // Initial Render
    refreshAllUI();

    // Kick off background price refresh (every 5 minutes)
    schedulePriceRefresh();
});

/* ==========================================================================
   State & Storage Management
   ========================================================================== */

function sanitizeState(data) {
    if (!data) return {};
    
    data.importedPositions = data.importedPositions || [];
    data.customAccounts = data.customAccounts || [];
    data.cds = data.cds || [];
    data.realEstate = data.realEstate || [];
    data.vehicles = data.vehicles || [];
    data.sideGigLedger = data.sideGigLedger || [];
    data.importedFiles = data.importedFiles || [];

    data.vehicles.forEach(v => {
        if (!v.year) v.year = new Date().getFullYear();
        if (!v.make) v.make = '';
        if (!v.model) v.model = '';
        if (!v.trim) v.trim = '';
        if (!v.mileage) v.mileage = 0;
        if (!v.condition) v.condition = 'Good';
        if (!v.currentValue) v.currentValue = 0;
        if (!v.purchasePrice) v.purchasePrice = 0;
        if (!v.loanBalance) v.loanBalance = 0;
        if (!v.monthlyPayment) v.monthlyPayment = 0;
        if (!v.notes) v.notes = '';
    });

    data.realEstate.forEach(re => {
        if (!re.marketValue) re.marketValue = 0;
        if (!re.purchasePrice) re.purchasePrice = 0;
        if (!re.mortgageBalance) re.mortgageBalance = 0;
        if (!re.monthlyPayment) re.monthlyPayment = 0;
        if (!re.type) re.type = 'Primary Home';
        if (!re.address) re.address = '';
        if (!re.notes) re.notes = '';
    });
    
    data.customAccounts.forEach(acc => {
        if (acc.apy === undefined || acc.apy === null) acc.apy = 0;
        if (acc.value === undefined || acc.value === null) acc.value = 0;
    });

    data.cds.forEach(cd => {
        if (cd.startDate === undefined || cd.startDate === null) cd.startDate = '';
        if (cd.principal === undefined || cd.principal === null) cd.principal = 0;
        if (cd.rate === undefined || cd.rate === null) cd.rate = 0;
    });

    // Ensure projectionSettings has age fields
    if (data.projectionSettings) {
        if (!data.projectionSettings.currentAge) data.projectionSettings.currentAge = 30;
        if (!data.projectionSettings.retireAge) data.projectionSettings.retireAge = 60;
    }

    // Ensure insurance fields are always present
    if (!data.insurances) data.insurances = { car: { amt: 0, freq: '6month' }, home: { amt: 0, freq: 'monthly' } };
    if (!data.insurances.car) data.insurances.car = { amt: 0, freq: '6month' };
    if (!data.insurances.home) data.insurances.home = { amt: 0, freq: 'monthly' };

    return data;
}

async function loadStateFromServer() {
    try {
        const res = await fetch('/api/state');
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                state = sanitizeState({ ...state, ...data });
                console.log("State loaded successfully from backend DB.");
                return;
            }
        }
    } catch (e) {
        console.warn("Express backend unreachable. Falling back to localStorage.", e);
    }
    loadStateFromStorage();
}

function loadStateFromStorage() {
    const savedState = localStorage.getItem('fire_tracker_state');
    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            state = sanitizeState({ ...state, ...parsed });
            state.expenses = { ...state.expenses, ...(parsed.expenses || {}) };
            state.projectionSettings = { ...state.projectionSettings, ...(parsed.projectionSettings || {}) };
        } catch (e) {
            console.error("Error parsing localstorage state", e);
        }
    }
}

async function saveState() {
    localStorage.setItem('fire_tracker_state', JSON.stringify(state));
    
    try {
        const res = await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!res.ok) {
            console.error("Server API returned status", res.status);
        }
    } catch (e) {
        console.warn("Could not save state to Express backend server.", e);
    }
}

// Backup Export & Import Utility
document.getElementById('btn-backup-export').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `fire_tracker_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

const backupFileTrigger = document.getElementById('btn-backup-import-trigger');
const backupFileInput = document.getElementById('backup-file-input');

backupFileTrigger.addEventListener('click', () => backupFileInput.click());
backupFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedState = JSON.parse(event.target.result);
            if (importedState && typeof importedState === 'object') {
                state = sanitizeState(importedState);
                await saveState();
                refreshAllUI();
                alert('Backup imported successfully!');
            } else {
                alert('Invalid backup structure.');
            }
        } catch (err) {
            alert('Failed to parse backup JSON file: ' + err.message);
        }
    };
    reader.readAsText(file);
});

/* ==========================================================================
   Real-Time Stock Price Engine
   ========================================================================== */

function schedulePriceRefresh() {
    fetchAndApplyPrices();
    if (priceRefreshTimer) clearInterval(priceRefreshTimer);
    priceRefreshTimer = setInterval(fetchAndApplyPrices, 5 * 60 * 1000);
}

async function fetchAndApplyPrices() {
    if (state.importedPositions.length === 0) return;

    // Collect unique non-cash equity symbols
    const symbols = [...new Set(
        state.importedPositions
            .filter(p => p.symbol && !p.symbol.includes('SPAXX') && !p.symbol.includes('FDRXX') && !p.description?.includes('MONEY MARKET'))
            .map(p => p.symbol.trim().replace(/\*+$/, ''))
            .filter(s => s.length > 0 && !/^\d/.test(s))
    )];

    if (symbols.length === 0) return;

    try {
        const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`);
        if (!res.ok) return;
        const prices = await res.json();

        let updated = false;
        state.importedPositions.forEach(pos => {
            const cleanSym = pos.symbol.trim().replace(/\*+$/, '');
            if (prices[cleanSym]) {
                const newPrice = prices[cleanSym].price;
                if (newPrice && newPrice > 0) {
                    pos.lastPrice = newPrice;
                    // Recalculate current value based on quantity × new price
                    if (pos.quantity > 0) {
                        pos.value = pos.quantity * newPrice;
                    }
                    // Recalculate PnL from cost basis
                    if (pos.costBasis > 0) {
                        pos.pnlDollar = pos.value - pos.costBasis;
                        pos.pnlPercent = (pos.pnlDollar / pos.costBasis) * 100;
                    }
                    updated = true;
                }
            }
        });

        if (updated) {
            // Silently save & re-render without full alert spam
            await saveState();
            refreshAllUI();
            console.log(`[Prices] Updated ${symbols.length} symbols from Yahoo Finance.`);
        }
    } catch (err) {
        console.warn("[Prices] Could not fetch real-time quotes:", err);
    }
}

/* ==========================================================================
   Navigation Controller
   ========================================================================== */

function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            navButtons.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            btn.classList.add('active');
            const activePane = document.getElementById(`tab-${targetTab}`);
            if (activePane) activePane.classList.add('active');
            
            if (targetTab === 'dashboard') {
                renderAssetAllocationChart();
                renderDashboardProjectionsChart();
            } else if (targetTab === 'projections') {
                calculateAndRenderProjections();
            }
        });
    });
}

/* ==========================================================================
   Financial CSV Importers
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
        
        if (headerRowStr.includes('account number') && headerRowStr.includes('symbol')) {
            source = 'Fidelity Positions';
            records = parseFidelityPositions(rows);
        } else if (headerRowStr.includes('transaction date') && headerRowStr.includes('amount') && headerRowStr.includes('memo')) {
            source = 'Chase Statement';
            records = parseChaseStatement(rows);
        } else if (headerRowStr.includes('card no.') && headerRowStr.includes('debit') && headerRowStr.includes('credit')) {
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
                date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                records: records
            });
            await saveState();
            refreshAllUI();
            // Kick off price refresh for newly imported symbols
            schedulePriceRefresh();
            alert(`Successfully imported ${records} records from ${source} export.`);
        } else {
            alert('Unsupported CSV format or no data records found inside the file.');
        }
    };
    reader.readAsText(file);
}

function parseCSVText(text) {
    let lines = [];
    let row = [""];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i];
        let next = text[i+1];
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
            if (c === '\r' && next === '\n') { i++; }
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
    const headers = rows[0].map(h => h.trim());
    
    const idxAccountName = headers.findIndex(h => h.toLowerCase() === 'account name');
    const idxSymbol = headers.findIndex(h => h.toLowerCase() === 'symbol');
    const idxDescription = headers.findIndex(h => h.toLowerCase() === 'description');
    const idxQuantity = headers.findIndex(h => h.toLowerCase() === 'quantity');
    const idxLastPrice = headers.findIndex(h => h.toLowerCase() === 'last price');
    const idxCurrentValue = headers.findIndex(h => h.toLowerCase() === 'current value');
    const idxCostBasis = headers.findIndex(h => h.toLowerCase() === 'cost basis total');
    
    const idxGainLossDollar = headers.findIndex(h => h.toLowerCase().includes('gain/loss dollar') && !h.toLowerCase().includes('today'));
    const idxGainLossPercent = headers.findIndex(h => h.toLowerCase().includes('gain/loss percent') && !h.toLowerCase().includes('today'));

    if (idxSymbol === -1 || idxCurrentValue === -1) return 0;

    let importedCount = 0;
    state.importedPositions = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;
        
        const sym = (row[idxSymbol] || '').trim();
        const rawVal = (row[idxCurrentValue] || '').trim();
        
        if (!sym || sym.includes('*') && rawVal === '') continue;
        if (row[0] && (row[0].toLowerCase().includes('the data') || row[0].toLowerCase().includes('brokerage services'))) {
            break;
        }

        const cleanedValue = parseFloat(rawVal.replace(/[^0-9.-]/g, ''));
        const qty = parseFloat((row[idxQuantity] || '0').replace(/[^0-9.-]/g, ''));
        const price = parseFloat((row[idxLastPrice] || '0').replace(/[^0-9.-]/g, ''));
        const basis = parseFloat((row[idxCostBasis] || '0').replace(/[^0-9.-]/g, ''));
        
        const rawGainDollar = row[idxGainLossDollar] || '';
        const rawGainPercent = row[idxGainLossPercent] || '';
        const gainDollar = parseFloat(rawGainDollar.replace(/[^0-9.-]/g, '')) || 0;
        const gainPercent = parseFloat(rawGainPercent.replace(/[^0-9.-]/g, '')) || 0;

        if (isNaN(cleanedValue)) continue;

        const cleanBasis = isNaN(basis) ? 0 : basis;
        const finalGainDollar = gainDollar || (cleanBasis > 0 ? cleanedValue - cleanBasis : 0);
        const finalGainPercent = gainPercent || (cleanBasis > 0 ? ((cleanedValue - cleanBasis) / cleanBasis) * 100 : 0);

        state.importedPositions.push({
            account: row[idxAccountName] || 'Brokerage',
            symbol: sym,
            description: row[idxDescription] || '',
            quantity: isNaN(qty) ? 0 : qty,
            lastPrice: isNaN(price) ? 0 : price,
            value: cleanedValue,
            costBasis: cleanBasis,
            pnlDollar: finalGainDollar,
            pnlPercent: finalGainPercent
        });
        importedCount++;
    }
    return importedCount;
}

const _CHASE_CAT_MAP = {
    'automotive': 'transport', 'bills & utilities': 'utilities', 'food & drink': 'food',
    'gas': 'transport', 'groceries': 'food', 'health & wellness': 'healthcare',
    'medical': 'healthcare', 'home': 'housing', 'travel': 'transport',
    'entertainment': 'discretionary', 'shopping': 'discretionary', 'personal': 'discretionary',
};

const _C1_CAT_MAP = {
    'grocery': 'food', 'restaurant': 'food', 'fast food': 'food', 'coffee': 'food',
    'gas/automobile': 'transport', 'automotive': 'transport', 'taxi': 'transport',
    'utilities': 'utilities', 'phone': 'utilities', 'internet': 'utilities',
    'health care': 'healthcare', 'dentist': 'healthcare', 'pharmacy': 'healthcare',
    'rent': 'housing', 'home improvement': 'housing',
};

const _KEYWORD_MAP = [
    { keys: ['rent', 'lease', 'mortgage', 'hoa', 'apartment'], cat: 'housing' },
    { keys: ['electric', 'water bill', 'gas company', 'internet', 'comcast', 'xfinity', 'spectrum', 'at&t', 'verizon fios', 't-mobile'], cat: 'utilities' },
    { keys: ['grocery', 'safeway', 'kroger', 'trader joe', 'whole foods', 'aldi', 'publix', 'costco', 'walmart', 'restaurant', 'pizza', 'burger', 'mcdonald', 'chipotle', 'starbucks', 'doordash', 'grubhub', 'ubereats', 'instacart'], cat: 'food' },
    { keys: ['shell ', 'exxon', 'bp ', 'chevron', 'mobil ', 'speedway', 'gas station', 'fuel', 'uber ', 'lyft ', 'parking', 'toll', 'auto repair', 'jiffy lube', 'firestone', 'car wash'], cat: 'transport' },
    { keys: ['pharmacy', 'cvs ', 'walgreens', 'rite aid', 'hospital', 'medical', 'dental', 'vision', 'kaiser', 'urgent care'], cat: 'healthcare' },
];

function _descToExpenseCategory(desc) {
    const lower = (desc || '').toLowerCase();
    for (const { keys, cat } of _KEYWORD_MAP) {
        if (keys.some(k => lower.includes(k))) return cat;
    }
    return 'discretionary';
}

function _calcStatementMonths(dates) {
    if (!dates.length) return 1;
    const ts = dates.map(d => new Date(d).getTime()).filter(t => !isNaN(t));
    if (ts.length < 2) return 1;
    return Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / (1000 * 60 * 60 * 24 * 30.44)));
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
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const idxDate = headers.findIndex(h => h.includes('transaction date'));
    const idxDesc = headers.findIndex(h => h.includes('description'));
    const idxCat = headers.findIndex(h => h === 'category');
    const idxAmt = headers.findIndex(h => h === 'amount');
    if (idxAmt === -1) return 0;

    const cats = { housing: 0, utilities: 0, food: 0, transport: 0, healthcare: 0, discretionary: 0 };
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
        const rawCat = idxCat !== -1 ? (row[idxCat] || '').toLowerCase().trim() : '';
        const mappedCat = _CHASE_CAT_MAP[rawCat];
        if (mappedCat) {
            cats[mappedCat] += charge;
        } else {
            const desc = idxDesc !== -1 ? (row[idxDesc] || '') : '';
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
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const idxDate = headers.findIndex(h => h.includes('transaction date'));
    const idxDesc = headers.findIndex(h => h.includes('description'));
    const idxCat = headers.findIndex(h => h === 'category');
    const idxDebit = headers.indexOf('debit');
    if (idxDebit === -1) return 0;

    const cats = { housing: 0, utilities: 0, food: 0, transport: 0, healthcare: 0, discretionary: 0 };
    const dates = [];
    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= idxDebit) continue;
        const debit = parseFloat(row[idxDebit]);
        if (isNaN(debit) || debit <= 0) continue;
        imported++;
        if (idxDate !== -1 && row[idxDate]) dates.push(row[idxDate]);
        const rawCat = idxCat !== -1 ? (row[idxCat] || '').toLowerCase().trim() : '';
        let mapped = null;
        for (const [key, val] of Object.entries(_C1_CAT_MAP)) {
            if (rawCat.includes(key)) { mapped = val; break; }
        }
        if (mapped) {
            cats[mapped] += debit;
        } else {
            const desc = idxDesc !== -1 ? (row[idxDesc] || '') : '';
            cats[_descToExpenseCategory(desc)] += debit;
        }
    }

    if (imported > 0) {
        const months = _calcStatementMonths(dates);
        _applyStatementCategories(cats, months);
    }
    return imported;
}

/* ==========================================================================
   Accounts & Assets Manager
   ========================================================================== */

function initAccountsManager() {
    const form = document.getElementById('form-custom-account');
    const accType = document.getElementById('acc-type');
    const apyGroup = document.getElementById('group-acc-apy');

    if (accType.value === 'Savings' || accType.value === 'Cash') {
        apyGroup.style.display = 'block';
    } else {
        apyGroup.style.display = 'none';
    }

    accType.addEventListener('change', () => {
        if (accType.value === 'Savings' || accType.value === 'Cash') {
            apyGroup.style.display = 'block';
        } else {
            apyGroup.style.display = 'none';
        }
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('acc-name').value;
        const type = accType.value;
        const val = parseFloat(document.getElementById('acc-val').value);
        const apy = parseFloat(document.getElementById('acc-apy').value) || 0;

        if (name && !isNaN(val)) {
            state.customAccounts.push({
                id: Date.now().toString(),
                name: name,
                type: type,
                value: val,
                apy: (type === 'Savings' || type === 'Cash') ? apy : 0
            });
            await saveState();
            refreshAllUI();
            form.reset();
            apyGroup.style.display = 'none';
        }
    });
}

window.deleteCustomAccount = async function(id) {
    state.customAccounts = state.customAccounts.filter(acc => acc.id !== id);
    await saveState();
    refreshAllUI();
};

window.deleteImportedFile = async function(index) {
    state.importedFiles.splice(index, 1);
    if (state.importedFiles.length === 0) {
        state.importedPositions = [];
    }
    await saveState();
    refreshAllUI();
};

window.startEditAccount = function(id) {
    editingAccounts.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditAccount = function(id) {
    editingAccounts = editingAccounts.filter(x => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditAccount = async function(id) {
    const nameInput = document.getElementById(`edit-acc-name-${id}`);
    const apyInput = document.getElementById(`edit-acc-apy-${id}`);
    const valInput = document.getElementById(`edit-acc-val-${id}`);
    
    const name = nameInput.value;
    const apy = parseFloat(apyInput.value) || 0;
    const value = parseFloat(valInput.value) || 0;

    const accIndex = state.customAccounts.findIndex(acc => acc.id === id);
    if (accIndex !== -1) {
        state.customAccounts[accIndex].name = name;
        state.customAccounts[accIndex].apy = apy;
        state.customAccounts[accIndex].value = value;
        
        editingAccounts = editingAccounts.filter(x => x !== id);
        await saveState();
        refreshAllUI();
    }
};

/* ==========================================================================
   Certificates of Deposit (CDs) Manager
   ========================================================================== */

function initCDManager() {
    const form = document.getElementById('form-cd-entry');
    
    document.getElementById('cd-start').value = new Date().toISOString().slice(0, 10);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bank = document.getElementById('cd-bank').value;
        const principal = parseFloat(document.getElementById('cd-principal').value);
        const rate = parseFloat(document.getElementById('cd-rate').value);
        const startDate = document.getElementById('cd-start').value;
        const maturity = document.getElementById('cd-maturity').value;

        if (bank && !isNaN(principal) && !isNaN(rate) && startDate && maturity) {
            state.cds.push({
                id: Date.now().toString(),
                bank: bank,
                principal: principal,
                rate: rate,
                startDate: startDate,
                maturity: maturity
            });
            await saveState();
            refreshAllUI();
            form.reset();
            document.getElementById('cd-start').value = new Date().toISOString().slice(0, 10);
        }
    });
}

window.deleteCD = async function(id) {
    state.cds = state.cds.filter(cd => cd.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditCD = function(id) {
    editingCDs.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditCD = function(id) {
    editingCDs = editingCDs.filter(x => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditCD = async function(id) {
    const bankInput = document.getElementById(`edit-cd-bank-${id}`);
    const principalInput = document.getElementById(`edit-cd-principal-${id}`);
    const rateInput = document.getElementById(`edit-cd-rate-${id}`);
    const startInput = document.getElementById(`edit-cd-start-${id}`);
    const matInput = document.getElementById(`edit-cd-maturity-${id}`);

    const bank = bankInput.value;
    const principal = parseFloat(principalInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;
    const startDate = startInput.value;
    const maturity = matInput.value;

    const cdIndex = state.cds.findIndex(cd => cd.id === id);
    if (cdIndex !== -1) {
        state.cds[cdIndex].bank = bank;
        state.cds[cdIndex].principal = principal;
        state.cds[cdIndex].rate = rate;
        state.cds[cdIndex].startDate = startDate;
        state.cds[cdIndex].maturity = maturity;

        editingCDs = editingCDs.filter(x => x !== id);
        await saveState();
        refreshAllUI();
    }
};

/* ==========================================================================
   Real Estate Manager
   ========================================================================== */

function initRealEstateManager() {
    const form = document.getElementById('form-real-estate');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const entry = {
            id: Date.now().toString(),
            name: document.getElementById('re-name').value.trim(),
            type: document.getElementById('re-type').value,
            address: document.getElementById('re-address').value.trim(),
            marketValue: parseFloat(document.getElementById('re-market-value').value) || 0,
            purchasePrice: parseFloat(document.getElementById('re-purchase-price').value) || 0,
            mortgageBalance: parseFloat(document.getElementById('re-mortgage-balance').value) || 0,
            monthlyPayment: parseFloat(document.getElementById('re-monthly-payment').value) || 0,
            notes: document.getElementById('re-notes').value.trim()
        };
        if (!entry.name || entry.marketValue <= 0) return;
        state.realEstate.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
    });
}

window.deleteRealEstate = async function(id) {
    state.realEstate = state.realEstate.filter(re => re.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditRealEstate = function(id) {
    editingRealEstate.push(id);
    renderRealEstateTable();
};

window.cancelEditRealEstate = function(id) {
    editingRealEstate = editingRealEstate.filter(x => x !== id);
    renderRealEstateTable();
};

window.saveEditRealEstate = async function(id) {
    const idx = state.realEstate.findIndex(re => re.id === id);
    if (idx === -1) return;
    state.realEstate[idx] = {
        ...state.realEstate[idx],
        name: document.getElementById(`re-edit-name-${id}`)?.value.trim() || state.realEstate[idx].name,
        type: document.getElementById(`re-edit-type-${id}`)?.value || state.realEstate[idx].type,
        address: document.getElementById(`re-edit-address-${id}`)?.value.trim() || '',
        marketValue: parseFloat(document.getElementById(`re-edit-market-${id}`)?.value) || 0,
        purchasePrice: parseFloat(document.getElementById(`re-edit-purchase-${id}`)?.value) || 0,
        mortgageBalance: parseFloat(document.getElementById(`re-edit-mortgage-${id}`)?.value) || 0,
        monthlyPayment: parseFloat(document.getElementById(`re-edit-payment-${id}`)?.value) || 0,
        notes: document.getElementById(`re-edit-notes-${id}`)?.value.trim() || ''
    };
    editingRealEstate = editingRealEstate.filter(x => x !== id);
    await saveState();
    refreshAllUI();
};

/* ==========================================================================
   Vehicles Manager
   ========================================================================== */

function initVehiclesManager() {
    const form = document.getElementById('form-vehicles');
    if (!form) return;

    const yearInput = document.getElementById('veh-year');
    if (yearInput && !yearInput.value) yearInput.value = new Date().getFullYear();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const entry = {
            id: Date.now().toString(),
            year: parseInt(document.getElementById('veh-year').value) || new Date().getFullYear(),
            make: document.getElementById('veh-make').value.trim(),
            model: document.getElementById('veh-model').value.trim(),
            trim: document.getElementById('veh-trim').value.trim(),
            color: document.getElementById('veh-color').value.trim(),
            mileage: parseInt(document.getElementById('veh-mileage').value) || 0,
            condition: document.getElementById('veh-condition').value,
            currentValue: parseFloat(document.getElementById('veh-current-value').value) || 0,
            purchasePrice: parseFloat(document.getElementById('veh-purchase-price').value) || 0,
            loanBalance: parseFloat(document.getElementById('veh-loan-balance').value) || 0,
            monthlyPayment: parseFloat(document.getElementById('veh-monthly-payment').value) || 0,
            notes: document.getElementById('veh-notes').value.trim()
        };
        if (!entry.make || !entry.model || entry.currentValue <= 0) return;
        state.vehicles.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
        document.getElementById('veh-year').value = new Date().getFullYear();
    });
}

window.deleteVehicle = async function(id) {
    state.vehicles = state.vehicles.filter(v => v.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditVehicle = function(id) {
    editingVehicles.push(id);
    renderVehiclesTable();
};

window.cancelEditVehicle = function(id) {
    editingVehicles = editingVehicles.filter(x => x !== id);
    renderVehiclesTable();
};

window.saveEditVehicle = async function(id) {
    const idx = state.vehicles.findIndex(v => v.id === id);
    if (idx === -1) return;
    const g = (fId) => document.getElementById(`veh-edit-${fId}-${id}`);
    state.vehicles[idx] = {
        ...state.vehicles[idx],
        year: parseInt(g('year')?.value) || state.vehicles[idx].year,
        make: g('make')?.value.trim() || state.vehicles[idx].make,
        model: g('model')?.value.trim() || state.vehicles[idx].model,
        trim: g('trim')?.value.trim() || '',
        color: g('color')?.value.trim() || '',
        mileage: parseInt(g('mileage')?.value) || 0,
        condition: g('condition')?.value || state.vehicles[idx].condition,
        currentValue: parseFloat(g('value')?.value) || 0,
        purchasePrice: parseFloat(g('purchase')?.value) || 0,
        loanBalance: parseFloat(g('loan')?.value) || 0,
        monthlyPayment: parseFloat(g('payment')?.value) || 0,
        notes: g('notes')?.value.trim() || ''
    };
    editingVehicles = editingVehicles.filter(x => x !== id);
    await saveState();
    refreshAllUI();
};

/* ==========================================================================
   Expenses & Taxes Manager
   ========================================================================== */

function initExpenseManager() {
    const inputs = document.querySelectorAll('.expense-input');
    const taxSlider = document.getElementById('tax-rate');
    const taxDisplay = document.getElementById('tax-rate-display');
    const grossIncomeInput = document.getElementById('tax-gross-income');
    const filingStateSelect = document.getElementById('tax-filing-state');

    inputs.forEach(input => {
        const id = input.id.replace('exp-', '');
        if (state.expenses[id] !== undefined) {
            input.value = state.expenses[id];
        }
    });

    if (state.taxRate !== undefined) {
        taxSlider.value = state.taxRate;
        taxDisplay.textContent = `${state.taxRate}%`;
    }

    inputs.forEach(input => {
        input.addEventListener('input', async () => {
            const id = input.id.replace('exp-', '');
            state.expenses[id] = parseFloat(input.value) || 0;
            await saveState();
            refreshAllUI();
        });
    });

    // Insurance fields
    const insCarAmt = document.getElementById('ins-car-amt');
    const insCarFreq = document.getElementById('ins-car-freq');
    const insHomeAmt = document.getElementById('ins-home-amt');
    const insHomeFreq = document.getElementById('ins-home-freq');

    if (insCarAmt) insCarAmt.value = state.insurances.car.amt;
    if (insCarFreq) insCarFreq.value = state.insurances.car.freq;
    if (insHomeAmt) insHomeAmt.value = state.insurances.home.amt;
    if (insHomeFreq) insHomeFreq.value = state.insurances.home.freq;

    async function saveInsurance() {
        state.insurances.car.amt = parseFloat(insCarAmt?.value) || 0;
        state.insurances.car.freq = insCarFreq?.value || '6month';
        state.insurances.home.amt = parseFloat(insHomeAmt?.value) || 0;
        state.insurances.home.freq = insHomeFreq?.value || 'monthly';
        await saveState();
        refreshAllUI();
    }

    insCarAmt?.addEventListener('input', saveInsurance);
    insCarFreq?.addEventListener('change', saveInsurance);
    insHomeAmt?.addEventListener('input', saveInsurance);
    insHomeFreq?.addEventListener('change', saveInsurance);

    taxSlider.addEventListener('input', async () => {
        state.taxRate = parseInt(taxSlider.value);
        taxDisplay.textContent = `${state.taxRate}%`;
        await saveState();
        refreshAllUI();
    });

    // Auto-compute effective tax rate from gross income + state
    function autoComputeTax() {
        const gross = parseFloat(grossIncomeInput.value) || 0;
        const filingState = filingStateSelect.value;
        if (gross <= 0) return;
        const estimated = computeEffectiveTaxRate(gross, filingState);
        state.taxRate = estimated;
        taxSlider.value = estimated;
        taxDisplay.textContent = `${estimated}%`;
        saveState();
        refreshAllUI();
    }

    grossIncomeInput.addEventListener('change', autoComputeTax);
    filingStateSelect.addEventListener('change', autoComputeTax);
}

function computeEffectiveTaxRate(grossIncome, filingState) {
    // 2024 Federal brackets (single filer, simplified)
    const federalBrackets = [
        { limit: 11600,  rate: 0.10 },
        { limit: 47150,  rate: 0.12 },
        { limit: 100525, rate: 0.22 },
        { limit: 191950, rate: 0.24 },
        { limit: 243725, rate: 0.32 },
        { limit: 609350, rate: 0.35 },
        { limit: Infinity, rate: 0.37 }
    ];

    let federalTax = 0;
    let prev = 0;
    for (const bracket of federalBrackets) {
        if (grossIncome <= prev) break;
        const taxable = Math.min(grossIncome, bracket.limit) - prev;
        federalTax += taxable * bracket.rate;
        prev = bracket.limit;
    }

    // Simplified state tax (approximate effective rates)
    const stateTaxRates = {
        TX: 0.0,
        FL: 0.0,
        WA: 0.0,
        NV: 0.0,
        IL: 0.0495, // flat
        CA: grossIncome > 300000 ? 0.113 : grossIncome > 100000 ? 0.093 : 0.073,
        NY: grossIncome > 215400 ? 0.109 : grossIncome > 80650 ? 0.0685 : 0.045,
        Other: 0.04
    };

    const stateRate = stateTaxRates[filingState] !== undefined ? stateTaxRates[filingState] : 0.04;
    const stateTax = grossIncome * stateRate;

    // FICA (Social Security 6.2% up to $168,600 + Medicare 1.45%)
    const ficaTax = Math.min(grossIncome, 168600) * 0.062 + grossIncome * 0.0145;

    const totalTax = federalTax + stateTax + ficaTax;
    const effectiveRate = Math.round((totalTax / grossIncome) * 100);
    return Math.min(Math.max(effectiveRate, 0), 50);
}

/* ==========================================================================
   Side Gig & eBay Hub Manager
   ========================================================================== */

function initSideGigManager() {
    const priceInput = document.getElementById('ebay-price');
    const costInput = document.getElementById('ebay-cost');
    const shippingCharged = document.getElementById('ebay-shipping-charged');
    const shippingActual = document.getElementById('ebay-shipping-actual');
    const catRateInput = document.getElementById('ebay-category-rate');
    const adRateInput = document.getElementById('ebay-ad-rate');

    const inputs = [priceInput, costInput, shippingCharged, shippingActual, catRateInput, adRateInput];
    
    inputs.forEach(input => {
        input.addEventListener('input', calculateEbayProfit);
    });

    document.getElementById('btn-save-ebay-sale').addEventListener('click', async () => {
        const gross = parseFloat(priceInput.value) + parseFloat(shippingCharged.value);
        const fees = calculateEbayFeesTotal();
        const shippingCost = parseFloat(shippingActual.value);
        const costBasis = parseFloat(costInput.value);
        const netProfit = gross - fees - shippingCost - costBasis;

        state.sideGigLedger.push({
            id: Date.now().toString(),
            desc: `eBay Sale: $${priceInput.value} Item`,
            category: 'eBay',
            revenue: gross,
            expenses: fees + shippingCost + costBasis,
            net: netProfit
        });
        await saveState();
        refreshAllUI();
        alert('eBay sale successfully logged to Side Income history!');
    });

    const manualForm = document.getElementById('form-sidegig-manual');
    manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const desc = document.getElementById('sg-desc').value;
        const cat = document.getElementById('sg-cat').value;
        const revenue = parseFloat(document.getElementById('sg-revenue').value);
        const expense = parseFloat(document.getElementById('sg-expense').value) || 0;

        if (desc && !isNaN(revenue)) {
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: desc,
                category: cat,
                revenue: revenue,
                expenses: expense,
                net: revenue - expense
            });
            await saveState();
            refreshAllUI();
            manualForm.reset();
        }
    });

    calculateEbayProfit();
}

function calculateEbayFeesTotal() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const shippingCharged = parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const categoryRate = parseFloat(document.getElementById('ebay-category-rate').value) / 100;
    const adRate = parseFloat(document.getElementById('ebay-ad-rate').value) / 100;

    const totalTransactionVal = price + shippingCharged;
    const standardFee = (totalTransactionVal * categoryRate) + 0.30;
    const adFee = totalTransactionVal * adRate;
    
    return standardFee + adFee;
}

function calculateEbayProfit() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const cost = parseFloat(document.getElementById('ebay-cost').value) || 0;
    const shippingCharged = parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const shippingActual = parseFloat(document.getElementById('ebay-shipping-actual').value) || 0;

    const gross = price + shippingCharged;
    const fees = calculateEbayFeesTotal();
    const netProfit = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (netProfit / cost) * 100 : 0;

    document.getElementById('ebay-res-gross').textContent = formatCurrency(gross);
    document.getElementById('ebay-res-fees').textContent = formatCurrency(fees);
    document.getElementById('ebay-res-profit').textContent = formatCurrency(netProfit);
    document.getElementById('ebay-res-roi').textContent = `${roi.toFixed(1)}%`;

    const profitBox = document.getElementById('ebay-res-profit');
    if (netProfit < 0) {
        profitBox.className = "result-value text-coral";
    } else {
        profitBox.className = "result-value text-emerald";
    }
}

window.deleteSideGigEntry = async function(id) {
    state.sideGigLedger = state.sideGigLedger.filter(sg => sg.id !== id);
    await saveState();
    refreshAllUI();
};

/* ==========================================================================
   Platform Fee Calculators (Etsy + FB Marketplace)
   ========================================================================== */

function initPlatformCalculators() {
    // Tab switching
    document.querySelectorAll('.platform-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.platform-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.platform-calc-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            const panel = document.getElementById(`calc-panel-${btn.dataset.platform}`);
            if (panel) panel.style.display = '';
        });
    });

    // Etsy live calculation
    ['etsy-price', 'etsy-shipping-charged', 'etsy-shipping-actual', 'etsy-cost', 'etsy-ads-rate'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateEtsyProfit);
    });

    // FB live calculation
    ['fb-price', 'fb-shipping-actual', 'fb-cost', 'fb-is-shipped'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateFBProfit);
        document.getElementById(id)?.addEventListener('change', calculateFBProfit);
    });

    // Log buttons
    document.getElementById('btn-save-etsy-sale')?.addEventListener('click', async () => {
        const price = parseFloat(document.getElementById('etsy-price').value) || 0;
        const shipping = parseFloat(document.getElementById('etsy-shipping-charged').value) || 0;
        const shippingActual = parseFloat(document.getElementById('etsy-shipping-actual').value) || 0;
        const cost = parseFloat(document.getElementById('etsy-cost').value) || 0;
        const adsRate = parseFloat(document.getElementById('etsy-ads-rate').value) || 0;
        const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
        const net = (price + shipping) - fees - shippingActual - cost;
        state.sideGigLedger.push({ id: Date.now().toString(), desc: `Etsy Sale: $${price} Item`, category: 'Etsy', revenue: price + shipping, expenses: fees + shippingActual + cost, net });
        await saveState();
        refreshAllUI();
        alert('Etsy sale logged to Side Income history!');
    });

    document.getElementById('btn-save-fb-sale')?.addEventListener('click', async () => {
        const price = parseFloat(document.getElementById('fb-price').value) || 0;
        const shippingActual = parseFloat(document.getElementById('fb-shipping-actual').value) || 0;
        const cost = parseFloat(document.getElementById('fb-cost').value) || 0;
        const isShipped = document.getElementById('fb-is-shipped')?.checked;
        const fees = calculateFBFeesTotal(price, isShipped);
        const net = price - fees - shippingActual - cost;
        state.sideGigLedger.push({ id: Date.now().toString(), desc: `FB Marketplace Sale: $${price} Item`, category: 'FB Marketplace', revenue: price, expenses: fees + shippingActual + cost, net });
        await saveState();
        refreshAllUI();
        alert('FB Marketplace sale logged to Side Income history!');
    });

    calculateEtsyProfit();
    calculateFBProfit();
}

function calculateEtsyFeesTotal(price, shipping, adsRate) {
    const p = price || 0;
    const s = shipping || 0;
    const listing = 0.20;
    const transaction = (p + s) * 0.065;
    const payment = (p + s) * 0.03 + 0.25;
    const ads = (p + s) * ((adsRate || 0) / 100);
    return listing + transaction + payment + ads;
}

function calculateEtsyProfit() {
    const price = parseFloat(document.getElementById('etsy-price')?.value) || 0;
    const shipping = parseFloat(document.getElementById('etsy-shipping-charged')?.value) || 0;
    const shippingActual = parseFloat(document.getElementById('etsy-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('etsy-cost')?.value) || 0;
    const adsRate = parseFloat(document.getElementById('etsy-ads-rate')?.value) || 0;

    const gross = price + shipping;
    const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
    const net = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('etsy-res-gross', formatCurrency(gross));
    set('etsy-res-fees', formatCurrency(fees));
    set('etsy-res-profit', formatCurrency(net));
    set('etsy-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('etsy-res-profit');
    if (profitEl) profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;
}

function calculateFBFeesTotal(price, isShipped) {
    if (!isShipped) return 0;
    return Math.max((price || 0) * 0.05, 0.40);
}

function calculateFBProfit() {
    const price = parseFloat(document.getElementById('fb-price')?.value) || 0;
    const shippingActual = parseFloat(document.getElementById('fb-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('fb-cost')?.value) || 0;
    const isShipped = document.getElementById('fb-is-shipped')?.checked || false;

    const fees = calculateFBFeesTotal(price, isShipped);
    const net = price - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('fb-res-gross', formatCurrency(price));
    set('fb-res-fees', formatCurrency(fees));
    set('fb-res-profit', formatCurrency(net));
    set('fb-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('fb-res-profit');
    if (profitEl) profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;

    const feeNote = document.getElementById('fb-fee-note');
    if (feeNote) feeNote.textContent = isShipped ? 'FB checkout fee: 5% (min $0.40)' : 'Local pickup — no selling fee';
}

/* ==========================================================================
   Net Worth Projections Engine
   ========================================================================== */

function initProjectionsManager() {
    const projInputIds = ['proj-savings', 'proj-return', 'proj-inflation', 'proj-swr', 'proj-years', 'proj-current-age', 'proj-retire-age'];

    document.getElementById('proj-savings').value = state.projectionSettings.annualSavings;
    document.getElementById('proj-return').value = state.projectionSettings.expectedReturn;
    document.getElementById('proj-inflation').value = state.projectionSettings.inflationRate;
    document.getElementById('proj-swr').value = state.projectionSettings.swr;
    document.getElementById('proj-years').value = state.projectionSettings.spanYears;
    document.getElementById('proj-current-age').value = state.projectionSettings.currentAge || 30;
    document.getElementById('proj-retire-age').value = state.projectionSettings.retireAge || 60;

    projInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', async () => {
            state.projectionSettings = {
                annualSavings: parseFloat(document.getElementById('proj-savings').value) || 0,
                expectedReturn: parseFloat(document.getElementById('proj-return').value) || 0,
                inflationRate: parseFloat(document.getElementById('proj-inflation').value) || 0,
                swr: parseFloat(document.getElementById('proj-swr').value) || 4.0,
                spanYears: parseInt(document.getElementById('proj-years').value) || 30,
                currentAge: parseInt(document.getElementById('proj-current-age').value) || 30,
                retireAge: parseInt(document.getElementById('proj-retire-age').value) || 60
            };
            await saveState();
            refreshAllUI();
        });
    });
}

function buildProjectionData() {
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? (annualExpenses / swr) : 0;

    const savings = state.projectionSettings.annualSavings;
    // Apply any active scenario offset to the expected return
    const nominalReturn = (state.projectionSettings.expectedReturn + scenarioOffset) / 100;
    const inflation = state.projectionSettings.inflationRate / 100;
    const realReturn = nominalReturn - inflation;
    const span = state.projectionSettings.spanYears;
    const currentAge = state.projectionSettings.currentAge || 30;
    const retireAge = state.projectionSettings.retireAge || 60;

    let labels = [];
    let nwData = [];
    let fireLine = [];
    let leanFireLine = [];
    let fatFireLine = [];
    let coastFireLine = [];
    let currentNW = networth;

    // Bull (+2% real) and Bear (-2% real) scenario arrays
    let bullNW = networth, bearNW = networth;
    const bullReturn = realReturn + 0.02;
    const bearReturn = Math.max(realReturn - 0.02, -0.01);
    let bullData = [], bearData = [];

    const coastYears = retireAge - currentAge;
    const coastFireTarget = coastYears > 0
        ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
        : fireNumber;

    // US median savings benchmark by age (Vanguard How America Saves 2023)
    const ageKeys = Object.keys(US_MEDIAN_SAVINGS).map(Number).sort((a, b) => a - b);
    const benchData = [];

    let retirementLineIndex = -1;

    for (let yr = 0; yr <= span; yr++) {
        const age = currentAge + yr;
        labels.push(`Age ${age}`);
        nwData.push(Math.round(currentNW));
        fireLine.push(Math.round(fireNumber));
        leanFireLine.push(Math.round(fireNumber * 0.75));
        fatFireLine.push(Math.round(fireNumber * 1.25));
        coastFireLine.push(Math.round(coastFireTarget));
        bullData.push(Math.round(bullNW));
        bearData.push(Math.round(Math.max(bearNW, 0)));

        // Interpolate US median for this age
        const lower = [...ageKeys].reverse().find(a => a <= age) ?? ageKeys[0];
        const upper = ageKeys.find(a => a > age) ?? ageKeys[ageKeys.length - 1];
        const t = lower === upper ? 0 : (age - lower) / (upper - lower);
        benchData.push(Math.round(US_MEDIAN_SAVINGS[lower] * (1 - t) + US_MEDIAN_SAVINGS[upper] * t));

        if (age === retireAge) retirementLineIndex = yr;

        if (yr < span) {
            currentNW = (currentNW * (1 + realReturn)) + savings;
            bullNW    = (bullNW    * (1 + bullReturn)) + savings;
            bearNW    = (bearNW    * (1 + bearReturn)) + savings;
        }
    }

    // CD maturity events as annotations
    const cdEvents = state.cds.map(cd => {
        const matDate = new Date(cd.maturity);
        const today = new Date();
        const yearsUntilMaturity = (matDate - today) / (365.25 * 24 * 60 * 60 * 1000);
        const yearIndex = Math.round(yearsUntilMaturity);
        if (yearIndex >= 0 && yearIndex <= span) {
            return { yearIndex, label: `${cd.bank} CD Matures`, amount: cd.principal };
        }
        return null;
    }).filter(Boolean);

    return { labels, nwData, fireLine, leanFireLine, fatFireLine, coastFireLine, bullData, bearData, benchData, fireNumber, retirementLineIndex, cdEvents, realReturn, savings, networth };
}

function computeScenarioFIREDate({ savingsMultiplier = 1, returnOffset = 0, inflationOffset = 0 } = {}) {
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? (annualExpenses / swr) : 0;
    if (fireNumber <= 0) return null;

    const savings = state.projectionSettings.annualSavings * savingsMultiplier;
    const nominalReturn = (state.projectionSettings.expectedReturn + returnOffset) / 100;
    const inflation = (state.projectionSettings.inflationRate + inflationOffset) / 100;
    const realReturn = nominalReturn - inflation;
    const currentAge = state.projectionSettings.currentAge || 30;

    if (networth >= fireNumber) return currentAge;

    let nw = networth;
    for (let yr = 1; yr <= 80; yr++) {
        nw = (nw * (1 + realReturn)) + savings;
        if (nw >= fireNumber) return currentAge + yr;
    }
    return null;
}

function calculateAndRenderProjections() {
    const raw = buildProjectionData();
    renderProjectionsChart(sliceProjectionData(raw, projWindow));
    renderMilestones(raw.networth, raw.fireNumber, raw.realReturn, raw.savings);
    renderScenarioComparison();
}

/* ==========================================================================
   UI Refresh & Computations
   ========================================================================== */

function isSettledCash(pos) {
    const sym = (pos.symbol || '').toUpperCase();
    const desc = (pos.description || '').toUpperCase();
    return sym.includes('SPAXX') || sym.includes('FDRXX') || sym.includes('FZSSX') || sym.includes('FZFXX') ||
        sym === '**' || desc.includes('PENDING ACTIVITY') || desc.includes('MONEY MARKET') || desc.includes('CORE POSITION');
}

function refreshAllUI() {
    calculateEbayProfit();
    
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? (annualExpenses / swr) : 0;
    const progressPercent = fireNumber > 0 ? Math.min((networth / fireNumber) * 100, 100) : 0;

    document.getElementById('banner-networth').textContent = formatCurrency(networth);
    document.getElementById('banner-spend').textContent = formatCurrency(annualExpenses);
    document.getElementById('banner-progress').textContent = `${progressPercent.toFixed(1)}%`;
    document.getElementById('banner-target').textContent = `Target: ${formatCurrency(fireNumber)}`;

    const fireBarEl = document.getElementById('banner-fire-bar');
    if (fireBarEl) fireBarEl.style.width = `${Math.min(progressPercent, 100)}%`;

    const grossIncome = parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
    const sideGigNet = getSideGigYTDNet();
    const grossIncomeEl = document.getElementById('banner-gross-income');
    if (grossIncomeEl) grossIncomeEl.textContent = formatCurrency(grossIncome);
    const sideIncomeEl = document.getElementById('banner-side-income');
    if (sideIncomeEl) sideIncomeEl.textContent = sideGigNet > 0 ? `+ ${formatCurrency(sideGigNet)} side hustle` : 'No side income';

    renderAllocMiniBarsBanner();

    renderQuickStatsList();
    renderDashboardTopPositionsTable();
    renderDashboardLiquidPanel();
    renderAssetAllocationChart();
    renderDashboardProjectionsChart();

    renderImportedFilesTable();
    renderCustomAccountsTable();
    renderCDTable();
    renderCDLadderChart();
    renderUnifiedHoldingsTable();
    renderRealEstateTable();
    renderVehiclesTable();

    const monthlyBase = getMonthlyExpensesBase();
    document.getElementById('summary-monthly-spend').textContent = formatCurrency(monthlyBase);
    document.getElementById('summary-annual-spend').textContent = formatCurrency(monthlyBase * 12);
    
    const annualTaxDrag = (monthlyBase * 12) * (state.taxRate / 100);
    document.getElementById('summary-annual-tax').textContent = formatCurrency(annualTaxDrag);
    document.getElementById('summary-total-annual-need').textContent = formatCurrency(annualExpenses);

    renderSideGigLedgerTable();
    renderMonthlyCashFlow();
    calculateAndRenderProjections();
}

function insuranceToMonthly(ins) {
    const amt = ins.amt || 0;
    if (ins.freq === '6month') return amt / 6;
    if (ins.freq === 'annual') return amt / 12;
    return amt; // monthly
}

function getInsuranceMonthly() {
    const ins = state.insurances || {};
    return insuranceToMonthly(ins.car || {}) + insuranceToMonthly(ins.home || {});
}

function getMonthlyExpensesBase() {
    let base = 0;
    Object.keys(state.expenses).forEach(k => {
        base += state.expenses[k] || 0;
    });
    return base + getInsuranceMonthly();
}

function getAnnualExpensesTotal() {
    const baseAnnual = getMonthlyExpensesBase() * 12;
    const taxDrag = baseAnnual * (state.taxRate / 100);
    return baseAnnual + taxDrag;
}

function getAggregateCash() {
    let sum = 0;
    state.importedPositions.forEach(pos => {
        if (pos.symbol.includes('SPAXX') || pos.symbol.includes('FDRXX') || pos.description.includes('MONEY MARKET')) {
            sum += pos.value;
        }
    });
    state.customAccounts.forEach(acc => {
        if (acc.type === 'Cash' || acc.type === 'Savings') {
            sum += acc.value;
        }
    });
    return sum;
}

function getAggregateCDs() {
    let sum = 0;
    state.cds.forEach(cd => {
        sum += cd.principal || 0;
    });
    return sum;
}

function getAggregateEquities() {
    let sum = 0;
    state.importedPositions.forEach(pos => {
        if (!pos.symbol.includes('SPAXX') && !pos.symbol.includes('FDRXX') && !pos.description.includes('MONEY MARKET')) {
            sum += pos.value;
        }
    });
    state.customAccounts.forEach(acc => {
        if (acc.type === 'Brokerage' || acc.type === 'Crypto') {
            sum += acc.value;
        }
    });
    return sum;
}

function getAggregateOtherAssets() {
    let sum = 0;
    state.customAccounts.forEach(acc => {
        if (acc.type !== 'Cash' && acc.type !== 'Savings' && acc.type !== 'Brokerage' && acc.type !== 'Crypto') {
            sum += acc.value;
        }
    });
    return sum;
}

function getSideGigYTDNet() {
    let sum = 0;
    state.sideGigLedger.forEach(sg => {
        sum += sg.net;
    });
    return sum;
}

function getAggregateRealEstate() {
    return (state.realEstate || []).reduce((sum, re) => sum + Math.max(0, (re.marketValue || 0) - (re.mortgageBalance || 0)), 0);
}

function getAggregateVehicles() {
    return (state.vehicles || []).reduce((sum, v) => sum + Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)), 0);
}

function getAggregateNetWorth() {
    return getAggregateCash() + getAggregateCDs() + getAggregateEquities() + getAggregateOtherAssets() + getAggregateRealEstate() + getAggregateVehicles() + getSideGigYTDNet();
}

/* ==========================================================================
   Investment Positions Table (Collapsible Account Groups)
   ========================================================================== */

// Returns an inline color style on a continuous red→neutral→green scale.
// pnlPct: the position's P&L %; maxAbsPct: the largest abs P&L% in the dataset.
function pnlColorStyle(pnlPct, maxAbsPct) {
    if (maxAbsPct < 0.01 || pnlPct === 0) return 'color: var(--text-muted);';
    const norm = Math.max(-1, Math.min(1, pnlPct / maxAbsPct));
    if (norm > 0) {
        const l = Math.round(65 - norm * 18);
        const s = Math.round(50 + norm * 21);
        return `color: hsl(142,${s}%,${l}%);`;
    }
    const absN = -norm;
    const l = Math.round(65 - absN * 18);
    const s = Math.round(50 + absN * 21);
    return `color: hsl(0,${s}%,${l}%);`;
}

function sortPositions(positions) {
    const col = tableSortColumn;
    const dir = tableSortDir === 'asc' ? 1 : -1;
    return [...positions].sort((a, b) => {
        let av, bv;
        switch (col) {
            case 'symbol':   av = (a.symbol || '').toLowerCase(); bv = (b.symbol || '').toLowerCase(); break;
            case 'desc':     av = (a.description || '').toLowerCase(); bv = (b.description || '').toLowerCase(); break;
            case 'qty':      av = a.quantity || 0; bv = b.quantity || 0; break;
            case 'price':    av = a.lastPrice || 0; bv = b.lastPrice || 0; break;
            case 'cost':     av = a.costBasis || 0; bv = b.costBasis || 0; break;
            case 'value':    av = a.value || 0; bv = b.value || 0; break;
            default:         av = a.pnlDollar || 0; bv = b.pnlDollar || 0;
        }
        if (av < bv) return -dir;
        if (av > bv) return dir;
        return 0;
    });
}

window.setTableSort = function(col) {
    if (tableSortColumn === col) {
        tableSortDir = tableSortDir === 'desc' ? 'asc' : 'desc';
    } else {
        tableSortColumn = col;
        tableSortDir = col === 'pnl' || col === 'value' ? 'desc' : 'asc';
    }
    renderDashboardTopPositionsTable();
};

window.collapseAllGroups = function() {
    const allCollapsed = state.importedPositions.every(pos => !!collapsedAccounts[pos.account || 'Brokerage']);
    const grouped = {};
    state.importedPositions.forEach(pos => { grouped[pos.account || 'Brokerage'] = true; });
    Object.keys(grouped).forEach(acc => { collapsedAccounts[acc] = !allCollapsed; });
    renderDashboardTopPositionsTable();
};

window.toggleAccountGroup = function(accName) {
    collapsedAccounts[accName] = !collapsedAccounts[accName];
    renderDashboardTopPositionsTable();
};

/* ==========================================================================
   Cash & Fixed Income Dashboard Panel (merged cash accounts + CDs)
   ========================================================================== */

function initUnifiedAssetForm() {
    const tabs = document.querySelectorAll('.ua-tab-btn');
    const panels = ['account', 'cd', 'realestate', 'vehicle'];
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.uaTab;
            panels.forEach(p => {
                const el = document.getElementById(`ua-panel-${p}`);
                if (el) el.style.display = target === p ? '' : 'none';
            });
        });
    });
}

/* ==========================================================================
   Utility Functions
   ========================================================================== */

function formatCurrency(val) {
    const num = Number(val);
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(num);
}
