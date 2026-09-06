/* ==========================================================================
   projections.js — Net Worth Projections Engine & Chart Controls
   Depends on globals: state, scenarioOffset, projLineToggles, dashProjWindow,
   projWindow, US_MEDIAN_SAVINGS, saveState, refreshAllUI,
   getAggregateNetWorth, getAnnualExpensesTotal,
   renderDashboardProjectionsChart, renderProjectionsChart,
   renderMilestones, renderScenarioComparison
   ========================================================================== */

// US median retirement savings by age (Vanguard How America Saves 2023)
var US_MEDIAN_SAVINGS = {
    20: 8000,
    25: 19000,
    30: 45000,
    35: 97000,
    40: 130000,
    45: 160000,
    50: 200000,
    55: 250000,
    60: 330000,
    65: 400000,
    70: 420000,
};

// Returns the number of data-points to display for a given window key.
// Projection data is annual; null means show all.
function windowToPoints(windowKey) {
    switch (windowKey) {
        case '1m':
            return 2; // show ~1 year — monthly granularity isn't available
        case '1y':
            return 2;
        case '5y':
            return 6;
        case '10y':
            return 11;
        case '15y':
            return 16;
        default:
            return null; // all
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
        retirementLineIndex:
            data.retirementLineIndex < n ? data.retirementLineIndex : -1,
        cdEvents: data.cdEvents.filter((e) => e.yearIndex < n),
    };
}

function setPeriodBtnActive(containerId, windowKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.period-btn').forEach((btn) => {
        const match =
            btn.textContent.toLowerCase().replace(' ', '') === windowKey ||
            (windowKey === 'all' && btn.textContent === 'All');
        btn.classList.toggle('active', match);
    });
}

window.setDashProjWindow = function (windowKey) {
    dashProjWindow = windowKey;
    setPeriodBtnActive('dash-period-btns', windowKey);
    renderDashboardProjectionsChart();
};

window.setProjWindow = function (windowKey) {
    projWindow = windowKey;
    setPeriodBtnActive('proj-period-btns', windowKey);
    calculateAndRenderProjections();
};

window.toggleProjLine = function (key) {
    projLineToggles[key] = !projLineToggles[key];
    const btn = document.querySelector(`.chart-toggle-btn[data-line="${key}"]`);
    if (btn) btn.classList.toggle('active', projLineToggles[key]);
    calculateAndRenderProjections();
};

window.applyScenario = function (offset) {
    // offset: +2 for bull, -2 for bear, 0 for base
    scenarioOffset = offset;
    document.querySelectorAll('.scenario-btn').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.offset) === offset);
    });
    calculateAndRenderProjections();
};

function applyProjectionSettingsToForm() {
    document.getElementById('proj-savings').value =
        state.projectionSettings.annualSavings;
    document.getElementById('proj-return').value =
        state.projectionSettings.expectedReturn;
    document.getElementById('proj-inflation').value =
        state.projectionSettings.inflationRate;
    document.getElementById('proj-swr').value = state.projectionSettings.swr;
    document.getElementById('proj-years').value =
        state.projectionSettings.spanYears;
    document.getElementById('proj-current-age').value =
        state.projectionSettings.currentAge || 30;
    document.getElementById('proj-retire-age').value =
        state.projectionSettings.retireAge || 60;
}

function readProjectionSettingsFromForm() {
    return {
        annualSavings:
            parseFloat(document.getElementById('proj-savings').value) || 0,
        expectedReturn:
            parseFloat(document.getElementById('proj-return').value) || 0,
        inflationRate:
            parseFloat(document.getElementById('proj-inflation').value) || 0,
        swr: parseFloat(document.getElementById('proj-swr').value) || 4.0,
        spanYears: parseInt(document.getElementById('proj-years').value) || 30,
        currentAge:
            parseInt(document.getElementById('proj-current-age').value) || 30,
        retireAge:
            parseInt(document.getElementById('proj-retire-age').value) || 60,
    };
}

