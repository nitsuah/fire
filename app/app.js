/* ==========================================================================
   FIRE Calculator & Tracker - Application Controller
   ========================================================================== */

// Global State
let state = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    expenses: {
        housing: 1500,
        utilities: 250,
        food: 400,
        transport: 300,
        healthcare: 150,
        discretionary: 500
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
let editingAccounts = [];
let editingCDs = [];

// Chart.js instance trackers
let assetAllocationChart = null;
let projectionsChart = null;
let dashboardProjectionsChart = null;

// Collapsible state per account name
let collapsedAccounts = {};

// Active allocation filter (null = all visible)
let activeAllocationFilter = null;

// Investment table sort state (default: P&L descending within each account group)
let tableSortColumn = 'pnl';
let tableSortDir = 'desc';

// Original allocation chart colors (used to restore after grey-out)
const ALLOC_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#3b82f6'];
const ALLOC_GREY = 'rgba(120,120,140,0.25)';

// Chart time-window state ('1m'|'1y'|'5y'|'10y'|'15y'|'all')
let dashProjWindow = 'all';
let projWindow = 'all';

// Price refresh timer
let priceRefreshTimer = null;

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

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
    await loadStateFromServer();
    initNavigation();
    initCSVImport();
    initAccountsManager();
    initCDManager();
    initExpenseManager();
    initSideGigManager();
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
    data.sideGigLedger = data.sideGigLedger || [];
    data.importedFiles = data.importedFiles || [];
    
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

        state.importedPositions.push({
            account: row[idxAccountName] || 'Brokerage',
            symbol: sym,
            description: row[idxDescription] || '',
            quantity: isNaN(qty) ? 0 : qty,
            lastPrice: isNaN(price) ? 0 : price,
            value: cleanedValue,
            costBasis: isNaN(basis) ? 0 : basis,
            pnlDollar: gainDollar,
            pnlPercent: gainPercent
        });
        importedCount++;
    }
    return importedCount;
}

function parseChaseStatement(rows) {
    let imported = 0;
    let totalOutflow = 0;
    
    rows.forEach((row, i) => {
        if (i === 0) return;
        if (row.length < 5) return;
        const amount = parseFloat(row[5]);
        if (!isNaN(amount) && amount < 0) {
            totalOutflow += Math.abs(amount);
            imported++;
        }
    });

    if (imported > 0) {
        state.expenses.discretionary = Math.round(totalOutflow);
    }
    return imported;
}

function parseCapitalOneStatement(rows) {
    let imported = 0;
    let totalOutflow = 0;

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const idxDebit = headers.indexOf('debit');

    if (idxDebit === -1) return 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < idxDebit) continue;
        const debit = parseFloat(row[idxDebit]);
        if (!isNaN(debit) && debit > 0) {
            totalOutflow += debit;
            imported++;
        }
    }

    if (imported > 0) {
        state.expenses.discretionary = Math.round(totalOutflow);
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
    renderCustomAccountsTable();
};

window.cancelEditAccount = function(id) {
    editingAccounts = editingAccounts.filter(x => x !== id);
    renderCustomAccountsTable();
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
    renderCDTable();
};

