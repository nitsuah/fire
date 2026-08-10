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
            const apyStr =
                acc.apy > 0
                    ? `<span class="liquid-rate">${Number(acc.apy).toFixed(2)}% APY</span>`
                    : '';
            html += `<div class="liquid-row">
                <div class="liquid-name">${escHtml(acc.name)} <span class="liquid-type">${escHtml(acc.type)}</span></div>
                <div class="liquid-val">${formatCurrency(acc.value)} ${apyStr}</div>
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
