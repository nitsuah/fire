/* ==========================================================================
   tables/liquid.js — Cash, savings, and CD liquid panel renderer
   ========================================================================== */

function renderDashboardLiquidPanel() {
    const panel = document.getElementById('dashboard-liquid-panel');
    if (!panel) return;

    const today = new Date();
    let html = '';

    const cashAccounts = state.customAccounts.filter(
        (a) => a.type === 'Cash' || a.type === 'Savings',
    );
    const mmPositions = state.importedPositions.filter((p) => isSettledCash(p));

    if (cashAccounts.length > 0 || mmPositions.length > 0) {
        html += `<div class="liquid-section-label">Cash &amp; Savings</div>`;
        cashAccounts.forEach((acc) => {
            const apy = Number(acc.apy) || 0;
            // HYSA balances have no end date, so estimate a year of interest
            // at today's balance and rate.
            const annualYield = (Number(acc.value) || 0) * (apy / 100);
            const yieldStr =
                apy > 0
                    ? `<span class="cd-yield-badge" title="Estimated yearly interest at ${apy.toFixed(2)}% APY">+${formatCurrency(annualYield)}<span class="cd-yield-unit">/yr</span></span>`
                    : '';
            html += `<div class="liquid-row">
                <div class="liquid-name">${escHtml(acc.name)} <span class="liquid-type">${escHtml(acc.type)}${apy > 0 ? ` · ${apy.toFixed(2)}% APY` : ''}</span></div>
                <div class="liquid-val">${formatCurrency(acc.value)} ${yieldStr}</div>
            </div>`;
        });
        mmPositions.forEach((pos) => {
            html += `<div class="liquid-row">
                <div class="liquid-name">${escHtml(pos.symbol)} <span class="liquid-type">Money Market</span></div>
                <div class="liquid-val">${formatCurrency(pos.value)}</div>
            </div>`;
        });
    }

    const validCDs = state.cds.reduce((acc, cd) => {
        if (!cd || typeof cd.maturity !== 'string' || !cd.maturity) return acc;
        // Parse date-only strings as local time (not UTC) to avoid midnight/DST shifts
        const matDate = new Date(cd.maturity.replace(/-/g, '/'));
        const principal = parseFloat(cd.principal);
        const rate = parseFloat(cd.rate);
        if (
            !isNaN(matDate.getTime()) &&
            Number.isFinite(principal) &&
            Number.isFinite(rate)
        )
            acc.push({ cd, matDate, principal, rate });
        return acc;
    }, []);
    if (validCDs.length > 0) {
        html += `<div class="liquid-section-label mt-2">Certificates of Deposit</div>`;
        validCDs.forEach(({ cd, matDate, principal, rate }) => {
            const daysLeft = Math.ceil((matDate - today) / 86400000);
            const isMatured = daysLeft < 0;
            const isSoon = !isMatured && daysLeft <= 30;
            const annualYield = principal * (rate / 100);
            const statusColor = isMatured
                ? 'var(--color-danger)'
                : isSoon
                  ? '#f59e0b'
                  : 'rgba(255,255,255,0.4)';
            const statusText = isMatured
                ? `Matured ${Math.abs(daysLeft)}d ago`
                : isSoon
                  ? `Matures in ${daysLeft}d`
                  : `${daysLeft}d left`;
            html += `<div class="liquid-row">
                <div class="liquid-name">
                    ${escHtml(cd.bank)} <span class="liquid-type">CD · ${rate.toFixed(2)}%</span>
                    <span class="liquid-maturity" style="color:${statusColor};">${statusText}</span>
                </div>
                <div class="liquid-val">
                    ${formatCurrency(principal)}
                    ${isMatured ? '' : `<span class="cd-yield-badge">+${formatCurrency(annualYield)}<span class="cd-yield-unit">/yr</span></span>`}
                </div>
            </div>`;
        });
    }

    if (!html) {
        panel.innerHTML = `<p class="text-muted text-center" style="padding:12px 0;">No cash accounts or CDs recorded yet.</p>`;
        return;
    }
    // Cash & CD interest only — crypto staking isn't listed in this panel.
    const interest = getEstimatedAnnualInterest();
    const cashInterest = interest.savings + interest.cds;
    if (cashInterest > 0) {
        html += `<div class="liquid-row liquid-total-row">
            <div class="liquid-name">Est. yearly interest</div>
            <div class="liquid-val"><span class="cd-yield-badge">+${formatCurrency(cashInterest)}<span class="cd-yield-unit">/yr</span></span></div>
        </div>`;
    }
    panel.innerHTML = html;
}