window.cancelEditCD = function(id) {
    editingCDs = editingCDs.filter(x => x !== id);
    renderCDTable();
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
    const nominalReturn = state.projectionSettings.expectedReturn / 100;
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

    const coastYears = retireAge - currentAge;
    const coastFireTarget = coastYears > 0 
        ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
        : fireNumber;

    // Retirement age vertical line data-point index
    let retirementLineIndex = -1;

    for (let yr = 0; yr <= span; yr++) {
        const age = currentAge + yr;
        labels.push(`Age ${age}`);
        nwData.push(Math.round(currentNW));
        fireLine.push(Math.round(fireNumber));
        leanFireLine.push(Math.round(fireNumber * 0.75));
        fatFireLine.push(Math.round(fireNumber * 1.25));
        coastFireLine.push(Math.round(coastFireTarget));

        if (age === retireAge) {
            retirementLineIndex = yr;
        }

        if (yr < span) {
            currentNW = (currentNW * (1 + realReturn)) + savings;
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

    return { labels, nwData, fireLine, leanFireLine, fatFireLine, coastFireLine, fireNumber, retirementLineIndex, cdEvents, realReturn, savings, networth };
}

function calculateAndRenderProjections() {
    const raw = buildProjectionData();
    renderProjectionsChart(sliceProjectionData(raw, projWindow));
    renderMilestones(raw.networth, raw.fireNumber, raw.realReturn, raw.savings);
}

function renderProjectionsChart(data) {
    const ctx = document.getElementById('chart-networth-projections');
    if (!ctx) return;

    if (projectionsChart) {
        projectionsChart.destroy();
    }

    const { labels, nwData, fireLine, leanFireLine, fatFireLine, coastFireLine, retirementLineIndex, cdEvents } = data;

    // Build annotation plugin data if available
    const annotations = {};

    if (retirementLineIndex >= 0) {
        annotations['retireLine'] = {
            type: 'line',
            xMin: retirementLineIndex,
            xMax: retirementLineIndex,
            borderColor: 'rgba(245, 158, 11, 0.85)',
            borderWidth: 2,
            borderDash: [6, 4],
            label: {
                display: true,
                content: `🎯 Retire`,
                position: 'start',
                color: '#f59e0b',
                font: { size: 10, family: 'Outfit' },
                backgroundColor: 'rgba(245,158,11,0.12)',
                padding: 4,
                yAdjust: -10
            }
        };
    }

    cdEvents.forEach((ev, i) => {
        annotations[`cd_${i}`] = {
            type: 'line',
            xMin: ev.yearIndex,
            xMax: ev.yearIndex,
            borderColor: 'rgba(16, 185, 129, 0.6)',
            borderWidth: 1,
            borderDash: [3, 4],
            label: {
                display: true,
                content: `💰 ${ev.label}`,
                position: 'end',
                color: '#10b981',
                font: { size: 9, family: 'Inter' },
                backgroundColor: 'rgba(16,185,129,0.1)',
                padding: 3,
                yAdjust: 10 + (i * 16)
            }
        };
    });

    projectionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Projected Net Worth',
                    data: nwData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    order: 1
                },
                {
                    label: 'FIRE Target (100%)',
                    data: fireLine,
                    borderColor: '#f43f5e',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    order: 2
                },
                {
                    label: 'Lean FIRE (75%)',
                    data: leanFireLine,
                    borderColor: 'rgba(244,63,94,0.4)',
                    borderDash: [3, 5],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    order: 3
                },
                {
                    label: 'Fat FIRE (125%)',
                    data: fatFireLine,
                    borderColor: 'rgba(139,92,246,0.4)',
                    borderDash: [3, 5],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    order: 4
                },
                {
                    label: 'Coast FIRE Target',
                    data: coastFireLine,
                    borderColor: 'rgba(16,185,129,0.5)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    order: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#9ca3af',
                        callback: (v) => '$' + (v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v)
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { 
                        color: '#9ca3af',
                        maxTicksLimit: 12,
                        maxRotation: 0
                    }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#f3f4f6', 
                        font: { family: 'Outfit', size: 11 },
                        boxWidth: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                    }
                },
                annotation: Object.keys(annotations).length > 0 ? { annotations } : undefined
            }
        }
    });
}

