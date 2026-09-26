/* ==========================================================================
   charts/net-worth-history.js — Actual net worth over time
   Plots the server's daily snapshots (state.netWorthHistory, recorded by
   app/lib/net-worth-history.js) with today's point replaced by the live
   net worth, plus change-over-period stats.
   Depends on globals: state, Chart, getAggregateNetWorth, formatCurrency
   ========================================================================== */

var netWorthHistoryChart = null;
var nwHistoryRange = 'all'; // '1m' | '3m' | '1y' | 'all'

function localDayKey(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

function getNetWorthHistoryPoints() {
    const today = localDayKey(new Date());
    const points = (state.netWorthHistory || [])
        .filter(
            (p) => p && typeof p.date === 'string' && Number.isFinite(p.total),
        )
        // Today's (and any "future" day's — the server may run on UTC and
        // already be on tomorrow's date) snapshot is superseded by the live
        // value appended below.
        .filter((p) => p.date < today)
        .map((p) => ({ date: p.date, total: p.total }));
    points.push({ date: today, total: getAggregateNetWorth() });
    points.sort((a, b) => (a.date < b.date ? -1 : 1));
    return points;
}

function nwRangeStart(range) {
    const d = new Date();
    if (range === '1m') d.setMonth(d.getMonth() - 1);
    else if (range === '3m') d.setMonth(d.getMonth() - 3);
    else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
    else return null;
    return localDayKey(d);
}

window.setNwHistoryRange = function (range) {
    nwHistoryRange = range;
    document
        .querySelectorAll('#nw-history-range .period-btn')
        .forEach((b) =>
            b.classList.toggle('active', b.dataset.range === range),
        );
    renderNetWorthHistoryChart();
};

function renderNetWorthHistoryChart() {
    const canvas = document.getElementById('chart-nw-history');
    const statsEl = document.getElementById('nw-history-stats');
    if (!canvas || typeof Chart === 'undefined') return;

    const all = getNetWorthHistoryPoints();
    const start = nwRangeStart(nwHistoryRange);
    const points = start ? all.filter((p) => p.date >= start) : all;

    if (statsEl) {
        const first = points[0];
        const last = points[points.length - 1];
        if (all.length < 2) {
            statsEl.innerHTML = `<span class="text-muted">Tracking started ${escHtml(all[0].date)} — a snapshot is recorded daily, so the trend fills in over time.</span>`;
        } else {
            const delta = last.total - first.total;
            const pct = first.total ? (delta / first.total) * 100 : 0;
            const cls = delta >= 0 ? 'text-emerald' : 'text-coral';
            statsEl.innerHTML = `<span class="${cls} font-bold">${delta >= 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span> <span class="text-muted">since ${escHtml(first.date)}</span>`;
        }
    }

    if (netWorthHistoryChart) {
        netWorthHistoryChart.destroy();
        netWorthHistoryChart = null;
    }
    netWorthHistoryChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: points.map((p) => p.date),
            datasets: [
                {
                    label: 'Net worth',
                    data: points.map((p) => p.total),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    fill: true,
                    tension: 0.25,
                    // A single point would be invisible without a marker.
                    pointRadius: points.length < 3 ? 4 : 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${formatCurrency(c.raw)}`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3af', maxTicksLimit: 6 },
                    grid: { display: false },
                },
                y: {
                    ticks: {
                        color: '#9ca3af',
                        callback: (v) =>
                            Math.abs(v) >= 1e6
                                ? `$${(v / 1e6).toFixed(2)}M`
                                : `$${Math.round(v / 1000)}k`,
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });
}
