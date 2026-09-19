/* ==========================================================================
   tables/dashboard.js — Dashboard banner, quick stats, cash flow, and
                         diversification suggestion renderers
   ========================================================================== */

function getBannerAllocSegments() {
    const parts = [
        { amt: getAggregateCash(), color: '#10b981', label: 'Cash' },
        { amt: getAggregateCDs(), color: '#f59e0b', label: 'CDs' },
        { amt: getAggregateEquities(), color: '#8b5cf6', label: 'Equities' },
        {
            amt: getAggregateRealEstate(),
            color: '#06b6d4',
            label: 'Real Estate',
        },
        { amt: getAggregateVehicles(), color: '#f97316', label: 'Vehicles' },
        {
            amt: getAggregateOtherAssets() + getSideGigYTDNet(),
            color: '#3b82f6',
            label: 'Other',
        },
    ];
    const total = parts.reduce((sum, p) => sum + p.amt, 0);
    // Percentages are relative to the positive amounts actually drawn, so a
    // negative component can't push the visible segments past 100%.
    const shown = parts.filter((p) => p.amt > 0);
    const shownTotal = shown.reduce((sum, p) => sum + p.amt, 0);
    const segments = shown.map((p) => ({
        ...p,
        pct: (p.amt / shownTotal) * 100,
    }));
    return { segments, total };
}

function getBannerIncome() {
    return {
        gross:
            parseFloat(document.getElementById('tax-gross-income')?.value) || 0,
        side: getSideGigYTDNet(),
    };
}

// Sets the summary banner's Net Worth / Income / Spend Rate / FIRE Progress
// text, plus the narrow-width single-bar variant of the same data.
function renderHeaderBannerMetrics() {
    const networth = getAggregateNetWorth();
    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;
    const progressPercent =
        fireNumber > 0
            ? Math.max(0, Math.min((networth / fireNumber) * 100, 100))
            : 0;

    document.getElementById('banner-networth').textContent =
        formatCurrency(networth);
    document.getElementById('banner-spend').textContent =
        formatCurrency(annualExpenses);
    document.getElementById('banner-progress').textContent =
        `${progressPercent.toFixed(1)}%`;
    document.getElementById('banner-target').textContent =
        `Target: ${formatCurrency(fireNumber)}`;

    const fireBarEl = document.getElementById('banner-fire-bar');
    if (fireBarEl) fireBarEl.style.width = `${Math.min(progressPercent, 100)}%`;

    const income = getBannerIncome();
    const grossIncomeEl = document.getElementById('banner-gross-income');
    if (grossIncomeEl) grossIncomeEl.textContent = formatCurrency(income.gross);
    const sideIncomeEl = document.getElementById('banner-side-income');
    if (sideIncomeEl)
        sideIncomeEl.textContent =
            income.side > 0
                ? `+ ${formatCurrency(income.side)} side hustle`
                : 'No side income';

    renderCompactFireBar(progressPercent);
}

// Narrow-width single bar: the filled portion is FIRE progress, split into
// net-worth allocation segments. Hidden by CSS on wide screens.
function renderCompactFireBar(progressPercent) {
    const fill = document.getElementById('cfb-fill');
    const pct = document.getElementById('cfb-pct');
    if (!fill || !pct) return;
    const { segments } = getBannerAllocSegments();
    const shown = Math.min(progressPercent, 100);
    fill.style.width = `${shown}%`;
    fill.innerHTML = segments
        .map(
            (s) =>
                `<span class="cfb-seg" style="width:${s.pct.toFixed(2)}%;background:${s.color};"></span>`,
        )
        .join('');
    pct.textContent = `${progressPercent.toFixed(1)}%`;
    const bar = document.getElementById('compact-fire-bar');
    if (bar) {
        bar.setAttribute('aria-valuenow', progressPercent.toFixed(1));
        bar.setAttribute(
            'aria-valuetext',
            `${progressPercent.toFixed(1)}% of FIRE target`,
        );
    }
}

