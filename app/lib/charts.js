/* ==========================================================================
   charts.js — Chart rendering functions (Chart.js)
   All functions reference global `state` and chart instance vars from app.js.
   ========================================================================== */

// Allocation slice definitions (colors + labels) — used by renderAssetAllocationChart
// and applyAllocationFilter. Defined here so they travel with their render logic.
const ALLOC_SLICE_MAP = {
    Cash: { color: '#10b981', label: 'Cash / SPAXX' },
    CDs: { color: '#f59e0b', label: 'CDs & Fixed' },
    Equities: { color: '#8b5cf6', label: 'Equities' },
    RealEstate: { color: '#06b6d4', label: 'Real Estate' },
    Vehicles: { color: '#f97316', label: 'Vehicles' },
    Other: { color: '#3b82f6', label: 'Other Assets' },
};
const ALLOC_GREY = 'rgba(120,120,140,0.25)';
const ALLOC_CATEGORY_KEYS = ['Cash', 'CDs', 'Equities', 'Other'];

// CD Ladder chart instance — lives here because it is only used by renderCDLadderChart.
var cdLadderChart = null;

/* --------------------------------------------------------------------------
   CD Ladder Visualizer
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   Projection Chart Helpers
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   Asset Allocation Doughnut Chart
   -------------------------------------------------------------------------- */

function renderAssetAllocationChart() {
    const ctx = document.getElementById('chart-asset-allocation');
    if (!ctx) return;

    const cash = getAggregateCash();
    const cds = getAggregateCDs();
    const equities = getAggregateEquities();
    const re = getAggregateRealEstate();
    const veh = getAggregateVehicles();
    const other = getAggregateOtherAssets() + getSideGigYTDNet();
    const total = cash + cds + equities + re + veh + other;

    if (total === 0) {
        if (assetAllocationChart) {
            assetAllocationChart.destroy();
            assetAllocationChart = null;
        }
        return;
    }

    if (assetAllocationChart) {
        assetAllocationChart.destroy();
    }

    const pct = (v) =>
        total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0%';

    const slices = [
        { key: 'Cash', val: cash, label: 'Cash / SPAXX', color: '#10b981' },
        { key: 'CDs', val: cds, label: 'CDs & Fixed', color: '#f59e0b' },
        { key: 'Equities', val: equities, label: 'Equities', color: '#8b5cf6' },
        { key: 'RealEstate', val: re, label: 'Real Estate', color: '#06b6d4' },
        { key: 'Vehicles', val: veh, label: 'Vehicles', color: '#f97316' },
        { key: 'Other', val: other, label: 'Other Assets', color: '#3b82f6' },
    ].filter((s) => s.val > 0);

    const categoryKeys = slices.map((s) => s.key);

    assetAllocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: slices.map((s) => `${s.label}  ${pct(s.val)}`),
            datasets: [
                {
                    data: slices.map((s) => s.val),
                    backgroundColor: slices.map((s) => s.color),
                    borderWidth: 2,
                    borderColor: '#151c2c',
                    hoverBorderColor: '#ffffff',
                    hoverBorderWidth: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#9ca3af',
                        font: { size: 11, family: 'Inter' },
                        padding: 10,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            ` ${formatCurrency(ctx.raw)} (${pct(ctx.raw)})`,
                    },
                },
            },
            cutout: '68%',
            onClick: (evt, activeElements) => {
                if (activeElements.length === 0) {
                    activeAllocationFilter = null;
                    applyAllocationFilter(null);
                    return;
                }
                const idx = activeElements[0].index;
                const clickedKey = categoryKeys[idx];
                if (activeAllocationFilter === clickedKey) {
                    activeAllocationFilter = null;
                    applyAllocationFilter(null);
                } else {
                    activeAllocationFilter = clickedKey;
                    applyAllocationFilter(clickedKey);
                }
            },
        },
    });
}

function applyAllocationFilter(categoryKey) {
    const rows = document.querySelectorAll(
        '#table-dashboard-positions .position-row',
    );
    rows.forEach((row) => {
        if (categoryKey === null) {
            row.classList.remove('p-grayed-out');
            return;
        }
        const sym = row.dataset.symbol || '';
        const desc = (
            row.querySelector('td:nth-child(2)')?.textContent || ''
        ).toUpperCase();

        let match = false;
        if (categoryKey === 'Equities') {
            match =
                !sym.includes('SPAXX') &&
                !sym.includes('FDRXX') &&
                !desc.includes('MONEY MARKET');
        } else if (categoryKey === 'Cash') {
            match =
                sym.includes('SPAXX') ||
                sym.includes('FDRXX') ||
                desc.includes('MONEY MARKET');
        } else if (
            categoryKey === 'CDs' ||
            categoryKey === 'Other' ||
            categoryKey === 'RealEstate' ||
            categoryKey === 'Vehicles'
        ) {
            match = true;
        }

        if (match) {
            row.classList.remove('p-grayed-out');
        } else {
            row.classList.add('p-grayed-out');
        }
    });

    if (assetAllocationChart) {
        const dataset = assetAllocationChart.data.datasets[0];
        const labels = assetAllocationChart.data.labels || [];
        const selectedIdx =
            categoryKey !== null
                ? labels.findIndex((l) => {
                      const key = Object.keys(ALLOC_SLICE_MAP).find(
                          (k) =>
                              ALLOC_SLICE_MAP[k].label ===
                              l.split('  ')[0].trim(),
                      );
                      return key === categoryKey;
                  })
                : -1;
        const origColors = dataset.data.map((_, i) => {
            const lbl = (labels[i] || '').split('  ')[0].trim();
            const key = Object.keys(ALLOC_SLICE_MAP).find(
                (k) => ALLOC_SLICE_MAP[k].label === lbl,
            );
            return key ? ALLOC_SLICE_MAP[key].color : '#3b82f6';
        });
        dataset.backgroundColor = origColors.map((c, i) =>
            categoryKey === null || i === selectedIdx ? c : ALLOC_GREY,
        );
        dataset.borderColor = origColors.map((c, i) =>
            categoryKey === null || i === selectedIdx
                ? '#151c2c'
                : 'transparent',
        );
        assetAllocationChart.update('none');
    }
}
