/* ==========================================================================
   tables-assets.js — Asset table renderers
   Renders: real estate, vehicles, scenario comparison, milestones,
            alloc mini bars, diversification suggestions, quick stats,
            monthly cash flow
   Depends on globals in app.js and finance-core helpers.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Real Estate
   -------------------------------------------------------------------------- */

function renderRealEstateTable() {
    const tbody = document.querySelector('#table-real-estate tbody');
    if (!tbody) return;
    const list = state.realEstate || [];

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No properties added yet. Use the form to add your first property.</td></tr>`;
        renderRealEstateStats();
        return;
    }

    let html = '';
    list.forEach(re => {
        const equity = (re.marketValue || 0) - (re.mortgageBalance || 0);
        const gain = (re.marketValue || 0) - (re.purchasePrice || 0);
        const gainStyle = gain >= 0 ? 'color:var(--color-success)' : 'color:var(--color-danger)';
        const gainStr = gain >= 0 ? `+${formatCurrency(gain)}` : `-${formatCurrency(Math.abs(gain))}`;

        if (editingRealEstate.includes(re.id)) {
            html += `
            <tr class="position-row">
                <td><input class="inline-edit-input" id="re-edit-name-${re.id}" value="${re.name.replace(/"/g,'&quot;')}" placeholder="Property Name"></td>
                <td>
                    <select class="inline-edit-input" id="re-edit-type-${re.id}">
                        ${['Primary Home','Investment','Rental','Land','Commercial'].map(t => `<option${t===re.type?' selected':''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td><input class="inline-edit-input" id="re-edit-address-${re.id}" value="${(re.address||'').replace(/"/g,'&quot;')}" placeholder="Address (optional)"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-market-${re.id}" type="number" value="${re.marketValue}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-mortgage-${re.id}" type="number" value="${re.mortgageBalance}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-purchase-${re.id}" type="number" value="${re.purchasePrice}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-payment-${re.id}" type="number" value="${re.monthlyPayment}" step="100"></td>
                <td class="text-right">
                    <button class="action-btn save-btn" onclick="saveEditRealEstate('${re.id}')">Save</button>
                    <button class="action-btn cancel-btn" onclick="cancelEditRealEstate('${re.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `
            <tr class="position-row">
                <td class="font-bold">${re.name}</td>
                <td><span class="tag-badge">${re.type}</span></td>
                <td class="text-muted" style="font-size:11px;">${re.address || '—'}</td>
                <td class="text-right font-bold">${formatCurrency(re.marketValue || 0)}</td>
                <td class="text-right" style="${equity>=0?'color:var(--color-success)':'color:var(--color-danger)'};">${formatCurrency(equity)}</td>
                <td class="text-right text-muted">${(re.purchasePrice||0)>0?formatCurrency(re.purchasePrice):'—'}</td>
                <td class="text-right" style="${gainStyle}">${(re.purchasePrice||0)>0?gainStr:'—'}</td>
                <td class="text-right">
                    <button class="action-btn edit-btn" onclick="startEditRealEstate('${re.id}')">Edit</button>
                    <button class="action-btn delete-btn" onclick="deleteRealEstate('${re.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });
    tbody.innerHTML = html;
    renderRealEstateStats();
}

function renderRealEstateStats() {
    const list = state.realEstate || [];
    const totalValue = list.reduce((s, re) => s + (re.marketValue || 0), 0);
    const totalMortgage = list.reduce((s, re) => s + (re.mortgageBalance || 0), 0);
    const totalEquity = totalValue - totalMortgage;
    const totalGain = list.reduce((s, re) => s + ((re.marketValue||0) - (re.purchasePrice||0)), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('re-stat-value', formatCurrency(totalValue));
    set('re-stat-equity', formatCurrency(totalEquity));
    set('re-stat-mortgage', formatCurrency(totalMortgage));
    set('re-stat-gain', (totalGain >= 0 ? '+' : '') + formatCurrency(totalGain));
    const gainEl = document.getElementById('re-stat-gain');
    if (gainEl) gainEl.style.color = totalGain >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
}

/* --------------------------------------------------------------------------
   Vehicles
   -------------------------------------------------------------------------- */

function renderVehiclesTable() {
    const tbody = document.querySelector('#table-vehicles tbody');
    if (!tbody) return;
    const list = state.vehicles || [];

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No vehicles added yet. Use the form to add your first vehicle.</td></tr>`;
        renderVehicleStats();
        return;
    }

    let html = '';
    list.forEach(v => {
        const equity = (v.currentValue || 0) - (v.loanBalance || 0);
        const dep = (v.purchasePrice || 0) - (v.currentValue || 0);
        const depStyle = dep <= 0 ? 'color:var(--color-success)' : 'color:var(--color-danger)';
        const depStr = dep <= 0 ? `+${formatCurrency(Math.abs(dep))}` : `-${formatCurrency(dep)}`;
        const equityStyle = equity >= 0 ? 'color:var(--color-success)' : 'color:var(--color-danger)';
        const displayName = `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`;

        if (editingVehicles.includes(v.id)) {
            html += `
            <tr class="position-row">
                <td><input class="inline-edit-input" id="veh-edit-year-${v.id}" type="number" value="${v.year}" style="width:70px;"></td>
                <td><input class="inline-edit-input" id="veh-edit-make-${v.id}" value="${(v.make||'').replace(/"/g,'&quot;')}"></td>
                <td><input class="inline-edit-input" id="veh-edit-model-${v.id}" value="${(v.model||'').replace(/"/g,'&quot;')}"></td>
                <td><input class="inline-edit-input" id="veh-edit-mileage-${v.id}" type="number" value="${v.mileage||0}"></td>
                <td>
                    <select class="inline-edit-input" id="veh-edit-condition-${v.id}">
                        ${['Excellent','Good','Fair','Poor'].map(c=>`<option${c===v.condition?' selected':''}>${c}</option>`).join('')}
                    </select>
                </td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-value-${v.id}" type="number" value="${v.currentValue||0}" step="500"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-loan-${v.id}" type="number" value="${v.loanBalance||0}" step="500"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-purchase-${v.id}" type="number" value="${v.purchasePrice||0}" step="500"></td>
                <td class="text-right">
                    <button class="action-btn save-btn" onclick="saveEditVehicle('${v.id}')">Save</button>
                    <button class="action-btn cancel-btn" onclick="cancelEditVehicle('${v.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `
            <tr class="position-row">
                <td class="font-bold">${displayName}</td>
                <td><span class="tag-badge">${v.condition}</span></td>
                <td class="text-right text-muted">${(v.mileage||0).toLocaleString()} mi</td>
                <td class="text-right font-bold">${formatCurrency(v.currentValue||0)}</td>
                <td class="text-right" style="${equityStyle}">${formatCurrency(equity)}</td>
                <td class="text-right text-muted">${(v.loanBalance||0)>0?formatCurrency(v.loanBalance):'Paid Off'}</td>
                <td class="text-right text-muted">${(v.purchasePrice||0)>0?formatCurrency(v.purchasePrice):'—'}</td>
                <td class="text-right" style="${depStyle}">${(v.purchasePrice||0)>0?depStr:'—'}</td>
                <td class="text-right">
                    <button class="action-btn edit-btn" onclick="startEditVehicle('${v.id}')">Edit</button>
                    <button class="action-btn delete-btn" onclick="deleteVehicle('${v.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });
    tbody.innerHTML = html;
    renderVehicleStats();
}