function buildCompactBarTooltipHtml() {
    const { segments, total } = getBannerAllocSegments();
    const annualExpenses = getAnnualExpensesTotal();
    const income = getBannerIncome();
    const rows = segments
        .map(
            (s) =>
                `<div class="at-row"><span class="at-dot" style="background:${s.color};"></span><span class="at-label">${s.label}</span><span class="at-val">${formatCurrency(s.amt)}</span><span class="at-pct">${s.pct.toFixed(1)}%</span></div>`,
        )
        .join('');
    const totalRow = `<div class="at-total"><span class="at-label">Net Worth</span><span class="at-val">${formatCurrency(total)}</span></div>`;
    const flowRows = `<div class="at-row"><span class="at-label">Income / yr</span><span class="at-val">${formatCurrency(income.gross)}</span></div><div class="at-row"><span class="at-label">Side income YTD</span><span class="at-val">${formatCurrency(income.side)}</span></div><div class="at-row"><span class="at-label">Spend / yr</span><span class="at-val">${formatCurrency(annualExpenses)}</span></div>`;
    return rows + totalRow + flowRows;
}

function initCompactFireBar() {
    const bar = document.getElementById('compact-fire-bar');
    const tip = document.getElementById('alloc-tooltip');
    if (!bar || !tip) return;
    const show = () => {
        tip.innerHTML = buildCompactBarTooltipHtml();
        tip.style.display = 'block';
        const r = bar.getBoundingClientRect();
        const tw = tip.offsetWidth || 240;
        tip.style.left =
            Math.max(8, Math.min(r.left, window.innerWidth - tw - 8)) + 'px';
        tip.style.top = r.bottom + 8 + 'px';
    };
    const hide = () => {
        tip.style.display = 'none';
    };
    bar.addEventListener('mouseenter', show);
    bar.addEventListener('mouseleave', hide);
    bar.addEventListener('focus', show);
    bar.addEventListener('blur', hide);
    // Mouse users get hover; touch has no hover, so a tap toggles instead.
    let lastPointerType = 'mouse';
    bar.addEventListener('pointerdown', (e) => {
        lastPointerType = e.pointerType;
    });
    bar.addEventListener('click', (e) => {
        e.stopPropagation();
        if (lastPointerType !== 'touch') return;
        if (tip.style.display === 'block') hide();
        else show();
    });
    document.addEventListener('click', hide);
}

// In portrait at hamburger widths the summary bar (and the alerts bell) live
// in the fixed top bar next to the menu button instead of a banner below it.
// Landscape keeps the banner, since a top bar there would eat scarce height.
function initCompactBarPlacement() {
    const bar = document.getElementById('compact-fire-bar');
    const bell = document.querySelector('.notif-bell-wrap');
    const banner = document.querySelector('.header-banner');
    const sidebar = document.querySelector('.sidebar');
    const container = document.querySelector('.app-container');
    if (!bar || !bell || !banner || !sidebar || !container) return;
    const bellHome = bell.parentElement;
    const mq = window.matchMedia(
        '(max-width: 768px) and (orientation: portrait)',
    );
    const place = () => {
        if (mq.matches) {
            sidebar.append(bar, bell);
            container.classList.add('topbar-summary');
        } else {
            banner.appendChild(bar);
            bellHome.appendChild(bell);
            container.classList.remove('topbar-summary');
        }
    };
    mq.addEventListener('change', place);
    place();
}