// Read-only summary shown while the settings form is collapsed — lets users
// see their current assumptions at a glance without expanding the panel.
function renderProjSettingsSummary() {
    const el = document.getElementById('proj-settings-summary');
    if (!el) return;
    const s = state.projectionSettings;
    el.innerHTML = `
        <span>Age <strong>${s.currentAge || 30}</strong> → retire <strong>${s.retireAge || 60}</strong></span>
        <span>Save <strong>${formatCurrency(s.annualSavings || 0)}</strong>/yr at <strong>${(s.expectedReturn || 0).toFixed(1)}%</strong> return</span>
        <span>Inflation <strong>${(s.inflationRate || 0).toFixed(1)}%</strong> · SWR <strong>${(s.swr || 4).toFixed(1)}%</strong> · ${s.spanYears || 30}yr span</span>
    `;
}

window.toggleProjSettingsPanel = function () {
    const form = document.getElementById('form-projections-settings');
    const btn = document.getElementById('proj-settings-toggle');
    if (!form || !btn) return;
    const collapsed = form.classList.toggle('collapsed');
    btn.textContent = collapsed ? 'Customize ▾' : 'Customize ▴';
};

// Quick preset-scenario buttons — set common growth-settings configurations
// in one click. Distinct from MILESTONE_PRESETS (which only affects which
// milestone targets are shown); these actually change the projection inputs.
const PROJ_SETTINGS_PRESETS = {
    conservative: {
        label: 'Conservative',
        values: { expectedReturn: 6.0, inflationRate: 3.0, swr: 3.5 },
    },
    standard: {
        label: 'Standard',
        values: { expectedReturn: 8.0, inflationRate: 2.5, swr: 4.0 },
    },
    aggressive: {
        label: 'Aggressive',
        values: { expectedReturn: 10.0, inflationRate: 2.5, swr: 4.0 },
    },
    earlyRetiree: {
        label: 'Early Retiree',
        values: { expectedReturn: 8.0, inflationRate: 2.5, swr: 3.25 },
    },
};

window.applyProjSettingsPreset = async function (key) {
    const preset = PROJ_SETTINGS_PRESETS[key];
    if (!preset) return;
    Object.entries(preset.values).forEach(([field, val]) => {
        const idMap = {
            expectedReturn: 'proj-return',
            inflationRate: 'proj-inflation',
            swr: 'proj-swr',
        };
        const el = document.getElementById(idMap[field]);
        if (el) el.value = val;
    });
    document
        .querySelectorAll('.proj-preset-btn')
        .forEach((b) => b.classList.toggle('active', b.dataset.preset === key));
    state.projectionSettings = readProjectionSettingsFromForm();
    renderProjSettingsSummary();
    await saveState();
    refreshAllUI();
};

function renderProjSettingsPresets() {
    const container = document.getElementById('proj-settings-presets');
    if (!container) return;
    container.innerHTML = Object.entries(PROJ_SETTINGS_PRESETS)
        .map(
            ([key, p]) =>
                `<button type="button" class="proj-preset-btn" data-preset="${key}" onclick="applyProjSettingsPreset('${key}')">${p.label}</button>`,
        )
        .join('');
}

function initProjectionsManager() {
    const projInputIds = [
        'proj-savings',
        'proj-return',
        'proj-inflation',
        'proj-swr',
        'proj-years',
        'proj-current-age',
        'proj-retire-age',
    ];

    applyProjectionSettingsToForm();
    renderProjSettingsSummary();
    renderProjSettingsPresets();

    projInputIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', async () => {
            state.projectionSettings = readProjectionSettingsFromForm();
            renderProjSettingsSummary();
            await saveState();
            refreshAllUI();
        });
    });
}

