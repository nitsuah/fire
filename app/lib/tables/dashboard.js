/* ==========================================================================
   tables/dashboard.js — Dashboard banner, quick stats, cash flow, and
                         diversification suggestion renderers
   ========================================================================== */

function renderAllocMiniBarsBanner() {
    const el = document.getElementById('banner-alloc-bars');
    if (!el) return;
    const cash = getAggregateCash(),
        cds = getAggregateCDs(),
        equities = getAggregateEquities();
    const re = getAggregateRealEstate(),
        veh = getAggregateVehicles();
    const other = getAggregateOtherAssets() + getSideGigYTDNet();
    const total = cash + cds + equities + re + veh + other;
    if (total === 0) {
        el.innerHTML = '';
        return;
    }
    const segments = [
        {
            amt: cash,
            pct: (cash / total) * 100,
            color: '#10b981',
            label: 'Cash',
        },
        { amt: cds, pct: (cds / total) * 100, color: '#f59e0b', label: 'CDs' },
        {
            amt: equities,
            pct: (equities / total) * 100,
            color: '#8b5cf6',
            label: 'Equities',
        },
        {
            amt: re,
            pct: (re / total) * 100,
            color: '#06b6d4',
            label: 'Real Estate',
        },
        {
            amt: veh,
            pct: (veh / total) * 100,
            color: '#f97316',
            label: 'Vehicles',
        },
        {
            amt: other,
            pct: (other / total) * 100,
            color: '#3b82f6',
            label: 'Other',
        },
    ].filter((s) => s.pct > 0);
    el.innerHTML = `<div class="alloc-bar-track">${segments
        .map(
            (s) =>
                `<div class="alloc-bar-seg" style="width:${s.pct.toFixed(1)}%;background:${s.color};" title="${s.label}: ${s.pct.toFixed(1)}%"></div>`,
        )
        .join('')}</div>`;

    const track = el.querySelector('.alloc-bar-track');
    const tip = document.getElementById('alloc-tooltip');
    if (!track || !tip) return;

    const tooltipRows = segments
        .map(
            (s) =>
                `<div class="at-row"><span class="at-dot" style="background:${s.color};"></span><span class="at-label">${s.label}</span><span class="at-val">${formatCurrency(s.amt)}</span><span class="at-pct">${s.pct.toFixed(1)}%</span></div>`,
        )
        .join('');
    const totalRow = `<div class="at-total"><span class="at-label">Total NW</span><span class="at-val">${formatCurrency(total)}</span></div>`;

    track.addEventListener('mouseenter', () => {
        tip.innerHTML = tooltipRows + totalRow;
        tip.style.display = 'block';
    });
    track.addEventListener('mouseleave', () => {
        tip.style.display = 'none';
    });
    track.addEventListener('mousemove', (e) => {
        const x = e.clientX + 14,
            y = e.clientY - 10;
        const vw = window.innerWidth,
            tw = tip.offsetWidth || 240;
        tip.style.left = (x + tw > vw ? vw - tw - 8 : x) + 'px';
        tip.style.top = y + 'px';
    });
}

function renderDiversificationSuggestions(totalPortfolioValue) {
    const block = document.getElementById('divs-suggestion-block');
    if (!block) return;
    const nw = getAggregateNetWorth();
    if (!nw || nw === 0) {
        block.innerHTML = '';
        return;
    }
    const cashPct = (getAggregateCash() / nw) * 100;
    const eqPct = (getAggregateEquities() / nw) * 100;
    const cdsPct = (getAggregateCDs() / nw) * 100;
    const rePct = (getAggregateRealEstate() / nw) * 100;

    const suggestions = [];
    if (cashPct > 30)
        suggestions.push(
            `Cash is ${cashPct.toFixed(0)}% of NW — consider deploying some into higher-yield CDs or index funds.`,
        );
    if (eqPct > 70)
        suggestions.push(
            `Equities are ${eqPct.toFixed(0)}% of NW — bonds or CD exposure could reduce volatility.`,
        );
    if (eqPct < 30 && nw > 50000)
        suggestions.push(
            `Equities are only ${eqPct.toFixed(0)}% of NW — long-term FIRE typically needs more equity growth.`,
        );
    if (cdsPct > 40)
        suggestions.push(
            `CDs are ${cdsPct.toFixed(0)}% of NW — solid fixed income, but ensure enough equity for long-term growth.`,
        );
    if (rePct === 0 && nw > 100000)
        suggestions.push(
            `No real estate in portfolio — property can diversify away from market correlation.`,
        );
    if (totalPortfolioValue > 0) {
        state.importedPositions.forEach((pos) => {
            const w = ((pos.value || 0) / totalPortfolioValue) * 100;
            if (w >= 20 && !isSettledCash(pos))
                suggestions.push(
                    `${escHtml(pos.symbol)} is ${w.toFixed(1)}% of your equity — concentration above 20% increases single-stock risk.`,
                );
        });
    }

    if (suggestions.length === 0) {
        block.innerHTML = '';
        return;
    }
    block.innerHTML = `<div class="divs-header">💡 Diversification Suggestions</div><ul class="divs-list">${suggestions.map((s) => `<li>${s}</li>`).join('')}</ul>`;
}

function renderQuickStatsList() {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('stat-cash', formatCurrency(getAggregateCash()));
    set('stat-cds', formatCurrency(getAggregateCDs()));
    set('stat-equities', formatCurrency(getAggregateEquities()));
    set('stat-sidegig', formatCurrency(getSideGigYTDNet()));
    set('stat-realestate', formatCurrency(getAggregateRealEstate()));
    set('stat-vehicles', formatCurrency(getAggregateVehicles()));
}

function renderMonthlyCashFlow() {
    const grossIncome =
        parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
    const monthlyGross = grossIncome / 12;
    const sideGigMonthly =
        getSideGigYTDNet() / Math.max(new Date().getMonth() + 1, 1);
    const cdMonthly = state.cds.reduce(
        (sum, cd) => sum + ((cd.principal || 0) * ((cd.rate || 0) / 100)) / 12,
        0,
    );

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
    const totalExpenses =
        housing +
        utilities +
        food +
        transport +
        healthcare +
        discretionary +
        carIns +
        homeIns;

    const net = totalIncome - totalExpenses;
    const savingsRate =
        totalIncome > 0 ? Math.max(0, (net / totalIncome) * 100) : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
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
            labelEl.textContent =
                'Set your gross income in Expenses & Taxes to populate this section.';
        } else if (net >= 0) {
            labelEl.textContent = `You have ${formatCurrency(net)}/mo surplus to invest or save.`;
        } else {
            labelEl.textContent = `You are spending ${formatCurrency(Math.abs(net))}/mo more than you earn.`;
        }
    }

    set('cf-savings-rate', `${savingsRate.toFixed(1)}%`);
    set('cf-annual-surplus', (net >= 0 ? '+' : '') + formatCurrency(net * 12));

    const incomePct =
        totalIncome > 0 && totalExpenses > 0
            ? Math.min(100, (totalIncome / (totalIncome + totalExpenses)) * 100)
            : 50;
    const barIncome = document.getElementById('cf-bar-income');
    const barExpense = document.getElementById('cf-bar-expense');
    if (barIncome) barIncome.style.width = `${incomePct}%`;
    if (barExpense) barExpense.style.width = `${100 - incomePct}%`;
}
