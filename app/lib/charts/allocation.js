/* ==========================================================================
   charts/allocation.js — Asset allocation doughnut chart
   ========================================================================== */

const ALLOC_SLICE_MAP = {
    Cash: { color: '#10b981', label: 'Cash / SPAXX' },
    CDs: { color: '#f59e0b', label: 'CDs & Fixed' },
    Equities: { color: '#8b5cf6', label: 'Equities' },
    RealEstate: { color: '#06b6d4', label: 'Real Estate' },
    Vehicles: { color: '#f97316', label: 'Vehicles' },
    Other: { color: '#3b82f6', label: 'Other Assets' },
};
const ALLOC_GREY = 'rgba(120,120,140,0.25)';

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
