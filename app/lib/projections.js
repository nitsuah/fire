/* ==========================================================================
   projections.js — Net Worth Projections Engine & Chart Controls
   Depends on globals: state, scenarioOffset, projLineToggles, dashProjWindow,
   projWindow, US_MEDIAN_SAVINGS, saveState, refreshAllUI,
   getAggregateNetWorth, getAggregateCash, getAnnualExpensesTotal,
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
        noChaosData: data.noChaosData ? data.noChaosData.slice(0, n) : null,
        chaos: data.chaos
            ? {
                  ...data.chaos,
                  events: window.FireChaos.eventsInWindow(data.chaos.events, n),
              }
            : null,
    };
}

/* ---------------------------------------------------------------------------
   Chaos mode — random (seeded) life events applied to the net worth path.
   Shared by the Dashboard and Projections charts; persisted per browser
   like the growth-chart size (localStorage), so it survives reloads.
   --------------------------------------------------------------------------- */
const CHAOS_STORAGE_KEY = 'fire_chaos_mode';

function loadChaosMode() {
    try {
        const saved = JSON.parse(localStorage.getItem(CHAOS_STORAGE_KEY));
        if (saved && Number.isInteger(saved.seed) && saved.seed > 0)
            return { enabled: !!saved.enabled, seed: saved.seed };
    } catch {
        /* storage unavailable or corrupt — start fresh */
    }
    return { enabled: false, seed: 0 };
}

var chaosMode = loadChaosMode();

// 🛡️ Mitigations the user already has (pet insurance, HSA, ...). Chaos
// mode shrinks the hits they cover and charges their yearly premiums.
const MITIGATION_STORAGE_KEY = 'fire_chaos_mitigations';
function loadMitigations() {
    try {
        const saved = JSON.parse(localStorage.getItem(MITIGATION_STORAGE_KEY));
        if (Array.isArray(saved))
            return saved.filter((x) => typeof x === 'string');
    } catch {
        /* storage unavailable or corrupt */
    }
    return [];
}
var chaosMitigations = loadMitigations();

window.toggleMitigation = function (id, on) {
    chaosMitigations = on
        ? [...new Set([...chaosMitigations, id])]
        : chaosMitigations.filter((m) => m !== id);
    try {
        localStorage.setItem(
            MITIGATION_STORAGE_KEY,
            JSON.stringify(chaosMitigations),
        );
    } catch {
        /* storage unavailable — choice just won't persist */
    }
    renderDashboardProjectionsChart();
    calculateAndRenderProjections();
};

// What one mitigation is worth in the current Chaos timeline: net worth
// at the end of the span with vs. without it (premiums included).
function mitigationValue(chaos, id) {
    if (!chaos) return null;
    const FC = window.FireChaos;
    const others = chaosMitigations.filter((m) => m !== id);
    const withIt = FC.simulate({
        ...chaos.simArgs,
        mitigations: [...others, id],
    });
    const without = FC.simulate({ ...chaos.simArgs, mitigations: others });
    const last = withIt.nwData.length - 1;
    const hits = chaos.events.filter((ev) =>
        FC.MITIGATIONS.find((m) => m.id === id).covers.includes(ev.defId),
    );
    return {
        hits,
        saved: withIt.savedTotal - without.savedTotal,
        premiums: withIt.premiumTotal - without.premiumTotal,
        net: withIt.nwData[last] - without.nwData[last],
    };
}

