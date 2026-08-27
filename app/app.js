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
    taxGrossIncome: 100000,
    taxFilingState: 'NY',
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

// Base return rate before scenario offset is applied (null = use projectionSettings)
var scenarioOffset = 0; // +2 = bull, -2 = bear, 0 = base

// Price refresh timer
var priceRefreshTimer = null;

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
    if (typeof window.updateNotifUI === 'function') window.updateNotifUI();
}

/* ==========================================================================
   Aggregate Helpers (global wrappers around state)
   ========================================================================== */

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

function isSettledCash(pos) {
    const sym = (pos.symbol || '').toUpperCase();
    const desc = (pos.description || '').toUpperCase();
    return sym.includes('SPAXX') || sym.includes('FDRXX') || sym.includes('FZSSX') || sym.includes('FZFXX') ||
        sym === '**' || desc.includes('PENDING ACTIVITY') || desc.includes('MONEY MARKET') || desc.includes('CORE POSITION');
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

/* ==========================================================================
   Settings Page Functions
   ========================================================================== */

// Notification Settings
function saveNotificationSettings() {
    const settings = {
        enabled: document.getElementById('setting-notifications-enabled')?.checked || false,
        cdAlerts: document.getElementById('setting-cd-alerts')?.checked || false,
        fireMilestones: document.getElementById('setting-fire-milestones')?.checked || false,
        rebalanceAlerts: document.getElementById('setting-rebalance-alerts')?.checked || false,
        taxHarvestAlerts: document.getElementById('setting-tax-harvest-alerts')?.checked || false,
    };
    state.notificationSettings = settings;
    saveState();
    // Also update the dashboard notification card if it exists
    updateNotificationStatusDisplay();
}

function loadNotificationSettings() {
    const settings = state.notificationSettings || {
        enabled: false,
        cdAlerts: true,
        fireMilestones: true,
        rebalanceAlerts: false,
        taxHarvestAlerts: false,
    };
    document.getElementById('setting-notifications-enabled').checked = settings.enabled;
    document.getElementById('setting-cd-alerts').checked = settings.cdAlerts;
    document.getElementById('setting-fire-milestones').checked = settings.fireMilestones;
    document.getElementById('setting-rebalance-alerts').checked = settings.rebalanceAlerts;
    document.getElementById('setting-tax-harvest-alerts').checked = settings.taxHarvestAlerts;
    updateNotificationStatusDisplay();
}

function updateNotificationStatusDisplay() {
    const statusEl = document.getElementById('notification-permission-status');
    if (!statusEl) return;
    if (!('Notification' in window)) {
        statusEl.textContent = '🚫 Notifications not supported in this browser';
        statusEl.style.color = 'var(--text-muted)';
        return;
    }
    const perm = Notification.permission;
    if (perm === 'granted') {
        statusEl.textContent = '✅ Notifications enabled';
        statusEl.style.color = 'var(--color-success)';
    } else if (perm === 'denied') {
        statusEl.textContent = '❌ Notifications blocked — enable in browser settings';
        statusEl.style.color = 'var(--color-danger)';
    } else {
        statusEl.textContent = '⏳ Notifications not requested yet';
        statusEl.style.color = 'var(--text-muted)';
    }
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('This browser does not support notifications.');
        return;
    }
    Notification.requestPermission().then(perm => {
        updateNotificationStatusDisplay();
        if (perm === 'granted') {
            new Notification('FIRE Tracker', {
                body: 'Notifications enabled! You\'ll receive alerts for FIRE milestones and CD maturities.',
                icon: '/favicon.ico'
            });
        }
    });
}