function renderDashboardProjectionsChart() {
    const ctx = document.getElementById('chart-dashboard-projections');
    if (!ctx) return;

    if (dashboardProjectionsChart) {
        dashboardProjectionsChart.destroy();
    }

    const raw = buildProjectionData();
    const { labels, nwData, fireLine, retirementLineIndex, cdEvents } = sliceProjectionData(raw, dashProjWindow);

    const annotations = {};
    if (retirementLineIndex >= 0) {
        annotations['retireLine'] = {
            type: 'line',
            xMin: retirementLineIndex,
            xMax: retirementLineIndex,
            borderColor: 'rgba(245, 158, 11, 0.7)',
            borderWidth: 1,
            borderDash: [4, 3],
            label: {
                display: true,
                content: '🎯 Retire',
                position: 'start',
                color: '#f59e0b',
                font: { size: 9 },
                backgroundColor: 'rgba(245,158,11,0.1)',
                padding: 3
            }
        };
    }
    cdEvents.forEach((ev, i) => {
        annotations[`cd_${i}`] = {
            type: 'line',
            xMin: ev.yearIndex,
            xMax: ev.yearIndex,
            borderColor: 'rgba(16,185,129,0.5)',
            borderWidth: 1,
            borderDash: [3, 4],
            label: {
                display: true,
                content: `💰 ${ev.label}`,
                position: 'end',
                color: '#10b981',
                font: { size: 9 },
                backgroundColor: 'rgba(16,185,129,0.1)',
                padding: 3,
                yAdjust: 10 + (i * 14)
            }
        };
    });

    dashboardProjectionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Net Worth',
                    data: nwData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0
                },
                {
                    label: 'FIRE Target',
                    data: fireLine,
                    borderColor: 'rgba(244,63,94,0.7)',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#6b7280',
                        font: { size: 10 },
                        maxTicksLimit: 4,
                        callback: (v) => '$' + (v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v)
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#6b7280', maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                    }
                },
                annotation: Object.keys(annotations).length > 0 ? { annotations } : undefined
            }
        }
    });
}

function renderMilestones(startingNw, targetFireNw, realReturnRate, annualSavings) {
    const container = document.getElementById('projection-milestones-container');
    if (!container) return;

    const retireAge = state.projectionSettings.retireAge || 60;
    const currentAge = state.projectionSettings.currentAge || 30;
    const coastYears = retireAge - currentAge;
    const coastFireTarget = coastYears > 0 
        ? targetFireNw / Math.pow(1 + Math.max(realReturnRate, 0.001), coastYears)
        : targetFireNw;

    const milestonesList = [
        { name: `Coast FIRE (${coastYears}y to compound)`, target: coastFireTarget },
        { name: 'Lean FIRE (75% of Target)', target: targetFireNw * 0.75 },
        { name: 'FIRE Baseline (100% of Target)', target: targetFireNw },
        { name: 'Fat FIRE (125% of Target)', target: targetFireNw * 1.25 }
    ];

    let html = '';
    milestonesList.forEach(m => {
        let yearsRequired = 'N/A';
        const isAchieved = startingNw >= m.target;

        if (isAchieved) {
            yearsRequired = 'Achieved 🎉';
        } else {
            if (realReturnRate > 0) {
                const num = (m.target * realReturnRate) + annualSavings;
                const den = (startingNw * realReturnRate) + annualSavings;
                if (num > 0 && den > 0) {
                    const yrs = Math.log(num / den) / Math.log(1 + realReturnRate);
                    if (yrs > 0 && isFinite(yrs)) {
                        const estAge = currentAge + Math.ceil(yrs);
                        yearsRequired = `${yrs.toFixed(1)} yrs (Age ${estAge})`;
                    }
                }
            } else if (annualSavings > 0) {
                const yrs = (m.target - startingNw) / annualSavings;
                if (yrs > 0) {
                    yearsRequired = `${yrs.toFixed(1)} yrs (Age ${currentAge + Math.ceil(yrs)})`;
                }
            }
        }

        html += `
            <div class="milestone-card ${isAchieved ? 'achieved' : ''}">
                <span class="milestone-title">${m.name}</span>
                <span class="milestone-val ${isAchieved ? 'text-emerald' : 'text-purple'}">${formatCurrency(m.target)}</span>
                <span class="milestone-status">${isAchieved ? 'Goal Completed ✅' : `Est: <strong>${yearsRequired}</strong>`}</span>
            </div>
        `;
    });

    container.innerHTML = html;
}