function renderMitigations(raw) {
    const el = document.getElementById('chaos-mitigations');
    if (!el || !window.FireChaos) return;
    const FC = window.FireChaos;
    const chaos = raw && raw.chaos;
    const names = Object.fromEntries(FC.CATALOG.map((d) => [d.id, d]));
    const rows = FC.MITIGATIONS.map((m) => ({
        m,
        v: mitigationValue(chaos, m.id),
    }));
    // Most relevant first: covers events in this timeline, best net value.
    rows.sort(
        (a, b) =>
            (b.v?.hits.length ? 1 : 0) - (a.v?.hits.length ? 1 : 0) ||
            (b.v?.net || 0) - (a.v?.net || 0),
    );
    const on = new Set(chaosMitigations);
    const lastAge = raw ? raw.labels[raw.labels.length - 1] : '';
    el.innerHTML = `
        <div class="mit-head">
            <h3 class="section-sub-title">🛡️ Mitigate life events</h3>
            <p class="card-subtitle">Coverage that shrinks or absorbs the hits in 🌪️ Chaos mode. Tick what you already have: Chaos mode then applies it, and its yearly cost, to your projection. Insurance usually costs more than it pays out on average; its job is capping the big hits.</p>
            ${chaos ? '' : '<p class="text-muted mit-note">Turn on 🌪️ Chaos (Projections or Dashboard) to see what each one would have saved in your simulated life.</p>'}
        </div>
        <ul class="mit-list">${rows
            .map(({ m, v }) => {
                const covers = m.covers
                    .map((id) => names[id])
                    .filter(Boolean)
                    .map((d) => `${d.icon} ${escHtml(d.label)}`)
                    .join(' · ');
                const effect = m.reduction
                    ? `cuts the ${m.part === 'income' ? 'lost income' : 'bill'} ~${Math.round(m.reduction * 100)}%`
                    : 'paid from cash, not debt';
                const cost = m.premium
                    ? `~${formatCurrency(m.premium / 12).replace(/\.\d\d$/, '')}/mo`
                    : 'free';
                let value = '';
                if (v) {
                    const n = v.hits.length;
                    value = !n
                        ? `<span class="mit-value">No covered events in this life${v.premiums ? ` · costs ${FC.fmtMoney(v.premiums).slice(1)}` : ''}</span>`
                        : !m.reduction
                          ? `<span class="mit-value is-up">This life: ${n} hit${n === 1 ? '' : 's'} paid from cash instead of debt</span>`
                          : `<span class="mit-value ${v.net >= 0 ? 'is-up' : 'is-down'}">This life: ${n} hit${n === 1 ? '' : 's'}, saves ${FC.fmtMoney(v.saved).slice(1)}${v.premiums ? `, costs ${FC.fmtMoney(v.premiums).slice(1)}` : ''} → ${FC.fmtMoney(v.net)} by ${escHtml(lastAge)}</span>`;
                }
                return `<li class="mit-item${on.has(m.id) ? ' is-on' : ''}">
                    <label class="mit-toggle">
                        <input type="checkbox" data-mitigation="${m.id}"${on.has(m.id) ? ' checked' : ''}>
                        <span>I have this</span>
                    </label>
                    <div class="mit-body">
                        <div class="mit-title">${m.icon} ${escHtml(m.label)} <span class="mit-meta">${effect} · ${cost}</span></div>
                        <div class="mit-covers">${covers}</div>
                        <div class="mit-tip">${escHtml(m.tip)}</div>
                        ${value}
                    </div>
                </li>`;
            })
            .join('')}</ul>`;
    el.querySelectorAll('[data-mitigation]').forEach((box) =>
        box.addEventListener('change', () =>
            window.toggleMitigation(box.dataset.mitigation, box.checked),
        ),
    );
}

function saveChaosMode() {
    try {
        localStorage.setItem(CHAOS_STORAGE_KEY, JSON.stringify(chaosMode));
    } catch {
        /* storage unavailable — chaos just won't persist */
    }
}

function syncChaosButtons() {
    document.querySelectorAll('.chaos-btn').forEach((btn) => {
        btn.classList.toggle('active', chaosMode.enabled);
        btn.setAttribute('aria-pressed', chaosMode.enabled ? 'true' : 'false');
    });
    document.querySelectorAll('.chaos-reroll-btn').forEach((btn) => {
        btn.hidden = !chaosMode.enabled;
    });
}

window.toggleChaos = function () {
    chaosMode.enabled = !chaosMode.enabled;
    if (chaosMode.enabled && !chaosMode.seed)
        chaosMode.seed = window.FireChaos.newSeed();
    saveChaosMode();
    syncChaosButtons();
    renderDashboardProjectionsChart();
    calculateAndRenderProjections();
};

window.rerollChaos = function () {
    chaosMode.seed = window.FireChaos.newSeed();
    chaosMode.enabled = true;
    saveChaosMode();
    syncChaosButtons();
    renderDashboardProjectionsChart();
    calculateAndRenderProjections();
};

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

// The SWR <select> only lists a few stock rates and compares option values
// as strings, so a numeric 4 (from state or a preset) never matched the
// "4.0" option and a preset's 3.25 matched nothing — leaving the select
// blank and silently falling back to 4.0. Match numerically and add a
// Custom option when the value isn't already listed.
function setSwrSelectValue(val) {
    const sel = document.getElementById('proj-swr');
    const n = parseFloat(val);
    if (!sel || !Number.isFinite(n)) return;
    let opt = [...sel.options].find((o) => parseFloat(o.value) === n);
    if (!opt) {
        opt = new Option(`${n}% SWR (Custom)`, String(n));
        const next = [...sel.options].find((o) => parseFloat(o.value) > n);
        sel.add(opt, next || null);
    }
    sel.value = opt.value;
}

