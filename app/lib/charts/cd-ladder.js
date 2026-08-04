/* ==========================================================================
   charts/cd-ladder.js — CD Ladder bar chart renderer
   ========================================================================== */

var cdLadderChart = null;

function renderCDLadderChart() {
    const ctx = document.getElementById('chart-cd-ladder');
    if (!ctx) return;

    if (cdLadderChart) {
        cdLadderChart.destroy();
        cdLadderChart = null;
    }

    const today = new Date();
    const cds = (state.cds || []).filter(
        (cd) => cd.principal > 0 && cd.maturity,
    );

    if (cds.length === 0) {
        ctx.parentElement.innerHTML =
            '<p class="text-muted text-center" style="padding:20px 0;font-size:12px;">Add CDs to see the ladder visualization.</p>';
        return;
    }

    const sorted = [...cds].sort(
        (a, b) => new Date(a.maturity) - new Date(b.maturity),
    );

    const labels = sorted.map((cd) => {
        const mat = new Date(cd.maturity);
        return `${cd.bank} (${mat.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })})`;
    });

    const daysLeft = sorted.map((cd) => {
        const d = Math.ceil((new Date(cd.maturity) - today) / 86400000);
        return Math.max(d, 0);
    });

    const colors = sorted.map((cd) => {
        const d = Math.ceil((new Date(cd.maturity) - today) / 86400000);
        if (d < 0) return 'rgba(244,63,94,0.75)';
        if (d <= 30) return 'rgba(245,158,11,0.85)';
        if (d <= 90) return 'rgba(251,191,36,0.75)';
        return 'rgba(16,185,129,0.75)';
    });

    const principals = sorted.map((cd) => cd.principal);
    const annualYields = sorted.map((cd) =>
        ((cd.principal || 0) * ((cd.rate || 0) / 100)).toFixed(0),
    );

    cdLadderChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Principal',
                    data: principals,
                    backgroundColor: colors,
                    borderColor: colors.map((c) =>
                        c.replace('0.75', '1').replace('0.85', '1'),
                    ),
                    borderWidth: 1,
                    borderRadius: 4,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const cd = sorted[ctx.dataIndex];
                            const d = daysLeft[ctx.dataIndex];
                            const status = d <= 0 ? 'Matured' : `${d}d left`;
                            return [
                                ` Principal: ${formatCurrency(cd.principal)}`,
                                ` Rate: ${Number(cd.rate).toFixed(2)}%  |  Yield: $${annualYields[ctx.dataIndex]}/yr`,
                                ` Status: ${status}`,
                            ];
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#9ca3af',
                        callback: (v) =>
                            '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v),
                    },
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#d1d5db', font: { size: 11 } },
                },
            },
        },
    });
}