function buildProjectionData() {
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;

    const savings = state.projectionSettings.annualSavings;
    // Apply any active scenario offset to the expected return
    const nominalReturn =
        (state.projectionSettings.expectedReturn + scenarioOffset) / 100;
    const inflation = state.projectionSettings.inflationRate / 100;
    const realReturn = (1 + nominalReturn) / (1 + inflation) - 1;
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
    let bullNW = networth,
        bearNW = networth;
    const bullReturn = realReturn + 0.02;
    const bearReturn = Math.max(realReturn - 0.02, -0.01);
    let bullData = [],
        bearData = [];

    let baseDepletionAge = null;
    let bullDepletionAge = null;
    let bearDepletionAge = null;

    const coastYears = retireAge - currentAge;
    const coastFireTarget =
        coastYears > 0
            ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
            : fireNumber;

    // US median savings benchmark by age (Vanguard How America Saves 2023)
    const ageKeys = Object.keys(US_MEDIAN_SAVINGS)
        .map(Number)
        .sort((a, b) => a - b);
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
        const lower =
            [...ageKeys].reverse().find((a) => a <= age) ?? ageKeys[0];
        const upper =
            ageKeys.find((a) => a > age) ?? ageKeys[ageKeys.length - 1];
        const t = lower === upper ? 0 : (age - lower) / (upper - lower);
        benchData.push(
            Math.round(
                US_MEDIAN_SAVINGS[lower] * (1 - t) +
                    US_MEDIAN_SAVINGS[upper] * t,
            ),
        );

        if (age === retireAge) retirementLineIndex = yr;

        if (yr < span) {
            const isRetired = age >= retireAge;
            if (isRetired) {
                const nextBase = currentNW * (1 + realReturn) - annualExpenses;
                if (currentNW > 0 && nextBase <= 0 && baseDepletionAge === null)
                    baseDepletionAge = age + 1;
                currentNW = Math.max(0, nextBase);

                const nextBull = bullNW * (1 + bullReturn) - annualExpenses;
                if (bullNW > 0 && nextBull <= 0 && bullDepletionAge === null)
                    bullDepletionAge = age + 1;
                bullNW = Math.max(0, nextBull);

                const nextBear = bearNW * (1 + bearReturn) - annualExpenses;
                if (bearNW > 0 && nextBear <= 0 && bearDepletionAge === null)
                    bearDepletionAge = age + 1;
                bearNW = Math.max(0, nextBear);
            } else {
                currentNW = currentNW * (1 + realReturn) + savings;
                bullNW = bullNW * (1 + bullReturn) + savings;
                bearNW = bearNW * (1 + bearReturn) + savings;
            }
        }
    }

    // CD maturity events as annotations
    const cdEvents = state.cds
        .map((cd) => {
            const matDate = new Date(cd.maturity);
            const today = new Date();
            const yearsUntilMaturity =
                (matDate - today) / (365.25 * 24 * 60 * 60 * 1000);
            const yearIndex = Math.round(yearsUntilMaturity);
            if (yearIndex >= 0 && yearIndex <= span) {
                return {
                    yearIndex,
                    label: `${cd.bank} CD Matures`,
                    amount: cd.principal,
                };
            }
            return null;
        })
        .filter(Boolean);

    return {
        labels,
        nwData,
        fireLine,
        leanFireLine,
        fatFireLine,
        coastFireLine,
        bullData,
        bearData,
        benchData,
        fireNumber,
        retirementLineIndex,
        cdEvents,
        realReturn,
        savings,
        networth,
        annualExpenses,
        depletionAge: {
            base: baseDepletionAge,
            bull: bullDepletionAge,
            bear: bearDepletionAge,
        },
    };
}

function computeScenarioFIREDate({
    savingsMultiplier = 1,
    returnOffset = 0,
    inflationOffset = 0,
} = {}) {
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;
    if (fireNumber <= 0) return null;

    const savings = state.projectionSettings.annualSavings * savingsMultiplier;
    const nominalReturn =
        (state.projectionSettings.expectedReturn + returnOffset) / 100;
    const inflation =
        (state.projectionSettings.inflationRate + inflationOffset) / 100;
    const realReturn = (1 + nominalReturn) / (1 + inflation) - 1;
    const currentAge = state.projectionSettings.currentAge || 30;

    if (networth >= fireNumber) return currentAge;

    let nw = networth;
    for (let yr = 1; yr <= 80; yr++) {
        nw = nw * (1 + realReturn) + savings;
        if (nw >= fireNumber) return currentAge + yr;
    }
    return null;
}

function calculateAndRenderProjections() {
    const raw = buildProjectionData();
    renderProjectionsChart(sliceProjectionData(raw, projWindow));
    renderMilestones(
        raw.networth,
        raw.fireNumber,
        raw.realReturn,
        raw.savings,
        raw.depletionAge,
    );
    renderScenarioComparison();
}
