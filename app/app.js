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