function renderAllocMiniBarsBanner() {
    const el = document.getElementById('banner-alloc-bars');
    if (!el) return;
    const { segments, total } = getBannerAllocSegments();
    if (total === 0) {
        el.innerHTML = '';
        return;
    }
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

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Diversification Tip Tiles - Data-driven suggestions with curated resources
// Each tip's check and message receive a context object: { nw, totalPortfolioValue, cashPct, eqPct, cdsPct, rePct }
const DIVERSIFICATION_TIPS = [
    {
        id: 'high-cash',
        title: 'High Cash Allocation',
        icon: '💵',
        check: ({ cashPct }) => cashPct > 30,
        severity: 'info',
        message: ({ cashPct }) =>
            `Cash is ${cashPct.toFixed(0)}% of NW — consider deploying into higher-yield CDs or index funds.`,
        links: [
            {
                label: 'CD Ladder Strategy',
                url: 'https://www.investopedia.com/terms/c/cdladder.asp',
                external: true,
            },
            {
                label: 'High-Yield Savings vs CDs',
                url: 'https://www.nerdwallet.com/article/banking/cd-vs-savings-account',
                external: true,
            },
        ],
    },
    {
        id: 'high-equity',
        title: 'Equity Concentration Risk',
        icon: '📈',
        check: ({ eqPct }) => eqPct > 70,
        severity: 'warning',
        message: ({ eqPct }) =>
            `Equities are ${eqPct.toFixed(0)}% of NW — bonds or CD exposure could reduce volatility.`,
        links: [
            {
                label: 'Asset Allocation Models',
                url: 'https://www.vanguard.com/learn/asset-allocation',
                external: true,
            },
            {
                label: 'Bond ETF Guide',
                url: 'https://www.etf.com/etfanalytics/etf-finder',
                external: true,
            },
        ],
    },
    {
        id: 'low-equity',
        title: 'Low Equity Exposure',
        icon: '📉',
        check: ({ nw, eqPct }) => eqPct < 30 && nw > 50000,
        severity: 'info',
        message: ({ eqPct }) =>
            `Equities are only ${eqPct.toFixed(0)}% of NW — long-term FIRE typically needs more equity growth.`,
        links: [
            {
                label: 'Total Market Index Funds',
                url: 'https://www.bogleheads.org/wiki/Three-fund_portfolio',
                external: true,
            },
            {
                label: 'FIRE Portfolio Construction',
                url: 'https://earlyretirementnow.com/safe-withdrawal-rates/',
                external: true,
            },
        ],
    },
    {
        id: 'high-cds',
        title: 'Heavy Fixed Income',
        icon: '💿',
        check: ({ cdsPct }) => cdsPct > 40,
        severity: 'info',
        message: ({ cdsPct }) =>
            `CDs are ${cdsPct.toFixed(0)}% of NW — solid fixed income, but ensure enough equity for long-term growth.`,
        links: [
            {
                label: 'CD Ladder Calculator',
                url: 'https://www.bankrate.com/cd-ladder-calculator',
                external: true,
            },
        ],
    },
    {
        id: 'no-real-estate',
        title: 'Missing Real Estate',
        icon: '🏠',
        check: ({ nw, rePct }) => rePct === 0 && nw > 100000,
        severity: 'info',
        message: () =>
            `No real estate in portfolio — property can diversify away from market correlation.`,
        links: [
            {
                label: 'REITs vs Direct Property',
                url: 'https://www.investopedia.com/articles/investing/092915/reits-vs-rental-property.asp',
                external: true,
            },
            {
                label: 'Real Estate Crowdfunding',
                url: 'https://www.forbes.com/advisor/investing/real-estate-crowdfunding/',
                external: true,
            },
        ],
    },
    {
        id: 'single-stock',
        title: 'Single-Stock Concentration',
        icon: '⚠️',
        check: ({ totalPortfolioValue }) => {
            if (!totalPortfolioValue || totalPortfolioValue <= 0) return false;
            for (const pos of state.importedPositions) {
                const w = ((pos.value || 0) / totalPortfolioValue) * 100;
                if (w >= 20 && !isSettledCash(pos)) return true;
            }
            return false;
        },
        severity: 'warning',
        message: ({ totalPortfolioValue }) => {
            const concentrated = [];
            for (const pos of state.importedPositions) {
                const w = ((pos.value || 0) / totalPortfolioValue) * 100;
                if (w >= 20 && !isSettledCash(pos)) {
                    concentrated.push(
                        `${escHtml(pos.symbol)} (${w.toFixed(1)}%)`,
                    );
                }
            }
            return concentrated.length === 1
                ? `${concentrated[0]} of your equity — concentration above 20% increases single-stock risk.`
                : `${concentrated.join(', ')} exceed 20% each — concentration risk detected.`;
        },
        links: [
            {
                label: 'Diversification Benefits',
                url: 'https://www.investopedia.com/terms/d/diversification.asp',
                external: true,
            },
            {
                label: 'Tax-Efficient Rebalancing',
                url: 'https://www.bogleheads.org/wiki/Tax-efficient_fund_placement',
                external: true,
            },
        ],
    },
    {
        id: 'no-international',
        title: 'No International Exposure',
        icon: '🌍',
        check: ({ totalPortfolioValue }) => {
            if (!totalPortfolioValue || totalPortfolioValue <= 0) return false;
            let hasIntl = false;
            for (const pos of state.importedPositions) {
                const sym = pos.symbol || '';
                const desc = pos.description || '';
                // Common international ETF tickers
                if (
                    [
                        'VT',
                        'VXUS',
                        'VEU',
                        'IXUS',
                        'IEFA',
                        'IEMG',
                        'VWO',
                        'VEA',
                    ].includes(sym) ||
                    desc.toLowerCase().includes('international') ||
                    desc.toLowerCase().includes('emerging') ||
                    desc.toLowerCase().includes('ex-us') ||
                    desc.toLowerCase().includes('ex us') ||
                    desc.toLowerCase().includes('global') ||
                    desc.toLowerCase().includes('world')
                ) {
                    hasIntl = true;
                    break;
                }
            }
            return !hasIntl && totalPortfolioValue > 10000;
        },
        severity: 'info',
        message: () =>
            `No international equities detected — global diversification reduces country-specific risk.`,
        links: [
            {
                label: 'Total International ETFs',
                url: 'https://etfdb.com/etfs/total-international/',
                external: true,
            },
            {
                label: 'Why Global Diversification',
                url: 'https://www.bogleheads.org/wiki/International_diversification',
                external: true,
            },
        ],
    },
    {
        id: 'emergency-fund',
        title: 'Emergency Fund Watcher',
        icon: '🛟',
        check: ({ monthlyExpenses, cashMonths }) =>
            monthlyExpenses > 0 && cashMonths < 6,
        severity: ({ cashMonths }) => (cashMonths < 3 ? 'warning' : 'info'),
        message: ({ cashMonths }) =>
            `Liquid cash covers about ${cashMonths.toFixed(1)} months of expenses — 3–6 months is the usual safety net before investing the rest.`,
        links: [
            {
                label: 'How Big Should It Be?',
                url: 'https://www.investopedia.com/terms/e/emergency_fund.asp',
                external: true,
            },
        ],
    },
    {
        id: 'savings-rate',
        title: 'Savings Rate Check',
        icon: '🏦',
        check: ({ grossIncome, annualExpenses }) =>
            grossIncome > 0 &&
            annualExpenses > 0 &&
            (grossIncome - annualExpenses) / grossIncome < 0.15,
        severity: ({ grossIncome, annualExpenses }) =>
            grossIncome - annualExpenses < 0 ? 'warning' : 'info',
        message: ({ grossIncome, annualExpenses }) =>
            `Your rough savings rate is ${(((grossIncome - annualExpenses) / grossIncome) * 100).toFixed(0)}% (income vs. expenses incl. tax drag). Rates above ~20% shorten the road to FIRE dramatically.`,
        links: [
            {
                label: 'Savings Rate & FIRE',
                url: 'https://www.investopedia.com/terms/s/savings-rate.asp',
                external: true,
            },
        ],
    },
    {
        id: 'cd-maturing-soon',
        title: 'CD Maturing Soon',
        icon: '⏰',
        check: ({ cdsSoon }) => cdsSoon.length > 0,
        severity: 'info',
        message: ({ cdsSoon }) =>
            `${cdsSoon.length} CD${cdsSoon.length === 1 ? '' : 's'} mature within 60 days — decide now whether to roll over, ladder, or redeploy so the cash isn't left idle.`,
        links: [
            {
                label: 'CD Ladder Strategy',
                url: 'https://www.investopedia.com/terms/c/cdladder.asp',
                external: true,
            },
        ],
    },
    {
        id: 'aggressive-swr',
        title: 'Aggressive Withdrawal Rate',
        icon: '🎯',
        check: ({ swr }) => swr > 4.5,
        severity: 'warning',
        message: ({ swr }) =>
            `Your safe withdrawal rate is set to ${swr}% — above the classic 4% rule, which raises the risk of running out in a long retirement.`,
        links: [
            {
                label: 'The 4% Rule',
                url: 'https://www.investopedia.com/terms/f/four-percent-rule.asp',
                external: true,
            },
        ],
    },
    {
        id: 'crypto-share',
        title: 'Crypto Share of Net Worth',
        icon: '🪙',
        check: ({ cryptoPct }) => cryptoPct > 10,
        severity: 'info',
        message: ({ cryptoPct }) =>
            `Crypto is ${cryptoPct.toFixed(0)}% of net worth — high volatility; many planners cap speculative assets around 5–10%.`,
        links: [
            {
                label: 'Rebalancing Basics',
                url: 'https://www.investopedia.com/terms/r/rebalancing.asp',
                external: true,
            },
        ],
    },
];

function getDismissedTips() {
    try {
        const stored = localStorage.getItem('fire_dismissed_div_tips');
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function dismissTip(tipId) {
    const dismissed = getDismissedTips();
    if (!dismissed.includes(tipId)) {
        dismissed.push(tipId);
        localStorage.setItem(
            'fire_dismissed_div_tips',
            JSON.stringify(dismissed),
        );
    }
    renderDiversificationSuggestions();
}

function clearAllDismissedTips() {
    localStorage.removeItem('fire_dismissed_div_tips');
    renderDiversificationSuggestions();
}

function renderDiversificationSuggestions(
    totalPortfolioValue = state.importedPositions.reduce(
        (sum, pos) => sum + (pos.value || 0),
        0,
    ),
) {
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

    const annualExpenses = getAnnualExpensesTotal();
    const monthlyExpenses = annualExpenses / 12;
    const cryptoValue = (state.customAccounts || [])
        .filter((a) => a.type === 'Crypto')
        .reduce((sum, a) => sum + (a.value || 0), 0);
    const now = Date.now();
    const cdsSoon = (state.cds || []).filter((cd) => {
        const days = (new Date(cd.maturity).getTime() - now) / 86400000;
        return days >= 0 && days <= 60;
    });
    const ctx = {
        nw,
        totalPortfolioValue,
        cashPct,
        eqPct,
        cdsPct,
        rePct,
        annualExpenses,
        monthlyExpenses,
        cashMonths:
            monthlyExpenses > 0 ? getAggregateCash() / monthlyExpenses : 0,
        grossIncome: getBannerIncome().gross,
        cdsSoon,
        swr: state.projectionSettings?.swr || 0,
        cryptoPct: (cryptoValue / nw) * 100,
    };
    const dismissed = getDismissedTips();
    const activeTips = DIVERSIFICATION_TIPS.filter((tip) => {
        if (dismissed.includes(tip.id)) return false;
        return tip.check(ctx);
    });

    if (activeTips.length === 0 && dismissed.length === 0) {
        block.innerHTML = `<div class="divs-empty">
            <svg viewBox="0 0 24 24" style="width:32px;height:32px;margin-bottom:8px;opacity:0.5;"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            <div style="font-weight:500;">All balanced! 🎉</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Your portfolio diversification looks good.</div>
        </div>`;
        return;
    }

    let html = '<div class="divs-bar">';
    html += '<div class="divs-bar-title">💡 Portfolio Insights</div>';
    if (dismissed.length > 0) {
        html += `<button class="divs-clear-dismissed" onclick="clearAllDismissedTips()">Restore dismissed (${dismissed.length})</button>`;
    }
    html += '</div>';

    html += '<div class="divs-tiles">';
    activeTips.forEach((tip) => {
        const msg = tip.message(ctx);
        const severity =
            typeof tip.severity === 'function'
                ? tip.severity(ctx)
                : tip.severity;
        const severityClass = severity === 'warning' ? 'divs-tile-warning' : '';
        html += `
            <div class="divs-tile ${severityClass}" data-tip-id="${tip.id}">
                <div class="divs-tile-header">
                    <span class="divs-tile-icon">${tip.icon}</span>
                    <span class="divs-tile-title">${tip.title}</span>
                    <button class="divs-tile-dismiss" onclick="dismissTip('${tip.id}')" aria-label="Dismiss">
                        <svg viewBox="0 0 24 24" style="width:16px;height:16px;"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                </div>
                <div class="divs-tile-message">${msg}</div>
                <div class="divs-tile-links">
                    ${tip.links.map((link) => `<a href="${link.url}" target="_blank" rel="noopener" class="divs-tile-link">${link.label} ↗</a>`).join('')}
                </div>
            </div>
        `;
    });
    html += '</div>';

    block.innerHTML = html;
}

// Income Sources / Monthly Expenses collapse toggle (mobile only — see
// .cf-toggle-btn / .cf-collapsed in components.css). Delegated so it keeps
// working regardless of how many times the surrounding cards re-render;
// the toggled elements themselves are never rebuilt by renderMonthlyCashFlow
// (which only mutates existing spans' textContent), so the expanded/
// collapsed state naturally survives data refreshes without extra
// bookkeeping.
function initCashFlowToggles() {
    document
        .querySelectorAll('.cf-toggle-btn[data-cf-toggle]')
        .forEach((btn) => {
            btn.addEventListener('click', () => {
                const list = document.getElementById(btn.dataset.cfToggle);
                if (!list) return;
                const collapsed = list.classList.toggle('cf-collapsed');
                btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            });
        });
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
    // Crypto staking/lending income — same pattern as CD interest, but only
    // counted when the account actually has a staking rate set (apy > 0).
    // Accounts with no rate provided contribute $0, exactly as if staking
    // weren't a modeled income source for them.
    const stakingMonthly = (state.customAccounts || []).reduce(
        (sum, acc) =>
            acc.type === 'Crypto' && (acc.apy || 0) > 0
                ? sum + ((acc.value || 0) * (acc.apy / 100)) / 12
                : sum,
        0,
    );

    const totalIncome =
        monthlyGross + sideGigMonthly + cdMonthly + stakingMonthly;

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
    set('cf-crypto-staking', formatCurrency(stakingMonthly));
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