/* ==========================================================================
   UI Refresh & Computations
   ========================================================================== */

function refreshAllUI() {
    calculateEbayProfit();
    
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? (annualExpenses / swr) : 0;
    const progressPercent = fireNumber > 0 ? Math.min((networth / fireNumber) * 100, 100) : 0;

    document.getElementById('banner-networth').textContent = formatCurrency(networth);
    document.getElementById('banner-spend').textContent = formatCurrency(annualExpenses);
    document.getElementById('banner-target').textContent = formatCurrency(fireNumber);
    document.getElementById('banner-progress').textContent = `${progressPercent.toFixed(1)}%`;

    const fillEl = document.getElementById('readiness-fill');
    if (fillEl) fillEl.style.width = `${progressPercent}%`;
    
    const targetLabel = document.getElementById('readiness-target-label');
    if (targetLabel) targetLabel.textContent = `Target: ${formatCurrency(fireNumber)}`;
    
    const statusText = document.getElementById('readiness-status-text');
    if (statusText) {
        if (progressPercent >= 100) {
            statusText.innerHTML = `Congratulations! You have reached <strong>${progressPercent.toFixed(1)}%</strong> of your FIRE goal. You are officially financially independent! 🚀`;
        } else {
            statusText.innerHTML = `You are currently <strong>${progressPercent.toFixed(1)}%</strong> of the way to your Safe Withdrawal FIRE goal. Save another <strong>${formatCurrency(Math.max(fireNumber - networth, 0))}</strong> to reach your target!`;
        }
    }

    renderQuickStatsList();
    renderDashboardTopPositionsTable();
    renderDashboardCDNotifications();
    renderAssetAllocationChart();
    renderDashboardProjectionsChart();

    renderImportedFilesTable();
    renderCustomAccountsTable();
    renderCDTable();

    const monthlyBase = getMonthlyExpensesBase();
    document.getElementById('summary-monthly-spend').textContent = formatCurrency(monthlyBase);
    document.getElementById('summary-annual-spend').textContent = formatCurrency(monthlyBase * 12);
    
    const annualTaxDrag = (monthlyBase * 12) * (state.taxRate / 100);
    document.getElementById('summary-annual-tax').textContent = formatCurrency(annualTaxDrag);
    document.getElementById('summary-total-annual-need').textContent = formatCurrency(annualExpenses);

    renderSideGigLedgerTable();
    calculateAndRenderProjections();
}