// Data Export/Import
function exportFullState() {
    const dataStr = 'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
        'download',
        `fire_tracker_backup_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function exportCSV() {
    // Export holdings as CSV
    let csv = 'Type,Name,Value,Cost Basis,P&L,Account\n';
    state.customAccounts.forEach(acc => {
        csv += `${acc.type},${acc.name || ''},${acc.value},${acc.costBasis || 0},${acc.value - (acc.costBasis || 0)},${acc.account || ''}\n`;
    });
    state.importedPositions.forEach(pos => {
        csv += `Position,${pos.symbol},${pos.value},${pos.costBasis || 0},${pos.pnlDollar || 0},${pos.account || ''}\n`;
    });
    state.cds.forEach(cd => {
        csv += `CD,${cd.bank},${cd.principal},${cd.principal},0,${cd.bank}\n`;
    });
    state.realEstate.forEach(re => {
        const equity = Math.max(0, (re.marketValue || 0) - (re.mortgageBalance || 0));
        csv += `Real Estate,${re.address || re.type},${re.marketValue},${re.purchasePrice || 0},${equity - (re.purchasePrice || 0)},${re.type}\n`;
    });
    state.vehicles.forEach(v => {
        const equity = Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0));
        csv += `Vehicle,${v.year} ${v.make} ${v.model},${v.currentValue},${v.purchasePrice || 0},${equity - (v.purchasePrice || 0)},${v.type || ''}\n`;
    });

    const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
        'download',
        `fire_tracker_holdings_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importFullState(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState && typeof importedState === 'object') {
                state = sanitizeState(importedState);
                await saveState();
                refreshAllUI();
                alert('Full state imported successfully!');
            } else {
                alert('Invalid backup structure.');
            }
        } catch (err) {
            alert('Failed to parse JSON file: ' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const lines = text.trim().split('\n');
            if (lines.length < 2) {
                alert('CSV file appears empty or invalid.');
                return;
            }
            // Simple CSV import - assumes headers: Type,Name,Value,Cost Basis,P&L,Account
            let imported = 0;
            for (let i = 1; i < lines.length; i++) {
                const [type, name, value, costBasis, pnl, account] = lines[i].split(',');
                if (!type || !name) continue;
                const val = parseFloat(value) || 0;
                const cost = parseFloat(costBasis) || 0;
                if (type === 'Cash' || type === 'Savings') {
                    state.customAccounts.push({ type, name, value: val, costBasis: cost, apy: 0 });
                    imported++;
                } else if (type === 'Brokerage' || type === 'Crypto') {
                    state.customAccounts.push({ type, name, value: val, costBasis: cost, apy: 0 });
                    imported++;
                } else if (type === 'CD') {
                    state.cds.push({ bank: name, principal: val, rate: 0, maturity: '', startDate: '' });
                    imported++;
                }
            }
            await saveState();
            refreshAllUI();
            alert(`Imported ${imported} records from CSV.`);
        } catch (err) {
            alert('Failed to import CSV: ' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Projection Defaults
function saveProjectionDefaults() {
    const defaults = {
        currentAge: parseInt(document.getElementById('default-current-age')?.value) || 30,
        retireAge: parseInt(document.getElementById('default-retire-age')?.value) || 60,
        annualSavings: parseFloat(document.getElementById('default-annual-savings')?.value) || 20000,
        expectedReturn: parseFloat(document.getElementById('default-expected-return')?.value) || 7.0,
        inflation: parseFloat(document.getElementById('default-inflation')?.value) || 3.0,
        swr: parseFloat(document.getElementById('default-swr')?.value) || 4.0,
        spanYears: parseInt(document.getElementById('default-span-years')?.value) || 30,
    };
    state.projectionDefaults = defaults;
    // Also update the current projection settings if they're using defaults
    if (!state.projectionSettings.currentAge || state.projectionSettings.currentAge === 30) {
        state.projectionSettings.currentAge = defaults.currentAge;
        state.projectionSettings.retireAge = defaults.retireAge;
        state.projectionSettings.annualSavings = defaults.annualSavings;
        state.projectionSettings.expectedReturn = defaults.expectedReturn;
        state.projectionSettings.inflationRate = defaults.inflation;
        state.projectionSettings.swr = defaults.swr;
        state.projectionSettings.spanYears = defaults.spanYears;
    }
    saveState();
}

function loadProjectionDefaults() {
    const defaults = state.projectionDefaults || {
        currentAge: 30,
        retireAge: 60,
        annualSavings: 20000,
        expectedReturn: 7.0,
        inflation: 3.0,
        swr: 4.0,
        spanYears: 30,
    };
    document.getElementById('default-current-age').value = defaults.currentAge;
    document.getElementById('default-retire-age').value = defaults.retireAge;
    document.getElementById('default-annual-savings').value = defaults.annualSavings;
    document.getElementById('default-expected-return').value = defaults.expectedReturn;
    document.getElementById('default-inflation').value = defaults.inflation;
    document.getElementById('default-swr').value = defaults.swr;
    document.getElementById('default-span-years').value = defaults.spanYears;
}

// Danger Zone
function resetAllData() {
    if (!confirm('⚠️ This will DELETE ALL your financial data permanently. This cannot be undone.\n\nAre you absolutely sure?')) {
        return;
    }
    const confirmText = prompt(
        '⚠️ FINAL WARNING: All accounts, CDs, real estate, vehicles, expenses, side income history, and settings will be wiped.\n\nType DELETE EVERYTHING to confirm:',
    );
    if (confirmText !== 'DELETE EVERYTHING') {
        return;
    }
    // Reset to initial state
    state = {
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
        taxGrossIncome: 100000,
        taxFilingState: 'NY',
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
        importedFiles: [],
        notificationSettings: {
            enabled: false,
            cdAlerts: true,
            fireMilestones: true,
            rebalanceAlerts: false,
            taxHarvestAlerts: false,
        },
        projectionDefaults: {
            currentAge: 30,
            retireAge: 60,
            annualSavings: 20000,
            expectedReturn: 7.0,
            inflation: 3.0,
            swr: 4.0,
            spanYears: 30,
        }
    };
    saveState();
    refreshAllUI();
    alert('All data has been reset to defaults.');
}

function clearSideGigLedger() {
    if (!confirm('This will clear all side income history. Continue?')) {
        return;
    }
    state.sideGigLedger = [];
    saveState();
    refreshAllUI();
    alert('Side income history cleared.');
}

// Initialize settings on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Settings functions are initialized via their own calls
});

// Also load settings when the settings tab is shown
window.loadSettingsTab = function() {
    loadNotificationSettings();
    loadProjectionDefaults();
};