// Dashboard "Other Assets" card: everything in net worth that isn't cash,
// CDs or equities — precious metals, real estate equity, vehicle equity and
// any other custom holdings.
function renderDashboardOtherAssetsPanel() {
    const panel = document.getElementById('dashboard-other-assets-panel');
    if (!panel) return;

    const row = (name, sub, value, extra = '') =>
        `<div class="liquid-row">
            <div class="liquid-name"><span>${name}</span> <span class="liquid-type">${sub}</span></div>
            <div class="liquid-val">${formatCurrency(value)}${extra}</div>
        </div>`;
    const sections = [];

    const metals = state.customAccounts.filter((a) => a.type === 'Metal');
    if (metals.length) {
        let html = `<div class="liquid-section-label">Precious Metals</div>`;
        metals.forEach((acc) => {
            const kind = acc.metalType === 'silver' ? 'silver' : 'gold';
            const label = kind === 'gold' ? 'Gold' : 'Silver';
            const oz = Number(acc.weightOz) || 0;
            const spot = Number(acc.spotPricePerOz) || 0;
            const pct = Number(acc.payoutPct) || 0;
            const sub = spot
                ? `${label} · ${oz}oz × ${formatCurrency(spot)} spot × ${Math.round(pct * 100)}%`
                : `${label} · ${oz}oz`;
            html += row(
                `<span class="metal-dot metal-dot-${kind}"></span>${escHtml(acc.name)}`,
                escHtml(sub),
                acc.value || 0,
                acc.valueLastRefreshed
                    ? `<span class="liquid-type" title="${escHtml(acc.valueLastRefreshed)}">live</span>`
                    : '',
            );
        });
        sections.push(html);
    }

    const realEstate = state.realEstate || [];
    if (realEstate.length) {
        let html = `<div class="liquid-section-label">Real Estate (equity)</div>`;
        realEstate.forEach((re) => {
            const equity = Math.max(
                0,
                (re.marketValue || 0) - (re.mortgageBalance || 0),
            );
            html += row(
                escHtml(re.address || re.type || 'Property'),
                `${escHtml(re.type || '')} · ${formatCurrency(re.marketValue || 0)} value`,
                equity,
            );
        });
        sections.push(html);
    }

    const vehicles = state.vehicles || [];
    if (vehicles.length) {
        let html = `<div class="liquid-section-label">Vehicles (equity)</div>`;
        vehicles.forEach((v) => {
            const equity = Math.max(
                0,
                (v.currentValue || 0) - (v.loanBalance || 0),
            );
            const name =
                [v.year, v.make, v.model].filter(Boolean).join(' ') ||
                'Vehicle';
            const sub =
                (v.loanBalance || 0) > 0
                    ? `${formatCurrency(v.currentValue || 0)} − ${formatCurrency(v.loanBalance)} loan`
                    : escHtml(v.condition || '');
            html += row(escHtml(name), sub, equity);
        });
        sections.push(html);
    }

    const misc = state.customAccounts.filter(
        (a) =>
            !['Cash', 'Savings', 'Brokerage', 'Crypto', 'Metal'].includes(
                a.type,
            ),
    );
    if (misc.length) {
        let html = `<div class="liquid-section-label">Other Valuables</div>`;
        misc.forEach((acc) => {
            html += row(escHtml(acc.name), escHtml(acc.type), acc.value || 0);
        });
        sections.push(html);
    }

    if (!sections.length) {
        panel.innerHTML = `<p class="text-muted text-center" style="padding:12px 0;">No other assets recorded yet.</p>`;
        return;
    }
    const total =
        metals.reduce((s, a) => s + (a.value || 0), 0) +
        getAggregateRealEstate() +
        getAggregateVehicles() +
        misc.reduce((s, a) => s + (a.value || 0), 0);
    // Sections sit side by side when the card runs full width (wide
    // screens) and stack in the narrower column layouts.
    panel.innerHTML =
        `<div class="other-assets-grid">${sections
            .map((s) => `<div class="other-assets-section">${s}</div>`)
            .join('')}</div>` +
        `<div class="liquid-row liquid-total-row">
            <div class="liquid-name">Total other assets</div>
            <div class="liquid-val">${formatCurrency(total)}</div>
        </div>`;
}
