/* ==========================================================================
   charts/allocation.js — Asset allocation drill-down doughnut chart
   Two levels: an overview (Cash / CDs / Equities / Real Estate / Vehicles /
   Other), and per-category detail (the individual accounts/positions/CDs
   behind that slice) — e.g. Cash -> SPAXX / a savings account, CDs -> each
   bank's CD. Replaces the standalone Quick Stats card: each overview
   slice's own label carries its total, and drilling in shows every
   contributing item, so nothing here duplicates a separate stats list.
   ========================================================================== */

const ALLOC_SLICE_MAP = {
    Cash: { color: '#10b981', label: 'Cash / SPAXX' },
    CDs: { color: '#f59e0b', label: 'CDs & Fixed' },
    Equities: { color: '#8b5cf6', label: 'Equities' },
    RealEstate: { color: '#06b6d4', label: 'Real Estate' },
    Vehicles: { color: '#f97316', label: 'Vehicles' },
    Other: { color: '#3b82f6', label: 'Other Assets' },
};

// Per-category breakdown into individual contributing items, reusing the
// exact same categorization rules as the getAggregate*() sums (app.js) so
// a category's detail total always matches its overview slice.
function getCashDetailItems() {
    const items = [];
    state.importedPositions.forEach((pos) => {
        if (
            pos.symbol.includes('SPAXX') ||
            pos.symbol.includes('FDRXX') ||
            pos.description.includes('MONEY MARKET')
        ) {
            items.push({
                name: pos.symbol,
                sub: pos.account || 'Brokerage',
                value: pos.value || 0,
            });
        }
    });
    state.customAccounts.forEach((acc) => {
        if (acc.type === 'Cash' || acc.type === 'Savings') {
            items.push({
                name: acc.name,
                sub: acc.type,
                value: acc.value || 0,
            });
        }
    });
    return items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
}