function getMonthlyExpensesBase() {
    let base = 0;
    Object.keys(state.expenses).forEach(k => {
        base += state.expenses[k] || 0;
    });
    return base;
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

function getAggregateNetWorth() {
    return getAggregateCash() + getAggregateCDs() + getAggregateEquities() + getAggregateOtherAssets() + getSideGigYTDNet();
}

function renderQuickStatsList() {
    document.getElementById('stat-cash').textContent = formatCurrency(getAggregateCash());
    document.getElementById('stat-cds').textContent = formatCurrency(getAggregateCDs());
    document.getElementById('stat-equities').textContent = formatCurrency(getAggregateEquities());
    document.getElementById('stat-sidegig').textContent = formatCurrency(getSideGigYTDNet());
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

function renderDashboardTopPositionsTable() {
    const tbody = document.querySelector('#table-dashboard-positions tbody');
    if (!tbody) return;

    if (state.importedPositions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No investments imported yet. Upload a Fidelity CSV statement in the Accounts tab.</td></tr>`;
        updateSortHeaders();
        return;
    }

    // Compute max abs P&L% across entire dataset for relative color scaling
    const maxAbsPct = state.importedPositions.reduce((m, p) => Math.max(m, Math.abs(p.pnlPercent || 0)), 0);

    // Group positions by Account Name
    const grouped = {};
    state.importedPositions.forEach(pos => {
        const acc = pos.account || 'Brokerage';
        if (!grouped[acc]) grouped[acc] = [];
        grouped[acc].push(pos);
    });

    let html = '';
    Object.keys(grouped).forEach(accName => {
        const positions = sortPositions(grouped[accName]);
        const accTotalVal = positions.reduce((sum, p) => sum + (p.value || 0), 0);
        const accCostBasis = positions.reduce((sum, p) => sum + (p.costBasis || 0), 0);
        const accPnL = accCostBasis > 0 ? accTotalVal - accCostBasis : positions.reduce((sum, p) => sum + (p.pnlDollar || 0), 0);
        const accPnLPct = accCostBasis > 0 ? (accPnL / accCostBasis) * 100 : 0;
        const accPnLStyle = pnlColorStyle(accPnLPct, maxAbsPct || Math.abs(accPnLPct));
        const accValStyle = pnlColorStyle(accPnLPct, maxAbsPct || Math.abs(accPnLPct));
        const accPnLStr = accPnL >= 0
            ? `+${formatCurrency(accPnL)} (+${Math.abs(accPnLPct).toFixed(2)}%)`
            : `-${formatCurrency(Math.abs(accPnL))} (${accPnLPct.toFixed(2)}%)`;

        const isCollapsed = !!collapsedAccounts[accName];
        const chevronClass = isCollapsed ? 'chevron-icon collapsed' : 'chevron-icon';
        const safeAccName = accName.replace(/'/g, "\\'");

        html += `
            <tr class="table-group-header" onclick="toggleAccountGroup('${safeAccName}')">
                <td colspan="5"><span class="${chevronClass}">▼</span> <strong>${accName}</strong></td>
                <td class="text-right font-bold" style="${accValStyle}">${formatCurrency(accTotalVal)}</td>
                <td class="text-right font-bold" style="${accPnLStyle}">${accPnLStr}</td>
            </tr>
        `;

        if (!isCollapsed) {
            positions.forEach(pos => {
                const pnlVal = pos.pnlDollar || 0;
                const pnlPct = pos.pnlPercent || 0;
                const pnlStyle = pnlColorStyle(pnlPct, maxAbsPct);
                const valStyle = pnlColorStyle(pnlPct, maxAbsPct);

                let pnlText = '—';
                if (Math.abs(pnlVal) > 0.01) {
                    pnlText = pnlVal > 0
                        ? `+${formatCurrency(pnlVal)} (+${Math.abs(pnlPct).toFixed(2)}%)`
                        : `-${formatCurrency(Math.abs(pnlVal))} (${pnlPct.toFixed(2)}%)`;
                }

                const sym = pos.symbol || '';
                html += `
                    <tr class="position-row" data-account="${accName.replace(/"/g, '&quot;')}" data-symbol="${sym}">
                        <td class="font-bold text-purple">${sym}</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pos.description || ''}</td>
                        <td class="text-right">${(pos.quantity || 0).toLocaleString(undefined, {maximumFractionDigits: 3})}</td>
                        <td class="text-right">${formatCurrency(pos.lastPrice || 0)}</td>
                        <td class="text-right text-muted">${(pos.costBasis || 0) > 0 ? formatCurrency(pos.costBasis) : '—'}</td>
                        <td class="text-right font-bold" style="${valStyle}">${formatCurrency(pos.value || 0)}</td>
                        <td class="text-right font-bold" style="${pnlStyle}">${pnlText}</td>
                    </tr>
                `;
            });
        }
    });
    tbody.innerHTML = html;
    updateSortHeaders();
}

function updateSortHeaders() {
    const cols = ['symbol', 'desc', 'qty', 'price', 'cost', 'value', 'pnl'];
    cols.forEach(col => {
        const th = document.querySelector(`#table-dashboard-positions thead th[data-sort="${col}"]`);
        if (!th) return;
        th.classList.remove('sort-asc', 'sort-desc');
        if (col === tableSortColumn) th.classList.add(`sort-${tableSortDir}`);
    });
}

