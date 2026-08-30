/* ==========================================================================
   tables/rebalancing.js — Portfolio rebalancing tool
   ========================================================================== */

window.renderRebalancingTool = function () {
    const tbody = document.getElementById('tbody-rebalancing');
    const errEl = document.getElementById('rebalance-error');
    if (!tbody) return;

    // Read target percentages — preserve NaN so non-numeric inputs are caught
    const targets = {
        Equities: parseFloat(
            document.getElementById('rebal-target-equities')?.value ?? '',
        ),
        'Fixed Income': parseFloat(
            document.getElementById('rebal-target-bonds')?.value ?? '',
        ),
        'Real Estate': parseFloat(
            document.getElementById('rebal-target-realestate')?.value ?? '',
        ),
        Cash: parseFloat(
            document.getElementById('rebal-target-cash')?.value ?? '',
        ),
        Crypto: parseFloat(
            document.getElementById('rebal-target-crypto')?.value ?? '',
        ),
    };

    const anyInvalid = Object.values(targets).some(
        (v) => !Number.isFinite(v) || v < 0 || v > 100,
    );
    const totalTarget = Object.values(targets).reduce(
        (s, v) => s + (Number.isFinite(v) ? v : 0),
        0,
    );
    const targetInvalid = anyInvalid || Math.abs(totalTarget - 100) > 0.5;
    if (errEl) {
        if (anyInvalid) {
            errEl.textContent =
                'Each target must be a number between 0 and 100.';
            errEl.style.display = '';
        } else if (targetInvalid) {
            errEl.textContent = `Targets sum to ${totalTarget.toFixed(1)}% — they should add up to 100%.`;
            errEl.style.display = '';
        } else {
            errEl.style.display = 'none';
        }
    }
    if (targetInvalid) return;

    // Compute current holdings per asset class
    const current = {
        Equities: 0,
        'Fixed Income': 0,
        'Real Estate': 0,
        Cash: 0,
        Crypto: 0,
    };

    // Exact-match ticker sets to avoid substring false-positives (e.g. VTIP ≠ VTI, IEFA ≠ IEF)
    const EQUITY_TICKERS = new Set([
        'FZROX',
        'FXAIX',
        'VTI',
        'VOO',
        'SPY',
        'QQQ',
        'FSKAX',
        'VTSAX',
        'SCHB',
        'ITOT',
        'VUG',
        'VTV',
        'VBR',
        'VBK',
        'IVV',
        'IWM',
        'IWB',
        'VXUS',
        'VEA',
        'VWO',
        'EFA',
        'IEFA',
        'IEMG',
        'VT',
        'ACWI',
        'FNILX',
        'FZILX',
        'FSMAX',
        'VXF',
        'IJH',
        'IJR',
        'VO',
        'VB',
        'AVUV',
        'AVDV',
        'QUAL',
        'MTUM',
        'VLUE',
        'SIZE',
    ]);
    const BOND_TICKERS = new Set([
        'BND',
        'AGG',
        'FXNAX',
        'VBTLX',
        'TLT',
        'IEF',
        'SHY',
        'GOVT',
        'VTIP',
        'SCHZ',
        'FBND',
        'FUAMX',
        'FXSTX',
        'VGIT',
        'VGLT',
        'VGSH',
        'MUB',
        'HYG',
        'JNK',
        'LQD',
        'VCIT',
        'VCLT',
        'VCSH',
        'BSV',
        'BIV',
        'BLV',
        'TIPS',
        'STIP',
        'LTPZ',
    ]);
    const CASH_TICKERS = new Set([
        'FZFXX',
        'SPAXX',
        'FDRXX',
        'SPRXX',
        'FZDXX',
        'VMFXX',
        'VUSXX',
        'SGOV',
        'USFR',
        'BIL',
        'SHV',
    ]);

    // Imported positions
    (state.importedPositions || []).forEach((pos) => {
        const sym = (pos.symbol || '').toUpperCase();
        const desc = (pos.description || '').toUpperCase();
        if (EQUITY_TICKERS.has(sym)) {
            current.Equities += pos.value || 0;
        } else if (BOND_TICKERS.has(sym) || desc.includes('BOND')) {
            current['Fixed Income'] += pos.value || 0;
        } else if (CASH_TICKERS.has(sym) || desc.includes('MONEY MARKET')) {
            current.Cash += pos.value || 0;
        } else {
            current.Equities += pos.value || 0;
        }
    });

    // CDs → Fixed Income
    (state.cds || []).forEach((cd) => {
        current['Fixed Income'] += cd.principal || 0;
    });

    // Real estate (equity only)
    (state.realEstate || []).forEach((r) => {
        current['Real Estate'] += Math.max(
            0,
            (r.marketValue || 0) - (r.mortgageBalance || 0),
        );
    });

    // Custom accounts
    (state.customAccounts || []).forEach((acc) => {
        const v = acc.value || 0;
        if (acc.type === 'Crypto') current.Crypto += v;
        else if (acc.type === 'Cash' || acc.type === 'Savings')
            current.Cash += v;
        else if (acc.type === 'Brokerage') current.Equities += v;
        else if (acc.type === 'RealEstate') current['Real Estate'] += v;
        // 'Other' accounts are intentionally excluded from rebalancing buckets
    });

    const totalValue = Object.values(current).reduce((s, v) => s + v, 0);

    if (totalValue === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No portfolio data found. Add accounts, CDs, or import positions first.</td></tr>`;
        return;
    }

    let html = '';
    for (const cls of Object.keys(targets)) {
        const cur = current[cls] || 0;
        const curPct = (cur / totalValue) * 100;
        const tgtPct = targets[cls];
        const diffPct = curPct - tgtPct;
        const diffVal = (diffPct / 100) * totalValue;
        const action =
            Math.abs(diffVal) < 100
                ? '✓ On target'
                : diffVal > 0
                  ? `Sell ${formatCurrency(diffVal)}`
                  : `Buy ${formatCurrency(Math.abs(diffVal))}`;
        const diffColor =
            Math.abs(diffPct) < 1
                ? ''
                : diffPct > 0
                  ? 'text-coral'
                  : 'text-emerald';

        html += `<tr>
            <td class="font-bold">${cls}</td>
            <td class="text-right text-emerald">${formatCurrency(cur)}</td>
            <td class="text-right">${curPct.toFixed(1)}%</td>
            <td class="text-right text-amber">${tgtPct.toFixed(1)}%</td>
            <td class="text-right ${diffColor}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</td>
            <td class="text-right ${diffColor}">${action}</td>
        </tr>`;
    }

    // Total row
    html += `<tr class="font-bold" style="border-top: 1px solid rgba(255,255,255,0.2);">
        <td>Total</td>
        <td class="text-right text-emerald">${formatCurrency(totalValue)}</td>
        <td class="text-right">100.0%</td>
        <td class="text-right text-amber">${totalTarget.toFixed(1)}%</td>
        <td></td><td></td>
    </tr>`;

    tbody.innerHTML = html;
};