function getCDsDetailItems() {
    return state.cds
        .filter((cd) => cd && cd.principal)
        .map((cd) => ({
            name: cd.bank,
            sub: `${Number(cd.rate || 0).toFixed(2)}% APY`,
            value: cd.principal || 0,
        }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value);
}

function getEquitiesDetailItems() {
    const items = [];
    state.importedPositions.forEach((pos) => {
        const isCash =
            pos.symbol.includes('SPAXX') ||
            pos.symbol.includes('FDRXX') ||
            pos.description.includes('MONEY MARKET');
        if (!isCash) {
            items.push({
                name: pos.symbol,
                sub: pos.account || 'Brokerage',
                value: pos.value || 0,
            });
        }
    });
    state.customAccounts.forEach((acc) => {
        if (acc.type === 'Brokerage' || acc.type === 'Crypto') {
            items.push({
                name: acc.name,
                sub: acc.type,
                value: acc.value || 0,
            });
        }
    });
    return items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
}

function getRealEstateDetailItems() {
    return (state.realEstate || [])
        .map((r) => ({
            name: r.address || 'Property',
            sub: 'Equity (market − mortgage)',
            value: Math.max(0, (r.marketValue || 0) - (r.mortgageBalance || 0)),
        }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value);
}

function getVehiclesDetailItems() {
    return (state.vehicles || [])
        .map((v) => ({
            name:
                `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() ||
                'Vehicle',
            sub: 'Equity (value − loan)',
            value: Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)),
        }))
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value);
}

function getOtherDetailItems() {
    const items = [];
    state.customAccounts.forEach((acc) => {
        if (
            acc.type !== 'Cash' &&
            acc.type !== 'Savings' &&
            acc.type !== 'Brokerage' &&
            acc.type !== 'Crypto'
        ) {
            const sub =
                acc.type === 'Metal' && acc.metalType
                    ? `${acc.metalType === 'gold' ? 'Gold' : 'Silver'} · ${acc.weightOz}oz`
                    : acc.type;
            items.push({ name: acc.name, sub, value: acc.value || 0 });
        }
    });
    return items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
}

const ALLOC_DETAIL_FNS = {
    Cash: getCashDetailItems,
    CDs: getCDsDetailItems,
    Equities: getEquitiesDetailItems,
    RealEstate: getRealEstateDetailItems,
    Vehicles: getVehiclesDetailItems,
    Other: getOtherDetailItems,
};

// Lighter/darker shades of the category's own color for each item in its
// detail view, so drilling in still reads as "part of the same slice"
// rather than an unrelated new palette.
function shadeColor(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = num >> 16,
        g = (num >> 8) & 0xff,
        b = num & 0xff;
    const amt = Math.round(2.55 * percent);
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

window.allocDrillUp = function () {
    allocDrillPath = [];
    renderAssetAllocationChart();
};

function allocDrillInto(categoryKey) {
    allocDrillPath = [categoryKey];
    renderAssetAllocationChart();
}

function updateAllocBreadcrumb(categoryKey, total, count) {
    const titleEl = document.getElementById('alloc-breadcrumb-title');
    const subEl = document.getElementById('alloc-breadcrumb-sub');
    const backBtn = document.getElementById('alloc-back-btn');
    if (!titleEl) return;
    if (categoryKey === null) {
        titleEl.textContent = 'Asset Allocation';
        if (subEl) subEl.textContent = '';
        if (backBtn) backBtn.style.display = 'none';
    } else {
        const label = ALLOC_SLICE_MAP[categoryKey]?.label || categoryKey;
        titleEl.textContent = `Asset Allocation — ${label}`;
        if (subEl)
            subEl.textContent = `${count} item${count === 1 ? '' : 's'} · ${formatCurrency(total)} total`;
        if (backBtn) backBtn.style.display = '';
    }
}

function renderAllocDetailList(items, color) {
    const el = document.getElementById('alloc-detail-list');
    if (!el) return;
    if (items.length === 0) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<div class="alloc-detail-list">${items
        .map(
            (item) => `
        <div class="alloc-detail-row">
            <span class="alloc-detail-dot" style="background:${color};"></span>
            <span class="alloc-detail-name">${escHtml(item.name)}<span class="text-muted" style="font-size:11px;display:block;">${escHtml(item.sub)}</span></span>
            <span class="alloc-detail-val">${formatCurrency(item.value)}</span>
        </div>`,
        )
        .join('')}</div>`;
}

function renderAssetAllocationChart() {
    const ctx = document.getElementById('chart-asset-allocation');
    if (!ctx) return;

    if (assetAllocationChart) {
        assetAllocationChart.destroy();
        assetAllocationChart = null;
    }

    const drillKey = allocDrillPath[0] || null;

    if (drillKey && ALLOC_DETAIL_FNS[drillKey]) {
        const items = ALLOC_DETAIL_FNS[drillKey]();
        const baseColor = ALLOC_SLICE_MAP[drillKey].color;
        const total = items.reduce((s, i) => s + i.value, 0);
        updateAllocBreadcrumb(drillKey, total, items.length);

        if (items.length === 0) {
            renderAllocDetailList([], baseColor);
            return;
        }

        const colors = items.map((_, i) =>
            shadeColor(
                baseColor,
                -25 + (i * 50) / Math.max(items.length - 1, 1),
            ),
        );
        const pct = (v) =>
            total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0%';

        assetAllocationChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: items.map((i) => `${i.name}  ${pct(i.value)}`),
                datasets: [
                    {
                        data: items.map((i) => i.value),
                        backgroundColor: colors,
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
                            label: (c) =>
                                ` ${formatCurrency(c.raw)} (${pct(c.raw)})`,
                        },
                    },
                },
                cutout: '68%',
                onClick: (evt, activeElements) => {
                    if (activeElements.length === 0) return;
                    allocDrillUp();
                },
            },
        });
        renderAllocDetailList(items, baseColor);
        return;
    }

    // Top-level overview
    updateAllocBreadcrumb(null);
    renderAllocDetailList([], null);

    const cash = getAggregateCash();
    const cds = getAggregateCDs();
    const equities = getAggregateEquities();
    const re = getAggregateRealEstate();
    const veh = getAggregateVehicles();
    const other = getAggregateOtherAssets();
    const total = cash + cds + equities + re + veh + other;

    if (total === 0) {
        return;
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

    // Keyboard/AT-accessible equivalent of clicking a doughnut slice.
    const listEl = document.getElementById('alloc-detail-list');
    if (listEl) {
        listEl.innerHTML = `<div class="alloc-cat-buttons">${slices
            .map(
                (s) =>
                    `<button type="button" class="alloc-cat-btn" onclick="allocDrillInto('${s.key}')"><span class="alloc-detail-dot" style="background:${s.color};"></span>${s.label} · ${formatCurrency(s.val)}</button>`,
            )
            .join('')}</div>`;
    }

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
                        label: (c) =>
                            ` ${formatCurrency(c.raw)} (${pct(c.raw)}) — click to drill in`,
                    },
                },
            },
            cutout: '68%',
            onClick: (evt, activeElements) => {
                if (activeElements.length === 0) return;
                const idx = activeElements[0].index;
                allocDrillInto(categoryKeys[idx]);
            },
        },
    });
}
