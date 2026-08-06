/* ==========================================================================
   charts/projections.js — Net worth projection chart renderers
   ========================================================================== */

function buildProjectionAnnotations(
    retirementLineIndex,
    cdEvents,
    nwData,
    fireNumber,
) {
    const annotations = {};
    if (retirementLineIndex >= 0) {
        annotations['retireLine'] = {
            type: 'line',
            xMin: retirementLineIndex,
            xMax: retirementLineIndex,
            borderColor: 'rgba(245,158,11,0.85)',
            borderWidth: 2,
            borderDash: [6, 4],
            label: {
                display: true,
                content: '🎯 Retire',
                position: 'start',
                color: '#f59e0b',
                font: { size: 10, family: 'Outfit' },
                backgroundColor: 'rgba(245,158,11,0.12)',
                padding: 4,
                yAdjust: -10,
            },
        };
    }

    if (nwData && fireNumber > 0) {
        const milestones = [
            {
                key: 'lean',
                label: '75% Lean',
                pct: 0.75,
                color: '#f59e0b',
                yAdj: 18,
            },
            {
                key: 'fire',
                label: '100% FIRE',
                pct: 1.0,
                color: '#f43f5e',
                yAdj: 0,
            },
            {
                key: 'fat',
                label: '125% Fat',
                pct: 1.25,
                color: '#8b5cf6',
                yAdj: -18,
            },
        ];
        milestones.forEach((m) => {
            const target = fireNumber * m.pct;
            const idx = nwData.findIndex((v) => v >= target);
            if (idx >= 0) {
                annotations[`cross_${m.key}`] = {
                    type: 'point',
                    xValue: idx,
                    yValue: nwData[idx],
                    backgroundColor: m.color,
                    radius: 7,
                    borderColor: 'rgba(255,255,255,0.9)',
                    borderWidth: 2,
                    label: {
                        display: true,
                        content: m.label,
                        color: m.color,
                        backgroundColor: 'rgba(8,11,17,0.88)',
                        font: { size: 10, family: 'Outfit', weight: '700' },
                        padding: { x: 6, y: 3 },
                        borderRadius: 4,
                        position: 'top',
                        yAdjust: m.yAdj - 14,
                    },
                };
            }
        });
    }
    cdEvents.forEach((ev, i) => {
        annotations[`cd_${i}`] = {
            type: 'line',
            xMin: ev.yearIndex,
            xMax: ev.yearIndex,
            borderColor: 'rgba(16,185,129,0.6)',
            borderWidth: 1,
            borderDash: [3, 4],
            label: {
                display: true,
                content: `💰 ${ev.label}`,
                position: 'end',
                color: '#10b981',
                font: { size: 9, family: 'Inter' },
                backgroundColor: 'rgba(16,185,129,0.1)',
                padding: 3,
                yAdjust: 10 + i * 16,
            },
        };
    });
    return annotations;
}

function renderProjectionsChart(data) {
    const ctx = document.getElementById('chart-networth-projections');
    if (!ctx) return;
    if (projectionsChart) projectionsChart.destroy();

    const {
        labels,
        nwData,
        fireLine,
        leanFireLine,
        fatFireLine,
        coastFireLine,
        bullData,
        bearData,
        benchData,
        retirementLineIndex,
        cdEvents,
    } = data;
    const t = projLineToggles;

    const datasets = [];

    if (t.scenarios) {
        datasets.push({
            label: 'Bear Scenario (-2%)',
            data: bearData || [],
            borderColor: 'rgba(244,63,94,0.45)',
            borderDash: [2, 4],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            order: 0,
        });
        datasets.push({
            label: 'Bull Scenario (+2%)',
            data: bullData || [],
            borderColor: 'rgba(16,185,129,0.45)',
            borderDash: [2, 4],
            borderWidth: 1.5,
            backgroundColor: 'rgba(120,120,180,0.07)',
            fill: '-1',
            pointRadius: 0,
            order: 0,
        });
    }

    datasets.push({
        label: 'Projected Net Worth',
        data: nwData,
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139,92,246,0.08)',
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        order: 1,
        hidden: !t.nw,
    });
    datasets.push({
        label: 'FIRE Target (100%)',
        data: fireLine,
        borderColor: '#f43f5e',
        borderDash: [5, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        order: 2,
        hidden: !t.fire,
    });
    datasets.push({
        label: 'Lean FIRE (75%)',
        data: leanFireLine,
        borderColor: 'rgba(244,63,94,0.4)',
        borderDash: [3, 5],
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        order: 3,
        hidden: !t.lean,
    });
    datasets.push({
        label: 'Fat FIRE (125%)',
        data: fatFireLine,
        borderColor: 'rgba(139,92,246,0.4)',
        borderDash: [3, 5],
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        order: 4,
        hidden: !t.fat,
    });
    datasets.push({
        label: 'Coast FIRE',
        data: coastFireLine,
        borderColor: 'rgba(16,185,129,0.5)',
        borderDash: [4, 4],
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        order: 5,
        hidden: !t.coast,
    });
    datasets.push({
        label: 'US Median Peer',
        data: benchData || [],
        borderColor: '#f97316',
        borderDash: [2, 3],
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        order: 6,
        hidden: !t.benchmark,
    });

    const annotations = buildProjectionAnnotations(
        retirementLineIndex,
        cdEvents,
        nwData,
        data.fireNumber,
    );

    projectionsChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#9ca3af',
                        callback: (v) =>
                            '$' +
                            (v >= 1000000
                                ? (v / 1000000).toFixed(1) + 'M'
                                : v >= 1000
                                  ? (v / 1000).toFixed(0) + 'K'
                                  : v),
                    },
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#9ca3af',
                        maxTicksLimit: 12,
                        maxRotation: 0,
                    },
                },
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#f3f4f6',
                        font: { family: 'Outfit', size: 11 },
                        boxWidth: 20,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                    },
                },
                annotation:
                    Object.keys(annotations).length > 0
                        ? { annotations }
                        : undefined,
            },
        },
    });

    Object.keys(t).forEach((key) => {
        const btn = document.querySelector(
            `.chart-toggle-btn[data-line="${key}"]`,
        );
        if (btn) btn.classList.toggle('active', t[key]);
    });
}

function renderDashboardProjectionsChart() {
    const ctx = document.getElementById('chart-dashboard-projections');
    if (!ctx) return;

    if (dashboardProjectionsChart) {
        dashboardProjectionsChart.destroy();
    }

    const raw = buildProjectionData();
    const { labels, nwData, fireLine, retirementLineIndex, cdEvents } =
        sliceProjectionData(raw, dashProjWindow);

    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;
    const annotations = buildProjectionAnnotations(
        retirementLineIndex,
        cdEvents,
        nwData,
        fireNumber,
    );

    dashboardProjectionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Net Worth',
                    data: nwData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                },
                {
                    label: 'FIRE Target',
                    data: fireLine,
                    borderColor: 'rgba(244,63,94,0.7)',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#6b7280',
                        font: { size: 10 },
                        maxTicksLimit: 4,
                        callback: (v) =>
                            '$' +
                            (v >= 1000000
                                ? (v / 1000000).toFixed(1) + 'M'
                                : v >= 1000
                                  ? (v / 1000).toFixed(0) + 'K'
                                  : v),
                    },
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#6b7280',
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        font: { size: 10 },
                    },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                    },
                },
                annotation:
                    Object.keys(annotations).length > 0
                        ? { annotations }
                        : undefined,
            },
        },
    });
}
