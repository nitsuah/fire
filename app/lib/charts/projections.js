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

/* ---------------------------------------------------------------------------
   Chaos-mode chart helpers (events come from lib/chaos-events.js via
   buildProjectionData → sliceProjectionData).
   --------------------------------------------------------------------------- */

// Marker for each life event, placed at its fractional year (month/12) on
// the net worth line. ▲ green = increase, ▼ red = decrease; the ring is the
// event category's color.
function buildChaosAnnotations(chaos, nwData) {
    const annotations = {};
    if (!chaos || !nwData || !nwData.length) return annotations;
    const cats = window.FireChaos.CATEGORIES;
    chaos.events.forEach((ev) => {
        const x = Math.min(ev.yearIndex + ev.month / 12, nwData.length - 1);
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, nwData.length - 1);
        const y = nwData[i0] + (nwData[i1] - nwData[i0]) * (x - i0);
        const up = (chaos.impacts[ev.id]?.total ?? 0) >= 0;
        annotations[`chaos_${ev.id}`] = {
            type: 'point',
            xValue: x,
            yValue: y,
            pointStyle: 'triangle',
            rotation: up ? 0 : 180,
            radius: 6,
            backgroundColor: up ? '#10b981' : '#f43f5e',
            borderColor: cats[ev.category]?.color || '#ffffff',
            borderWidth: 2,
        };
    });
    return annotations;
}

// Extra tooltip lines for the hovered/tapped index: every event whose
// marker is nearest that point, with its outcome and dollar impact.
function chaosTooltipLines(chaos, idx) {
    if (!chaos) return [];
    const evs = window.FireChaos.eventsNearIndex(chaos.events, idx);
    if (!evs.length) return [];
    const lines = ['', '🌪️ Life events:'];
    evs.forEach((ev) => {
        lines.push(
            `${ev.icon} ${ev.label} (${window.FireChaos.whenLabel(ev)})`,
        );
        if (ev.cause) lines.push(`    after ${ev.cause}`);
        lines.push(`    ${ev.outcome.label}`);
        lines.push(
            `    ${window.FireChaos.describeImpact(ev, chaos.impacts[ev.id])}`,
        );
    });
    return lines;
}

function noChaosDataset(data, borderWidth) {
    return {
        label: 'Without chaos',
        data: data.noChaosData,
        borderColor: 'rgba(156,163,175,0.55)',
        borderDash: [4, 4],
        borderWidth,
        fill: false,
        tension: 0.35,
        pointRadius: 0,
        order: 7,
    };
}

// Chip list of the events inside the current window, under each chart.
// Mirrors the tooltips for touch users and anyone scanning the timeline.
function renderChaosTimeline(containerId, data, { compact = false } = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const chaos = data.chaos;
    if (!chaos) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    const FC = window.FireChaos;
    const cats = FC.CATEGORIES;
    const last = data.nwData.length - 1;
    const delta =
        last >= 0 && data.noChaosData
            ? data.nwData[last] - data.noChaosData[last]
            : 0;
    const down = chaos.events.filter(
        (ev) => (chaos.impacts[ev.id]?.total ?? 0) < 0,
    ).length;
    const up = chaos.events.length - down;
    const n = chaos.events.length;
    const summaryInner = `<span>🌪️ <strong>${n}</strong> life event${n === 1 ? '' : 's'} in view</span><span class="chaos-count-neg">▼ ${down}</span><span class="chaos-count-pos">▲ ${up}</span><span>Net effect by ${escHtml(data.labels[last] || '')}: <strong class="${delta < 0 ? 'text-coral' : 'text-emerald'}">${FC.fmtMoney(delta)}</strong></span>`;
    const chips = chaos.events
        .map((ev) => {
            const imp = chaos.impacts[ev.id];
            const isUp = (imp?.total ?? 0) >= 0;
            const cat = cats[ev.category] || {
                label: ev.category,
                color: '#9ca3af',
            };
            return `<li class="chaos-chip ${isUp ? 'is-up' : 'is-down'}" data-cat-color="${cat.color}">
                <span class="chaos-chip-icon" aria-hidden="true">${ev.icon}</span>
                <span class="chaos-chip-body">
                    <span class="chaos-chip-title">${escHtml(ev.label)} <span class="chaos-chip-term">${ev.term === 'long' ? 'long-term' : 'one-time'}</span></span>
                    <span class="chaos-chip-meta">${escHtml(FC.whenLabel(ev))} · ${escHtml(cat.label)} · ${escHtml(ev.outcome.label)}</span>
                    ${ev.cause ? `<span class="chaos-chip-cause">after ${escHtml(ev.cause)}</span>` : ''}
                    <span class="chaos-chip-impact">${isUp ? '▲' : '▼'} ${escHtml(FC.describeImpact(ev, imp))}</span>
                </span>
            </li>`;
        })
        .join('');
    const list = n
        ? `<ul class="chaos-chip-list">${chips}</ul>`
        : '<p class="text-muted chaos-empty">No life events in this window — try a longer range or reroll.</p>';
    el.hidden = false;
    const html = compact
        ? `<details class="chaos-details"><summary class="chaos-summary">${summaryInner}</summary>${list}</details>`
        : `<div class="chaos-summary">${summaryInner}</div>${list}`;
    el.innerHTML = html;
    // CSP: category colors go through the CSSOM, not style="" in markup.
    el.querySelectorAll('[data-cat-color]').forEach((li) =>
        li.style.setProperty('--chaos-cat', li.dataset.catColor),
    );
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
    if (data.chaos) datasets.push(noChaosDataset(data, 1.5));

    const annotations = {
        ...buildProjectionAnnotations(
            retirementLineIndex,
            cdEvents,
            nwData,
            data.fireNumber,
        ),
        ...buildChaosAnnotations(data.chaos, nwData),
    };

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
                        afterBody: (items) =>
                            chaosTooltipLines(data.chaos, items[0]?.dataIndex),
                    },
                },
                annotation:
                    Object.keys(annotations).length > 0
                        ? { annotations }
                        : undefined,
            },
        },
    });
    renderChaosTimeline('proj-chaos-timeline', data);

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
    const sliced = sliceProjectionData(raw, dashProjWindow);
    const { labels, nwData, fireLine, retirementLineIndex, cdEvents } = sliced;

    const annualExpenses = getAnnualExpensesTotal();
    const swr = state.projectionSettings.swr / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;
    const annotations = {
        ...buildProjectionAnnotations(
            retirementLineIndex,
            cdEvents,
            nwData,
            fireNumber,
        ),
        ...buildChaosAnnotations(sliced.chaos, nwData),
    };
    const datasets = [
        {
            label: 'Net Worth',
            data: nwData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.08)',
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 12,
        },
        {
            label: 'FIRE Target',
            data: fireLine,
            borderColor: 'rgba(244,63,94,0.7)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 12,
        },
    ];
    if (sliced.chaos) datasets.push(noChaosDataset(sliced, 1));

    dashboardProjectionsChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // Same interaction mode as the full Projections page chart so tapping
            // or hovering anywhere along the x-axis surfaces the point tooltip —
            // this had drifted out of sync (default nearest+intersect requires
            // hitting the exact 0-radius point, which is effectively impossible).
            interaction: { mode: 'index', intersect: false },
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
                        afterBody: (items) =>
                            chaosTooltipLines(
                                sliced.chaos,
                                items[0]?.dataIndex,
                            ),
                    },
                },
                annotation:
                    Object.keys(annotations).length > 0
                        ? { annotations }
                        : undefined,
            },
        },
    });
    renderChaosTimeline('dash-chaos-timeline', sliced, { compact: true });
}