function renderVehicleStats() {
    const list = state.vehicles || [];
    const totalValue = list.reduce((s, v) => s + (v.currentValue || 0), 0);
    const totalLoan = list.reduce((s, v) => s + (v.loanBalance || 0), 0);
    const totalEquity = totalValue - totalLoan;
    const totalDep = list.reduce((s, v) => s + ((v.purchasePrice||0) - (v.currentValue||0)), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('veh-stat-value', formatCurrency(totalValue));
    set('veh-stat-equity', formatCurrency(totalEquity));
    set('veh-stat-loan', formatCurrency(totalLoan));
    set('veh-stat-dep', (totalDep >= 0 ? '-' : '+') + formatCurrency(Math.abs(totalDep)));
    const depEl = document.getElementById('veh-stat-dep');
    if (depEl) depEl.style.color = totalDep > 0 ? 'var(--color-danger)' : 'var(--color-success)';
}

/* --------------------------------------------------------------------------
   Projections — Scenario Comparison & Milestones
   -------------------------------------------------------------------------- */

function renderScenarioComparison() {
    const container = document.getElementById('scenario-comparison-container');
    if (!container) return;

    const currentAge = state.projectionSettings.currentAge || 30;
    const scenarios = [
        { label: 'Base Case',          icon: '📊', savingsMultiplier: 1,    returnOffset: 0,  inflationOffset: 0,  isBase: true },
        { label: 'Savings +10%',       icon: '💰', savingsMultiplier: 1.10, returnOffset: 0,  inflationOffset: 0  },
        { label: 'Savings +20%',       icon: '💰', savingsMultiplier: 1.20, returnOffset: 0,  inflationOffset: 0  },
        { label: 'Bear Market (−2%)',  icon: '🐻', savingsMultiplier: 1,    returnOffset: -2, inflationOffset: 0  },
        { label: 'Severe Bear (−4%)', icon: '🐻', savingsMultiplier: 1,    returnOffset: -4, inflationOffset: 0  },
        { label: 'Inflation +1%',      icon: '📈', savingsMultiplier: 1,    returnOffset: 0,  inflationOffset: 1  },
        { label: 'Inflation +2%',      icon: '📈', savingsMultiplier: 1,    returnOffset: 0,  inflationOffset: 2  },
    ];

    const results = scenarios.map(s => ({ ...s, fireAge: computeScenarioFIREDate(s) }));
    const baseAge = results.find(r => r.isBase)?.fireAge;

    const rows = results.map(r => {
        const age = r.fireAge;
        const yearsAway = age !== null ? age - currentAge : null;
        const delta = (!r.isBase && age !== null && baseAge !== null) ? age - baseAge : null;

        const ageCell = age !== null
            ? `<strong>Age ${age}</strong>`
            : `<span class="text-muted">Not within 80 yrs</span>`;

        const deltaCell = r.isBase ? '<span class="scen-delta-neutral">base</span>' :
            delta === null ? '<span class="text-muted">—</span>' :
            delta < 0 ? `<span class="scen-delta-better">${delta} yrs</span>` :
            delta > 0 ? `<span class="scen-delta-worse">+${delta} yrs</span>` :
            '<span class="scen-delta-neutral">same</span>';

        return `<tr class="${r.isBase ? 'scen-base-row' : ''}">
            <td class="scen-label-cell">${r.icon} ${r.label}</td>
            <td>${ageCell}</td>
            <td class="text-muted">${yearsAway !== null ? yearsAway + ' yrs' : '—'}</td>
            <td>${deltaCell}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `<table class="scenario-compare-table">
        <thead><tr><th>Scenario</th><th>FIRE Age</th><th>Years Away</th><th>vs. Base</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
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

/* --------------------------------------------------------------------------
   Dashboard — Banner, Quick Stats, Cash Flow, Diversification
   -------------------------------------------------------------------------- */

function renderAllocMiniBarsBanner() {
    const el = document.getElementById('banner-alloc-bars');
    if (!el) return;
    const cash = getAggregateCash(), cds = getAggregateCDs(), equities = getAggregateEquities();
    const re = getAggregateRealEstate(), veh = getAggregateVehicles();
    const other = getAggregateOtherAssets() + getSideGigYTDNet();
    const total = cash + cds + equities + re + veh + other;
    if (total === 0) { el.innerHTML = ''; return; }
    const segments = [
        { amt: cash,     pct: (cash / total) * 100,     color: '#10b981', label: 'Cash' },
        { amt: cds,      pct: (cds / total) * 100,      color: '#f59e0b', label: 'CDs' },
        { amt: equities, pct: (equities / total) * 100, color: '#8b5cf6', label: 'Equities' },
        { amt: re,       pct: (re / total) * 100,       color: '#06b6d4', label: 'Real Estate' },
        { amt: veh,      pct: (veh / total) * 100,      color: '#f97316', label: 'Vehicles' },
        { amt: other,    pct: (other / total) * 100,    color: '#3b82f6', label: 'Other' },
    ].filter(s => s.pct > 0);
    el.innerHTML = `<div class="alloc-bar-track">${segments.map(s =>
        `<div class="alloc-bar-seg" style="width:${s.pct.toFixed(1)}%;background:${s.color};" title="${s.label}: ${s.pct.toFixed(1)}%"></div>`
    ).join('')}</div>`;

    const track = el.querySelector('.alloc-bar-track');
    const tip = document.getElementById('alloc-tooltip');
    if (!track || !tip) return;

    const tooltipRows = segments.map(s =>
        `<div class="at-row"><span class="at-dot" style="background:${s.color};"></span><span class="at-label">${s.label}</span><span class="at-val">${formatCurrency(s.amt)}</span><span class="at-pct">${s.pct.toFixed(1)}%</span></div>`
    ).join('');
    const totalRow = `<div class="at-total"><span class="at-label">Total NW</span><span class="at-val">${formatCurrency(total)}</span></div>`;

    track.addEventListener('mouseenter', () => {
        tip.innerHTML = tooltipRows + totalRow;
        tip.style.display = 'block';
    });
    track.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    track.addEventListener('mousemove', e => {
        const x = e.clientX + 14, y = e.clientY - 10;
        const vw = window.innerWidth, tw = tip.offsetWidth || 240;
        tip.style.left = (x + tw > vw ? vw - tw - 8 : x) + 'px';
        tip.style.top = y + 'px';
    });
}

function renderDiversificationSuggestions(totalPortfolioValue) {
    const block = document.getElementById('divs-suggestion-block');
    if (!block) return;
    const nw = getAggregateNetWorth();
    if (!nw || nw === 0) { block.innerHTML = ''; return; }
    const cashPct = (getAggregateCash() / nw) * 100;
    const eqPct = (getAggregateEquities() / nw) * 100;
    const cdsPct = (getAggregateCDs() / nw) * 100;
    const rePct = (getAggregateRealEstate() / nw) * 100;

    const suggestions = [];
    if (cashPct > 30) suggestions.push(`Cash is ${cashPct.toFixed(0)}% of NW — consider deploying some into higher-yield CDs or index funds.`);
    if (eqPct > 70) suggestions.push(`Equities are ${eqPct.toFixed(0)}% of NW — bonds or CD exposure could reduce volatility.`);
    if (eqPct < 30 && nw > 50000) suggestions.push(`Equities are only ${eqPct.toFixed(0)}% of NW — long-term FIRE typically needs more equity growth.`);
    if (cdsPct > 40) suggestions.push(`CDs are ${cdsPct.toFixed(0)}% of NW — solid fixed income, but ensure enough equity for long-term growth.`);
    if (rePct === 0 && nw > 100000) suggestions.push(`No real estate in portfolio — property can diversify away from market correlation.`);
    if (totalPortfolioValue > 0) {
        state.importedPositions.forEach(pos => {
            const w = (pos.value || 0) / totalPortfolioValue * 100;
            if (w >= 20 && !isSettledCash(pos)) suggestions.push(`${pos.symbol} is ${w.toFixed(1)}% of your equity — concentration above 20% increases single-stock risk.`);
        });
    }

    if (suggestions.length === 0) { block.innerHTML = ''; return; }
    block.innerHTML = `<div class="divs-header">💡 Diversification Suggestions</div><ul class="divs-list">${suggestions.map(s => `<li>${s}</li>`).join('')}</ul>`;
}

function renderQuickStatsList() {
    document.getElementById('stat-cash').textContent = formatCurrency(getAggregateCash());
    document.getElementById('stat-cds').textContent = formatCurrency(getAggregateCDs());
    document.getElementById('stat-equities').textContent = formatCurrency(getAggregateEquities());
    document.getElementById('stat-sidegig').textContent = formatCurrency(getSideGigYTDNet());
    const reEl = document.getElementById('stat-realestate');
    if (reEl) reEl.textContent = formatCurrency(getAggregateRealEstate());
    const vEl = document.getElementById('stat-vehicles');
    if (vEl) vEl.textContent = formatCurrency(getAggregateVehicles());
}

function renderMonthlyCashFlow() {
    const grossIncome = parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
    const monthlyGross = grossIncome / 12;
    const sideGigMonthly = getSideGigYTDNet() / Math.max(new Date().getMonth() + 1, 1);
    const cdMonthly = state.cds.reduce((sum, cd) => sum + (cd.principal || 0) * ((cd.rate || 0) / 100) / 12, 0);

    const totalIncome = monthlyGross + sideGigMonthly + cdMonthly;

    const exp = state.expenses;
    const housing = exp.housing || 0;
    const utilities = exp.utilities || 0;
    const food = exp.food || 0;
    const transport = exp.transport || 0;
    const healthcare = exp.healthcare || 0;
    const discretionary = exp.discretionary || 0;
    const ins = state.insurances || {};
    const carIns = insuranceToMonthly(ins.car || {});
    const homeIns = insuranceToMonthly(ins.home || {});
    const totalExpenses = housing + utilities + food + transport + healthcare + discretionary + carIns + homeIns;

    const net = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? Math.max(0, (net / totalIncome) * 100) : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('cf-salary', formatCurrency(monthlyGross));
    set('cf-sidegig', formatCurrency(sideGigMonthly));
    set('cf-cd-interest', formatCurrency(cdMonthly));
    set('cf-total-income', formatCurrency(totalIncome));
    set('cf-housing', formatCurrency(housing));
    set('cf-utilities', formatCurrency(utilities));
    set('cf-food', formatCurrency(food));
    set('cf-transport', formatCurrency(transport));
    set('cf-healthcare', formatCurrency(healthcare));
    set('cf-discretionary', formatCurrency(discretionary));
    set('cf-car-insurance', formatCurrency(carIns));
    set('cf-home-insurance', formatCurrency(homeIns));
    set('cf-total-expenses', formatCurrency(totalExpenses));

    const netEl = document.getElementById('cf-net-value');
    if (netEl) {
        netEl.textContent = (net >= 0 ? '+' : '') + formatCurrency(net);
        netEl.className = `cf-net-value ${net >= 0 ? 'text-emerald' : 'text-coral'}`;
    }
    const labelEl = document.getElementById('cf-net-label');
    if (labelEl) {
        if (totalIncome === 0) {
            labelEl.textContent = 'Set your gross income in Expenses & Taxes to populate this section.';
        } else if (net >= 0) {
            labelEl.textContent = `You have ${formatCurrency(net)}/mo surplus to invest or save.`;
        } else {
            labelEl.textContent = `You are spending ${formatCurrency(Math.abs(net))}/mo more than you earn.`;
        }
    }

    set('cf-savings-rate', `${savingsRate.toFixed(1)}%`);
    set('cf-annual-surplus', (net >= 0 ? '+' : '') + formatCurrency(net * 12));

    const incomePct = totalIncome > 0 && totalExpenses > 0
        ? Math.min(100, (totalIncome / (totalIncome + totalExpenses)) * 100)
        : 50;
    const barIncome = document.getElementById('cf-bar-income');
    const barExpense = document.getElementById('cf-bar-expense');
    if (barIncome) barIncome.style.width = `${incomePct}%`;
    if (barExpense) barExpense.style.width = `${100 - incomePct}%`;
}