window.toggleAccountGroup = function(accName) {
    collapsedAccounts[accName] = !collapsedAccounts[accName];
    renderDashboardTopPositionsTable();
};

/* ==========================================================================
   Asset Allocation Chart (Interactive - click to filter positions)
   ========================================================================== */

function renderAssetAllocationChart() {
    const ctx = document.getElementById('chart-asset-allocation');
    if (!ctx) return;

    const cash = getAggregateCash();
    const cds = getAggregateCDs();
    const equities = getAggregateEquities();
    const other = getAggregateOtherAssets() + getSideGigYTDNet();
    const total = cash + cds + equities + other;

    if (cash === 0 && cds === 0 && equities === 0 && other === 0) {
        if (assetAllocationChart) { assetAllocationChart.destroy(); assetAllocationChart = null; }
        return;
    }

    if (assetAllocationChart) {
        assetAllocationChart.destroy();
    }

    const pct = (v) => total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0%';

    const labels = [
        `Cash / SPAXX  ${pct(cash)}`,
        `CDs & Fixed   ${pct(cds)}`,
        `Equities      ${pct(equities)}`,
        `Other Assets  ${pct(other)}`
    ];
    const categoryKeys = ['Cash', 'CDs', 'Equities', 'Other'];

    assetAllocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: [cash, cds, equities, other],
                backgroundColor: ['#10b981', '#f59e0b', '#8b5cf6', '#3b82f6'],
                borderWidth: 2,
                borderColor: '#151c2c',
                hoverBorderColor: '#ffffff',
                hoverBorderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#9ca3af',
                        font: { size: 11, family: 'Inter' },
                        padding: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${formatCurrency(ctx.raw)} (${pct(ctx.raw)})`
                    }
                }
            },
            cutout: '68%',
            onClick: (evt, activeElements) => {
                if (activeElements.length === 0) {
                    // Deselect – restore all rows
                    activeAllocationFilter = null;
                    applyAllocationFilter(null);
                    return;
                }
                const idx = activeElements[0].index;
                const clickedKey = categoryKeys[idx];
                if (activeAllocationFilter === clickedKey) {
                    // Toggle off
                    activeAllocationFilter = null;
                    applyAllocationFilter(null);
                } else {
                    activeAllocationFilter = clickedKey;
                    applyAllocationFilter(clickedKey);
                }
            }
        }
    });
}

const ALLOC_CATEGORY_KEYS = ['Cash', 'CDs', 'Equities', 'Other'];

function applyAllocationFilter(categoryKey) {
    // Update table rows
    const rows = document.querySelectorAll('#table-dashboard-positions .position-row');
    rows.forEach(row => {
        if (categoryKey === null) {
            row.classList.remove('p-grayed-out');
            return;
        }
        const sym = row.dataset.symbol || '';
        const desc = (row.querySelector('td:nth-child(2)')?.textContent || '').toUpperCase();

        let match = false;
        if (categoryKey === 'Equities') {
            match = !sym.includes('SPAXX') && !sym.includes('FDRXX') && !desc.includes('MONEY MARKET');
        } else if (categoryKey === 'Cash') {
            match = sym.includes('SPAXX') || sym.includes('FDRXX') || desc.includes('MONEY MARKET');
        } else if (categoryKey === 'CDs' || categoryKey === 'Other') {
            match = true;
        }

        if (match) {
            row.classList.remove('p-grayed-out');
        } else {
            row.classList.add('p-grayed-out');
        }
    });

    // Update pie chart slice colors: grey out non-selected slices
    if (assetAllocationChart) {
        const dataset = assetAllocationChart.data.datasets[0];
        const selectedIdx = categoryKey !== null ? ALLOC_CATEGORY_KEYS.indexOf(categoryKey) : -1;
        dataset.backgroundColor = ALLOC_COLORS.map((c, i) =>
            categoryKey === null || i === selectedIdx ? c : ALLOC_GREY
        );
        dataset.borderColor = ALLOC_COLORS.map((c, i) =>
            categoryKey === null || i === selectedIdx ? '#151c2c' : 'transparent'
        );
        assetAllocationChart.update('none');
    }
}

/* ==========================================================================
   CD Notifications Panel
   ========================================================================== */

function renderDashboardCDNotifications() {
    const ul = document.getElementById('dashboard-cd-list');
    if (!ul) return;

    if (state.cds.length === 0) {
        ul.innerHTML = `<li class="text-muted text-center py-4">No active Certificate of Deposits recorded. Add them in the CDs tab.</li>`;
        return;
    }

    const today = new Date();
    let html = '';

    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined || cd.principal === null) return;
        const matDate = new Date(cd.maturity);
        const timeDiff = matDate - today;
        const daysToMaturity = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        
        let urgencyClass = '';
        let maturityText = '';

        if (daysToMaturity < 0) {
            urgencyClass = 'urgent';
            maturityText = `Matured on ${cd.maturity} (${Math.abs(daysToMaturity)} days ago)`;
        } else if (daysToMaturity <= 30) {
            urgencyClass = 'urgent';
            maturityText = `Matures soon on ${cd.maturity} (${daysToMaturity} days left)`;
        } else {
            maturityText = `Matures on ${cd.maturity} (${daysToMaturity} days left)`;
        }

        html += `
            <li class="notification-item ${urgencyClass}">
                <div class="notification-text">
                    <strong>${cd.bank} CD</strong> | ${formatCurrency(cd.principal)} at <strong>${Number(cd.rate).toFixed(2)}%</strong> APY
                    <div class="notification-date">${maturityText}</div>
                </div>
            </li>
        `;
    });
    ul.innerHTML = html;
}

/* ==========================================================================
   Imported Files Table
   ========================================================================== */

function renderImportedFilesTable() {
    const tbody = document.querySelector('#table-imported-files tbody');
    if (!tbody) return;

    if (state.importedFiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No files imported yet.</td></tr>`;
        return;
    }

    let html = '';
    state.importedFiles.forEach((file, index) => {
        html += `
            <tr>
                <td class="font-bold">${file.name}</td>
                <td><span class="text-purple">${file.source}</span></td>
                <td>${file.date}</td>
                <td>${file.records} records</td>
                <td class="text-right">
                    <button class="delete-btn" onclick="deleteImportedFile(${index})">Remove</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

/* ==========================================================================
   Custom Accounts Table
   ========================================================================== */

function renderCustomAccountsTable() {
    const tbody = document.querySelector('#table-custom-accounts tbody');
    if (!tbody) return;

    if (state.customAccounts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No manual accounts entered.</td></tr>`;
        return;
    }

    let html = '';
    state.customAccounts.forEach(acc => {
        if (!acc || acc.value === undefined || acc.value === null) return;
        const isEditing = editingAccounts.includes(acc.id);
        
        if (isEditing) {
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${acc.name}"></td>
                    <td><span class="text-muted">${acc.type}</span></td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 80px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy).toFixed(2)}" ${(acc.type === 'Savings' || acc.type === 'Cash') ? '' : 'disabled'}>
                    </td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 120px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}">
                    </td>
                    <td class="text-right">
                        <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                        <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            const hasYield = acc.type === 'Savings' || acc.type === 'Cash';
            html += `
                <tr>
                    <td class="font-bold">${acc.name}</td>
                    <td><span class="text-muted">${acc.type}</span></td>
                    <td class="text-right text-amber font-bold">${hasYield ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                    <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                    <td class="text-right">
                        <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    tbody.innerHTML = html;
}

/* ==========================================================================
   CD Table
   ========================================================================== */

function renderCDTable() {
    const tbody = document.querySelector('#table-cd-list tbody');
    if (!tbody) return;

    let totalCDPrincipal = 0;
    let totalAnnualFixedYield = 0;
    let totalFixedAssets = 0;

    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        totalCDPrincipal += cd.principal || 0;
        totalAnnualFixedYield += (cd.principal || 0) * ((cd.rate || 0) / 100);
    });
    totalFixedAssets += totalCDPrincipal;

    state.customAccounts.forEach(acc => {
        if ((acc.type === 'Savings' || acc.type === 'Cash') && acc.apy > 0) {
            totalAnnualFixedYield += (acc.value || 0) * ((acc.apy || 0) / 100);
            totalFixedAssets += acc.value || 0;
        }
    });

    const weightedApy = totalFixedAssets > 0 ? (totalAnnualFixedYield / totalFixedAssets) * 100 : 0;
    document.getElementById('cd-total-principal').textContent = formatCurrency(totalCDPrincipal);
    document.getElementById('cd-total-interest').textContent = `${formatCurrency(totalAnnualFixedYield)} (Annual)`;
    document.getElementById('cd-weighted-apy').textContent = `${weightedApy.toFixed(2)}%`;

    if (state.cds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No CDs logged. Enter your CD details in the form.</td></tr>`;
        return;
    }

    let html = '';
    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);
        
        if (isEditing) {
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${cd.bank}"></td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 100px;" id="edit-cd-principal-${cd.id}" step="0.01" value="${Number(cd.principal).toFixed(2)}">
                    </td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 70px;" id="edit-cd-rate-${cd.id}" step="0.01" value="${Number(cd.rate).toFixed(2)}">
                    </td>
                    <td><input type="date" class="inline-edit-input" id="edit-cd-start-${cd.id}" value="${cd.startDate || ''}"></td>
                    <td><input type="date" class="inline-edit-input" id="edit-cd-maturity-${cd.id}" value="${cd.maturity}"></td>
                    <td class="text-right">—</td>
                    <td class="text-right">—</td>
                    <td class="text-right">
                        <button class="save-btn" onclick="saveEditCD('${cd.id}')">Save</button>
                        <button class="cancel-btn" onclick="cancelEditCD('${cd.id}')">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            const interest = (cd.principal || 0) * ((cd.rate || 0) / 100);
            const isMatured = new Date(cd.maturity) < new Date();
            
            html += `
                <tr>
                    <td class="font-bold">${cd.bank}</td>
                    <td class="text-right font-bold">${formatCurrency(cd.principal)}</td>
                    <td class="text-right text-amber font-bold">${Number(cd.rate).toFixed(2)}%</td>
                    <td>${cd.startDate || '—'}</td>
                    <td>${cd.maturity}</td>
                    <td class="text-right text-emerald">${formatCurrency(interest)} (Annual)</td>
                    <td class="text-right">
                        <span style="color: ${isMatured ? 'var(--color-danger)' : 'var(--color-success)'}">
                            ${isMatured ? 'Matured' : 'Active'}
                        </span>
                    </td>
                    <td class="text-right">
                        <button class="edit-btn" onclick="startEditCD('${cd.id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteCD('${cd.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    tbody.innerHTML = html;
}

/* ==========================================================================
   Side Gig Ledger Table
   ========================================================================== */

function renderSideGigLedgerTable() {
    const tbody = document.querySelector('#table-sidegig-history tbody');
    if (!tbody) return;

    if (state.sideGigLedger.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No manual side hustle income logged yet. Use the eBay calculator or add below.</td></tr>`;
        return;
    }

    let html = '';
    state.sideGigLedger.forEach(sg => {
        html += `
            <tr>
                <td class="font-bold">${sg.desc}</td>
                <td><span class="text-muted">${sg.category}</span></td>
                <td class="text-right text-white">${formatCurrency(sg.revenue)}</td>
                <td class="text-right text-coral">${formatCurrency(sg.expenses)}</td>
                <td class="text-right font-bold text-emerald">${formatCurrency(sg.net)}</td>
                <td class="text-right">
                    <button class="delete-btn" onclick="deleteSideGigEntry('${sg.id}')">Delete</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
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
