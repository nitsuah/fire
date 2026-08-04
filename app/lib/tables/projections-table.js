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

function renderMilestones(
    startingNw,
    targetFireNw,
    realReturnRate,
    annualSavings,
) {
    const container = document.getElementById(
        'projection-milestones-container',
    );
    if (!container) return;

    const retireAge = state.projectionSettings.retireAge || 60;
    const currentAge = state.projectionSettings.currentAge || 30;
    const coastYears = retireAge - currentAge;
    const coastFireTarget =
        coastYears > 0
            ? targetFireNw /
              Math.pow(1 + Math.max(realReturnRate, 0.001), coastYears)
            : targetFireNw;

    const milestonesList = [
        {
            name: `Coast FIRE (${coastYears}y to compound)`,
            target: coastFireTarget,
        },
        { name: 'Lean FIRE (75% of Target)', target: targetFireNw * 0.75 },
        { name: 'FIRE Baseline (100% of Target)', target: targetFireNw },
        { name: 'Fat FIRE (125% of Target)', target: targetFireNw * 1.25 },
    ];

    let html = '';
    milestonesList.forEach((m) => {
        let yearsRequired = 'N/A';
        const isAchieved = startingNw >= m.target;

        if (isAchieved) {
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
