/* ==========================================================================
   tables/projections-table.js — Scenario comparison and milestones renderers
   ========================================================================== */

function renderScenarioComparison() {
    const container = document.getElementById('scenario-comparison-container');
    if (!container) return;

    const currentAge = state.projectionSettings.currentAge || 30;
    const scenarios = [
        {
            label: 'Base Case',
            icon: '📊',
            savingsMultiplier: 1,
            returnOffset: 0,
            inflationOffset: 0,
            isBase: true,
        },
        {
            label: 'Savings +10%',
            icon: '💰',
            savingsMultiplier: 1.1,
            returnOffset: 0,
            inflationOffset: 0,
        },
        {
            label: 'Savings +20%',
            icon: '💰',
            savingsMultiplier: 1.2,
            returnOffset: 0,
            inflationOffset: 0,
        },
        {
            label: 'Bear Market (−2%)',
            icon: '🐻',
            savingsMultiplier: 1,
            returnOffset: -2,
            inflationOffset: 0,
        },
        {
            label: 'Severe Bear (−4%)',
            icon: '🐻',
            savingsMultiplier: 1,
            returnOffset: -4,
            inflationOffset: 0,
        },
        {
            label: 'Inflation +1%',
            icon: '📈',
            savingsMultiplier: 1,
            returnOffset: 0,
            inflationOffset: 1,
        },
        {
            label: 'Inflation +2%',
            icon: '📈',
            savingsMultiplier: 1,
            returnOffset: 0,
            inflationOffset: 2,
        },
    ];

    const results = scenarios.map((s) => ({
        ...s,
        fireAge: computeScenarioFIREDate(s),
    }));
    const baseAge = results.find((r) => r.isBase)?.fireAge;

    const rows = results
        .map((r) => {
            const age = r.fireAge;
            const yearsAway = age !== null ? age - currentAge : null;
            const delta =
                !r.isBase && age !== null && baseAge !== null
                    ? age - baseAge
                    : null;

            const ageCell =
                age !== null
                    ? `<strong>Age ${age}</strong>`
                    : `<span class="text-muted">Not within 80 yrs</span>`;

            const deltaCell = r.isBase
                ? '<span class="scen-delta-neutral">base</span>'
                : delta === null
                  ? '<span class="text-muted">—</span>'
                  : delta < 0
                    ? `<span class="scen-delta-better">${delta} yrs</span>`
                    : delta > 0
                      ? `<span class="scen-delta-worse">+${delta} yrs</span>`
                      : '<span class="scen-delta-neutral">same</span>';

            return `<tr class="${r.isBase ? 'scen-base-row' : ''}">
            <td class="scen-label-cell">${r.icon} ${r.label}</td>
            <td>${ageCell}</td>
            <td class="text-muted">${yearsAway !== null ? yearsAway + ' yrs' : '—'}</td>
            <td>${deltaCell}</td>
        </tr>`;
        })
        .join('');

    container.innerHTML = `<table class="scenario-compare-table">
        <thead><tr><th>Scenario</th><th>FIRE Age</th><th>Years Away</th><th>vs. Base</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// Milestone presets based on financial profile
const MILESTONE_PRESETS = {
    conservative: {
        label: 'Conservative / Lean',
        description: 'Minimal spending, high savings rate',
        milestones: [
            {
                name: 'Emergency Fund (6 mo expenses)',
                multiplier: (annualExpenses) => annualExpenses * 0.5,
                color: 'text-emerald',
            },
            { name: 'Coast FIRE', isCoast: true, color: 'text-purple' },
            {
                name: 'Lean FIRE (75%)',
                multiplier: (fire) => fire * 0.75,
                color: 'text-emerald',
            },
            {
                name: 'FIRE Baseline (100%)',
                multiplier: (fire) => fire,
                color: 'text-purple',
            },
        ],
    },
    standard: {
        label: 'Standard / Balanced',
        description: 'Moderate lifestyle, typical savings',
        milestones: [
            {
                name: 'Emergency Fund (6 mo expenses)',
                multiplier: (annualExpenses) => annualExpenses * 0.5,
                color: 'text-emerald',
            },
            { name: 'Coast FIRE', isCoast: true, color: 'text-purple' },
            {
                name: 'Lean FIRE (75%)',
                multiplier: (fire) => fire * 0.75,
                color: 'text-emerald',
            },
            {
                name: 'FIRE Baseline (100%)',
                multiplier: (fire) => fire,
                color: 'text-purple',
            },
            {
                name: 'Fat FIRE (125%)',
                multiplier: (fire) => fire * 1.25,
                color: 'text-amber',
            },
            {
                name: 'Fat FIRE (150%)',
                multiplier: (fire) => fire * 1.5,
                color: 'text-amber',
            },
        ],
    },
    aggressive: {
        label: 'Aggressive / Fat FIRE',
        description: 'High income, lifestyle flexibility',
        milestones: [
            {
                name: 'Emergency Fund (12 mo expenses)',
                multiplier: (annualExpenses) => annualExpenses,
                color: 'text-emerald',
            },
            { name: 'Coast FIRE', isCoast: true, color: 'text-purple' },
            {
                name: 'FIRE Baseline (100%)',
                multiplier: (fire) => fire,
                color: 'text-purple',
            },
            {
                name: 'Fat FIRE (125%)',
                multiplier: (fire) => fire * 1.25,
                color: 'text-amber',
            },
            {
                name: 'Fat FIRE (150%)',
                multiplier: (fire) => fire * 1.5,
                color: 'text-amber',
            },
            {
                name: 'Fat FIRE (200%)',
                multiplier: (fire) => fire * 2.0,
                color: 'text-amber',
            },
            {
                name: 'Fat FIRE (300%)',
                multiplier: (fire) => fire * 3.0,
                color: 'text-amber',
            },
        ],
    },
    barista: {
        label: 'Barista FIRE',
        description: 'Part-time work covers expenses gap',
        milestones: [
            {
                name: 'Emergency Fund (6 mo expenses)',
                multiplier: (annualExpenses) => annualExpenses * 0.5,
                color: 'text-emerald',
            },
            { name: 'Coast FIRE', isCoast: true, color: 'text-purple' },
            {
                name: 'Barista FIRE (50% FIRE)',
                multiplier: (fire) => fire * 0.5,
                color: 'text-warning',
            },
            {
                name: 'Lean FIRE (75%)',
                multiplier: (fire) => fire * 0.75,
                color: 'text-emerald',
            },
            {
                name: 'FIRE Baseline (100%)',
                multiplier: (fire) => fire,
                color: 'text-purple',
            },
        ],
    },
    coast: {
        label: 'Coast FIRE Focus',
        description: 'Front-load savings, stop early',
        milestones: [
            {
                name: 'Emergency Fund (6 mo expenses)',
                multiplier: (annualExpenses) => annualExpenses * 0.5,
                color: 'text-emerald',
            },
            {
                name: 'Coast FIRE (stop saving)',
                isCoast: true,
                color: 'text-purple',
            },
            {
                name: '2x Coast FIRE',
                multiplier: (coast) => coast * 2,
                isCoastBased: true,
                color: 'text-amber',
            },
            {
                name: 'Lean FIRE (75%)',
                multiplier: (fire) => fire * 0.75,
                color: 'text-emerald',
            },
            {
                name: 'FIRE Baseline (100%)',
                multiplier: (fire) => fire,
                color: 'text-purple',
            },
        ],
    },
};

let activePreset = 'standard';

function setActivePreset(presetKey) {
    if (MILESTONE_PRESETS[presetKey]) {
        activePreset = presetKey;
        const el = document.getElementById('milestone-preset-select');
        if (el) el.value = presetKey;
        calculateAndRenderProjections();
    }
}

function getActivePreset() {
    return MILESTONE_PRESETS[activePreset] || MILESTONE_PRESETS.standard;
}

function buildMilestonesList(rawData, depletionAge) {
    const preset = getActivePreset();
    const { fireNumber, realReturn, networth, annualExpenses, savings } =
        rawData;
    const retireAge = state.projectionSettings.retireAge || 60;
    const currentAge = state.projectionSettings.currentAge || 30;
    const coastYears = Math.max(0, retireAge - currentAge);
    const coastFireTarget =
        coastYears > 0
            ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
            : fireNumber;

    const milestonesList = preset.milestones.map((m) => {
        let target;
        if (m.isCoast) {
            target = coastFireTarget;
        } else if (m.multiplier) {
            const basis = m.isCoastBased ? coastFireTarget : fireNumber;
            target = m.multiplier(basis);
        }
        return { ...m, target: target || 0 };
    });

    // Add depletion warning if applicable
    if (depletionAge && depletionAge.base) {
        const yearsFromNow = depletionAge.base - currentAge;
        if (yearsFromNow > 0 && yearsFromNow < 50) {
            milestonesList.push({
                name: `⚠️ Portfolio Depletion (Base Case)`,
                target: 0,
                isDepletion: true,
                depletionAge: depletionAge.base,
                color: 'text-coral',
            });
        }
    }

    return milestonesList;
}

function renderMilestones(
    startingNw,
    targetFireNw,
    realReturnRate,
    annualSavings,
    depletionAge,
) {
    const container = document.getElementById(
        'projection-milestones-container',
    );
    if (!container) return;

    // Get raw projection data for building milestones
    const rawData = buildProjectionData();
    const milestonesList = buildMilestonesList(rawData, depletionAge);
    const currentAge = state.projectionSettings.currentAge || 30;

    // Preset selector renders into the card-title-row (top-right, inline with
    // the title/cost labels) rather than stretching across the card body.
    let selectorHtml = `
        <div class="milestone-preset-selector">
            <label for="milestone-preset-select" class="text-muted" style="font-size:11px;">Preset:</label>
            <select id="milestone-preset-select" class="milestone-preset-select">
    `;
    Object.entries(MILESTONE_PRESETS).forEach(([key, preset]) => {
        selectorHtml += `<option value="${key}" ${key === activePreset ? 'selected' : ''}>${preset.label}</option>`;
    });
    selectorHtml += `
            </select>
            <span class="info-tip" data-tip="${getActivePreset().description}">?</span>
        </div>
    `;
    const mount = document.getElementById('milestone-preset-mount');
    if (mount) {
        mount.innerHTML = selectorHtml;
        const mountSel = mount.querySelector('#milestone-preset-select');
        if (mountSel)
            mountSel.addEventListener('change', (e) =>
                setActivePreset(e.target.value),
            );
    }

    let html = '';
    milestonesList.forEach((m) => {
        let yearsRequired = 'N/A';
        const isAchieved = startingNw >= m.target || m.isDepletion;

        if (m.isDepletion) {
            yearsRequired = `Money runs out at Age ${m.depletionAge} (${m.depletionAge - currentAge} yrs)`;
        } else if (isAchieved) {
            yearsRequired = 'Achieved 🎉';
        } else {
            if (realReturnRate > 0) {
                const num = m.target * realReturnRate + annualSavings;
                const den = startingNw * realReturnRate + annualSavings;
                if (num > 0 && den > 0) {
                    const yrs =
                        Math.log(num / den) / Math.log(1 + realReturnRate);
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

        const isDepletion = m.isDepletion === true;
        const colorClass =
            m.color ||
            (isDepletion
                ? 'text-coral'
                : isAchieved
                  ? 'text-emerald'
                  : 'text-purple');
        html += `
            <div class="milestone-card ${isAchieved ? 'achieved' : ''} ${isDepletion ? 'depletion-warning' : ''}">
                <span class="milestone-title">${m.name}</span>
                <span class="milestone-val ${colorClass}">${isDepletion ? '—' : formatCurrency(m.target)}</span>
                <span class="milestone-status">${isAchieved && !isDepletion ? 'Goal Completed ✅' : `Est: <strong>${yearsRequired}</strong>`}</span>
            </div>
        `;
    });

    // #projection-milestones-container is itself the .milestones-grid — the
    // preset selector now renders separately into #milestone-preset-mount
    // (top-right of the card title) instead of stretching across this grid.
    container.innerHTML = html;
}
