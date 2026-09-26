/* ==========================================================================
   expenses.js — Expenses & Taxes Manager
   Depends on globals: state, saveState, refreshAllUI
   ========================================================================== */

// Copy expense / tax / insurance values from state into their form inputs.
// Called on init and again after a tab re-syncs from the server (state.js),
// since several totals (e.g. gross income) are read back from these inputs.
function syncExpenseInputsFromState() {
    document.querySelectorAll('.expense-input').forEach((input) => {
        const id = input.id.replace('exp-', '');
        if (state.expenses[id] !== undefined) {
            input.value = state.expenses[id];
        }
    });

    const taxSlider = document.getElementById('tax-rate');
    const taxDisplay = document.getElementById('tax-rate-display');
    const grossIncomeInput = document.getElementById('tax-gross-income');
    const filingStateSelect = document.getElementById('tax-filing-state');
    if (state.taxRate !== undefined && taxSlider) {
        taxSlider.value = state.taxRate;
        if (taxDisplay) taxDisplay.textContent = `${state.taxRate}%`;
    }
    if (state.taxGrossIncome !== undefined && grossIncomeInput) {
        grossIncomeInput.value = state.taxGrossIncome;
    }
    if (state.taxFilingState !== undefined && filingStateSelect) {
        filingStateSelect.value = state.taxFilingState;
    }

    const ins = state.insurances || {};
    const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el && v !== undefined) el.value = v;
    };
    setVal('ins-car-amt', ins.car?.amt);
    setVal('ins-car-freq', ins.car?.freq);
    setVal('ins-home-amt', ins.home?.amt);
    setVal('ins-home-freq', ins.home?.freq);
}

function initExpenseManager() {
    const inputs = document.querySelectorAll('.expense-input');
    const taxSlider = document.getElementById('tax-rate');
    const taxDisplay = document.getElementById('tax-rate-display');
    const grossIncomeInput = document.getElementById('tax-gross-income');
    const filingStateSelect = document.getElementById('tax-filing-state');

    syncExpenseInputsFromState();

    inputs.forEach((input) => {
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
    async function autoComputeTax() {
        const gross = parseFloat(grossIncomeInput.value) || 0;
        const filingState = filingStateSelect.value;
        state.taxGrossIncome = gross;
        state.taxFilingState = filingState;
        if (gross > 0) {
            const estimated = computeEffectiveTaxRate(gross, filingState);
            state.taxRate = estimated;
            taxSlider.value = estimated;
            taxDisplay.textContent = `${estimated}%`;
        }
        try {
            await saveState();
        } catch (err) {
            console.error('Failed to save tax settings:', err);
        }
        refreshAllUI();
    }

    grossIncomeInput.addEventListener('change', autoComputeTax);
    filingStateSelect.addEventListener('change', autoComputeTax);
}

function computeEffectiveTaxRate(grossIncome, filingState) {
    // 2024 Federal brackets (single filer, simplified)
    const federalBrackets = [
        { limit: 11600, rate: 0.1 },
        { limit: 47150, rate: 0.12 },
        { limit: 100525, rate: 0.22 },
        { limit: 191950, rate: 0.24 },
        { limit: 243725, rate: 0.32 },
        { limit: 609350, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
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
        TN: 0.0,
        AK: 0.0,
        NH: 0.0,
        SD: 0.0,
        WY: 0.0,
        IL: 0.0495, // flat
        CA: grossIncome > 300000 ? 0.113 : grossIncome > 100000 ? 0.093 : 0.073,
        NY: grossIncome > 215400 ? 0.109 : grossIncome > 80650 ? 0.0685 : 0.045,
        Other: 0.04,
    };

    const stateRate =
        stateTaxRates[filingState] !== undefined
            ? stateTaxRates[filingState]
            : 0.04;
    const stateTax = grossIncome * stateRate;

    // FICA (Social Security 6.2% up to $168,600 + Medicare 1.45%)
    const ficaTax =
        Math.min(grossIncome, 168600) * 0.062 + grossIncome * 0.0145;

    const totalTax = federalTax + stateTax + ficaTax;
    const effectiveRate = Math.round((totalTax / grossIncome) * 100);
    return Math.min(Math.max(effectiveRate, 0), 50);
}