function applyProjectionSettingsToForm() {
    document.getElementById('proj-savings').value =
        state.projectionSettings.annualSavings;
    document.getElementById('proj-return').value =
        state.projectionSettings.expectedReturn;
    document.getElementById('proj-inflation').value =
        state.projectionSettings.inflationRate;
    setSwrSelectValue(state.projectionSettings.swr);
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
        swr: (() => {
            const v = parseFloat(document.getElementById('proj-swr').value);
            return Number.isFinite(v) ? v : 4.0;
        })(),
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

function toggleProjSettingsPanel() {
    const form = document.getElementById('form-projections-settings');
    const btn = document.getElementById('proj-settings-toggle');
    if (!form || !btn) return;
    const collapsed = form.classList.toggle('collapsed');
    btn.textContent = collapsed ? 'Customize ▾' : 'Customize ▴';
}

// Quick preset-scenario buttons — set common growth-settings configurations
// in one click. Distinct from MILESTONE_PRESETS (which only affects which
// milestone targets are shown); these actually change the projection inputs.
const PROJ_SETTINGS_PRESETS = {
    conservative: {
        label: 'Conservative',
        milestonePreset: 'conservative',
        values: { expectedReturn: 6.0, inflationRate: 3.0, swr: 3.5 },
    },
    standard: {
        label: 'Standard',
        milestonePreset: 'standard',
        values: { expectedReturn: 8.0, inflationRate: 2.5, swr: 4.0 },
    },
    aggressive: {
        label: 'Aggressive',
        milestonePreset: 'aggressive',
        values: { expectedReturn: 10.0, inflationRate: 2.5, swr: 4.0 },
    },
    earlyRetiree: {
        label: 'Early Retiree',
        milestonePreset: 'coast',
        values: {
            expectedReturn: 8.0,
            inflationRate: 2.5,
            swr: 3.25,
            retireAge: 50,
        },
    },
};

async function applyProjSettingsPreset(key) {
    const preset = PROJ_SETTINGS_PRESETS[key];
    if (!preset) return;
    Object.entries(preset.values).forEach(([field, val]) => {
        const idMap = {
            expectedReturn: 'proj-return',
            inflationRate: 'proj-inflation',
            swr: 'proj-swr',
            retireAge: 'proj-retire-age',
        };
        if (field === 'swr') {
            setSwrSelectValue(val);
            return;
        }
        const el = document.getElementById(idMap[field]);
        if (el) el.value = val;
    });
    // Keep the milestone preset selector in step with the growth preset.
    if (preset.milestonePreset && typeof setActivePreset === 'function')
        setActivePreset(preset.milestonePreset);
    document
        .querySelectorAll('.proj-preset-btn')
        .forEach((b) => b.classList.toggle('active', b.dataset.preset === key));
    state.projectionSettings = readProjectionSettingsFromForm();
    renderProjSettingsSummary();
    try {
        await saveState();
    } catch (err) {
        console.error('Failed to persist projection settings preset:', err);
    }
    refreshAllUI();
}

function renderProjSettingsPresets() {
    const container = document.getElementById('proj-settings-presets');
    if (!container) return;
    container.innerHTML = Object.entries(PROJ_SETTINGS_PRESETS)
        .map(
            ([key, p]) =>
                `<button type="button" class="proj-preset-btn" data-preset="${key}">${p.label}</button>`,
        )
        .join('');
    container.querySelectorAll('.proj-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () =>
            applyProjSettingsPreset(btn.dataset.preset),
        );
    });
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
    syncChaosButtons();
    renderProjSettingsSummary();
    renderProjSettingsPresets();

    const toggleBtn = document.getElementById('proj-settings-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleProjSettingsPanel);

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

// One retirement year's withdrawal: draws `expense` from `cash` first (cash
// earns no return in this model) and only pulls the remainder from
// `invested` — after `invested` has already grown at `returnRate` for the
// year, same "grow then withdraw" order the pre-cash-first model used.
// Mirrors a real retiree's typical sequencing (spend cash reserves before
// selling invested assets, especially during a downturn) rather than
// treating the whole portfolio as one undifferentiated pool. Kept in sync
// with the identical helper in app/lib/finance-calcs.js (server/MCP side).
function _withdrawCashFirst(cash, invested, returnRate, expense) {
    const totalBefore = cash + invested;
    const cashDrawn = Math.min(cash, expense);
    const remaining = expense - cashDrawn;
    const rawInvested = invested * (1 + returnRate) - remaining;
    const nextCash = cash - cashDrawn;
    return {
        cash: nextCash,
        invested: Math.max(0, rawInvested),
        // An unpaid withdrawal from an already-empty portfolio is depletion too.
        depletedThisYear:
            (totalBefore > 0 || expense > 0) && nextCash + rawInvested <= 0,
    };
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

    // Cash/invested split, seeded from the real current portfolio
    // composition and carried forward at that fixed fraction through the
    // (unchanged) pre-retirement accumulation phase. Populated the moment
    // each scenario crosses into retirement, below.
    const cashFraction0 =
        networth > 0
            ? Math.min(Math.max(getAggregateCash() / networth, 0), 1)
            : 0;
    let cashBase = null,
        investedBase = null;
    let cashBull = null,
        investedBull = null;
    let cashBear = null,
        investedBear = null;

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
        const displayBase =
            cashBase !== null ? cashBase + investedBase : currentNW;
        const displayBull =
            cashBull !== null ? cashBull + investedBull : bullNW;
        const displayBear =
            cashBear !== null ? cashBear + investedBear : bearNW;
        labels.push(`Age ${age}`);
        nwData.push(Math.round(displayBase));
        fireLine.push(Math.round(fireNumber));
        leanFireLine.push(Math.round(fireNumber * 0.75));
        fatFireLine.push(Math.round(fireNumber * 1.25));
        coastFireLine.push(Math.round(coastFireTarget));
        bullData.push(Math.round(displayBull));
        bearData.push(Math.round(Math.max(displayBear, 0)));

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
                if (cashBase === null) {
                    // First retirement year for this scenario: split
                    // whatever it's accumulated to by the fixed
                    // real-portfolio cash fraction.
                    cashBase = currentNW * cashFraction0;
                    investedBase = currentNW * (1 - cashFraction0);
                    cashBull = bullNW * cashFraction0;
                    investedBull = bullNW * (1 - cashFraction0);
                    cashBear = bearNW * cashFraction0;
                    investedBear = bearNW * (1 - cashFraction0);
                }

                const stepBase = _withdrawCashFirst(
                    cashBase,
                    investedBase,
                    realReturn,
                    annualExpenses,
                );
                if (stepBase.depletedThisYear && baseDepletionAge === null)
                    baseDepletionAge = age + 1;
                cashBase = stepBase.cash;
                investedBase = stepBase.invested;

                const stepBull = _withdrawCashFirst(
                    cashBull,
                    investedBull,
                    bullReturn,
                    annualExpenses,
                );
                if (stepBull.depletedThisYear && bullDepletionAge === null)
                    bullDepletionAge = age + 1;
                cashBull = stepBull.cash;
                investedBull = stepBull.invested;

                const stepBear = _withdrawCashFirst(
                    cashBear,
                    investedBear,
                    bearReturn,
                    annualExpenses,
                );
                if (stepBear.depletedThisYear && bearDepletionAge === null)
                    bearDepletionAge = age + 1;
                cashBear = stepBear.cash;
                investedBear = stepBear.invested;
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

    // Chaos mode: replay the base path with seeded life events. The chaos
    // path becomes the headline net worth (so milestones/annotations follow
    // it) and the untouched path is kept for a "without chaos" comparison.
    let chaos = null;
    let noChaosData = null;
    if (chaosMode.enabled && window.FireChaos) {
        // Paycheck events (job loss, pay cut, bonus, RSUs) need a paycheck:
        // skip them when the Expenses tab's gross income is effectively 0.
        const grossIncome = Number(state.taxGrossIncome);
        const events = window.FireChaos.generateEvents({
            seed: chaosMode.seed,
            currentAge,
            retireAge,
            span,
            hasEarnedIncome: !(
                Number.isFinite(grossIncome) && grossIncome < 5000
            ),
        });
        const simArgs = {
            events,
            startNW: networth,
            cashFraction: cashFraction0,
            realReturn,
            savings,
            annualExpenses,
            spending: getMonthlyExpensesBase() * 12,
            currentAge,
            retireAge,
            span,
            inflation,
        };
        const sim = window.FireChaos.simulate({
            ...simArgs,
            mitigations: chaosMitigations,
        });
        noChaosData = nwData;
        nwData = sim.nwData;
        baseDepletionAge = sim.depletionAge;
        chaos = {
            events,
            impacts: sim.impacts,
            seed: chaosMode.seed,
            simArgs,
            savedTotal: sim.savedTotal,
            premiumTotal: sim.premiumTotal,
        };
    }

    return {
        labels,
        nwData,
        noChaosData,
        chaos,
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
    renderMitigations(raw);
}
