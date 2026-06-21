/* ==========================================================================
   tables.js — Table, panel, and card rendering functions
   All functions reference global state and vars defined in app.js.
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

/* --------------------------------------------------------------------------
   Investment Positions Table
   -------------------------------------------------------------------------- */

function renderDashboardTopPositionsTable() {
    const tbody = document.querySelector('#table-dashboard-positions tbody');
    if (!tbody) return;

    if (state.importedPositions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No investments imported yet. Upload a Fidelity CSV statement in the Accounts tab.</td></tr>`;
        updateSortHeaders();
        renderDiversificationSuggestions(0);
        return;
    }

    const maxAbsPct = state.importedPositions.reduce((m, p) => Math.max(m, Math.abs(p.pnlPercent || 0)), 0);
    const totalPortfolioValue = state.importedPositions.reduce((s, p) => s + (p.value || 0), 0);

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
        const nonCash = positions.filter(p => !isSettledCash(p));
        const accCostBasis = nonCash.reduce((sum, p) => sum + (p.costBasis || 0), 0);
        const accPnL = accCostBasis > 0
            ? nonCash.reduce((sum, p) => sum + (p.value || 0), 0) - accCostBasis
            : nonCash.reduce((sum, p) => sum + (p.pnlDollar || 0), 0);
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
                <td colspan="4"><span class="${chevronClass}">▼</span> <strong>${accName}</strong></td>
                <td class="text-right font-bold text-muted">${accCostBasis > 0 ? formatCurrency(accCostBasis) : '—'}</td>
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
                const settled = isSettledCash(pos);

                let pnlText = '—';
                if (!settled && Math.abs(pnlVal) > 0.01) {
                    pnlText = pnlVal > 0
                        ? `+${formatCurrency(pnlVal)} (+${Math.abs(pnlPct).toFixed(2)}%)`
                        : `-${formatCurrency(Math.abs(pnlVal))} (${pnlPct.toFixed(2)}%)`;
                }

                const weight = totalPortfolioValue > 0 ? (pos.value || 0) / totalPortfolioValue * 100 : 0;
                let riskBadge = '';
                if (!settled && weight >= 20) riskBadge = `<span class="risk-badge risk-high" title="${weight.toFixed(1)}% of portfolio">⚠</span>`;
                else if (!settled && weight >= 15) riskBadge = `<span class="risk-badge risk-med" title="${weight.toFixed(1)}% of portfolio">⚡</span>`;

                const MKTBENCH = 10;
                let mktBadge = '';
                if (!settled && Math.abs(pnlPct) > 0.01) {
                    mktBadge = pnlPct >= MKTBENCH
                        ? `<span class="mkt-badge mkt-up" title="${(pnlPct - MKTBENCH).toFixed(1)}% above ~10% market avg">▲ mkt</span>`
                        : `<span class="mkt-badge mkt-dn" title="${(pnlPct - MKTBENCH).toFixed(1)}% below ~10% market avg">▼ mkt</span>`;
                }

                const sym = pos.symbol || '';
                html += `
                    <tr class="position-row" data-account="${accName.replace(/"/g, '&quot;')}" data-symbol="${sym}">
                        <td class="font-bold text-purple">${sym} ${riskBadge}</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pos.description || ''}</td>
                        <td class="text-right">${(pos.quantity || 0).toLocaleString(undefined, {maximumFractionDigits: 3})}</td>
                        <td class="text-right">${formatCurrency(pos.lastPrice || 0)}</td>
                        <td class="text-right text-muted">${(pos.costBasis || 0) > 0 ? formatCurrency(pos.costBasis) : '—'}</td>
                        <td class="text-right font-bold" style="${valStyle}">${formatCurrency(pos.value || 0)}</td>
                        <td class="text-right font-bold" style="${pnlStyle}">${pnlText} ${mktBadge}</td>
                    </tr>
                `;
            });
        }
    });
    tbody.innerHTML = html;
    updateSortHeaders();
    renderDiversificationSuggestions(totalPortfolioValue);
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

/* --------------------------------------------------------------------------
   Cash & Fixed Income Panel
   -------------------------------------------------------------------------- */

function renderDashboardLiquidPanel() {
    const panel = document.getElementById('dashboard-liquid-panel');
    if (!panel) return;

    const today = new Date();
    let html = '';

    const cashAccounts = state.customAccounts.filter(a => a.type === 'Cash' || a.type === 'Savings');
    const mmPositions = state.importedPositions.filter(p => isSettledCash(p));

    if (cashAccounts.length > 0 || mmPositions.length > 0) {
        html += `<div class="liquid-section-label">Cash &amp; Savings</div>`;
        cashAccounts.forEach(acc => {
            const apyStr = acc.apy > 0 ? `<span class="liquid-rate">${Number(acc.apy).toFixed(2)}% APY</span>` : '';
            html += `<div class="liquid-row">
                <div class="liquid-name">${acc.name} <span class="liquid-type">${acc.type}</span></div>
                <div class="liquid-val">${formatCurrency(acc.value)} ${apyStr}</div>
            </div>`;
        });
        mmPositions.forEach(pos => {
            html += `<div class="liquid-row">
                <div class="liquid-name">${pos.symbol} <span class="liquid-type">Money Market</span></div>
                <div class="liquid-val">${formatCurrency(pos.value)}</div>
            </div>`;
        });
    }

    if (state.cds.length > 0) {
        html += `<div class="liquid-section-label mt-2">Certificates of Deposit</div>`;
        state.cds.forEach(cd => {
            if (!cd || cd.principal === undefined) return;
            const matDate = new Date(cd.maturity);
            const daysLeft = Math.ceil((matDate - today) / 86400000);
            const isMatured = daysLeft < 0;
            const isSoon = !isMatured && daysLeft <= 30;
            const annualYield = (cd.principal || 0) * ((cd.rate || 0) / 100);
            const statusColor = isMatured ? 'var(--color-danger)' : isSoon ? '#f59e0b' : 'rgba(255,255,255,0.4)';
            const statusText = isMatured
                ? `Matured ${Math.abs(daysLeft)}d ago`
                : isSoon ? `Matures in ${daysLeft}d`
                : `${daysLeft}d left`;
            html += `<div class="liquid-row">
                <div class="liquid-name">
                    ${cd.bank} <span class="liquid-type">CD · ${Number(cd.rate).toFixed(2)}%</span>
                    <span class="liquid-maturity" style="color:${statusColor};">${statusText}</span>
                </div>
                <div class="liquid-val">
                    ${formatCurrency(cd.principal)}
                    <span class="cd-yield-badge">${formatCurrency(annualYield)}<span class="cd-yield-unit">/yr</span></span>
                </div>
            </div>`;
        });
    }

    if (!html) {
        panel.innerHTML = `<p class="text-muted text-center" style="padding:12px 0;">No cash accounts or CDs recorded yet.</p>`;
        return;
    }
    panel.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Imported Files Table
   -------------------------------------------------------------------------- */

function renderImportedFilesTable() {
    const tbody = document.querySelector('#table-imported-files tbody');
    if (!tbody) return;

    if (state.importedFiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No files imported yet.</td></tr>`;
        return;
    }

    let html = '';
    state.importedFiles.forEach((file, index) => {
        html += `
            <tr>
                <td class="font-bold" title="${file.date}">${file.name}</td>
                <td><span class="text-purple">${file.source}</span></td>
                <td>${file.records}</td>
                <td class="text-right">
                    <button class="delete-btn" onclick="deleteImportedFile(${index})">Remove</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Custom Accounts Table
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   CD Table
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   Unified Holdings Table (accounts + CDs merged)
   -------------------------------------------------------------------------- */

function renderUnifiedHoldingsTable() {
    const tbody = document.querySelector('#table-unified-holdings tbody');
    if (!tbody) return;

    const total = state.customAccounts.length + state.cds.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No accounts or CDs added yet.</td></tr>`;
        return;
    }

    let html = '';

    state.customAccounts.forEach(acc => {
        if (!acc || acc.value === undefined) return;
        const isEditing = editingAccounts.includes(acc.id);
        const hasYield = acc.type === 'Savings' || acc.type === 'Cash';
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${acc.name}"></td>
                <td><span class="text-muted">${acc.type}</span></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:110px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}"></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:70px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy).toFixed(2)}" ${hasYield ? '' : 'disabled'}></td>
                <td>—</td>
                <td class="text-right">
                    <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                    <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `<tr>
                <td class="font-bold">${acc.name}</td>
                <td><span class="badge-type">${acc.type}</span></td>
                <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                <td class="text-right text-amber">${hasYield ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                <td class="text-muted">—</td>
                <td class="text-right">
                    <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });

    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);
        const isMatured = new Date(cd.maturity) < new Date();
        const interest = (cd.principal || 0) * ((cd.rate || 0) / 100);
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${cd.bank}"></td>
                <td><span class="badge-type badge-cd">CD</span></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:110px;" id="edit-cd-principal-${cd.id}" step="0.01" value="${Number(cd.principal).toFixed(2)}"></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:70px;" id="edit-cd-rate-${cd.id}" step="0.01" value="${Number(cd.rate).toFixed(2)}"></td>
                <td><input type="date" class="inline-edit-input" id="edit-cd-maturity-${cd.id}" value="${cd.maturity}"><input type="date" class="inline-edit-input" id="edit-cd-start-${cd.id}" value="${cd.startDate || ''}" style="display:none;"></td>
                <td class="text-right">
                    <button class="save-btn" onclick="saveEditCD('${cd.id}')">Save</button>
                    <button class="cancel-btn" onclick="cancelEditCD('${cd.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `<tr>
                <td class="font-bold">${cd.bank} <span class="text-muted" style="font-size:10px;">+${formatCurrency(interest)}/yr</span></td>
                <td><span class="badge-type badge-cd">CD</span></td>
                <td class="text-right font-bold">${formatCurrency(cd.principal)}</td>
                <td class="text-right text-amber">${Number(cd.rate).toFixed(2)}%</td>
                <td style="color:${isMatured ? 'var(--color-danger)' : 'rgba(255,255,255,0.6)'};">${cd.maturity}${isMatured ? ' ⚠' : ''}</td>
                <td class="text-right">
                    <button class="edit-btn" onclick="startEditCD('${cd.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteCD('${cd.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Side Gig Ledger Table
   -------------------------------------------------------------------------- */

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
