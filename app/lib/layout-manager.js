/* ==========================================================================
   layout-manager.js — Dashboard-builder layout for every tab

   Each tab is a board of rows ("sections"). A row has a column layout
   (1, 2, 2 wide-left, 2 wide-right, 3, 3 wide-center, 4) and each column
   (cell) stacks one or more cards. Outside Customize mode empty cells
   collapse, so a row holding a single card spans the full width.

   - Click a card's title to collapse/expand it.
   - ✎ Customize: a grid canvas where cards are dragged (mouse or touch)
     between cells, or onto "New section" gaps between rows; the target
     cell highlights and a placeholder shows where the card lands. Each
     section has a layout picker, ↑/↓ and delete. ↑/↓ on a card swaps it
     with its neighbour in reading order (keyboard alternative to drag).
   - Dashboard: ＋ Add widget pins any card from another tab (its home tab
     keeps a "Move back here" placeholder); ✕ removes Dashboard cards.

   Cards are moved, never cloned, so every element id and event handler
   keeps working wherever the card lives. Persisted per browser in
   localStorage, like the growth-chart size and sidebar state.
   ========================================================================== */

const LAYOUT_STORAGE_KEY = 'fire_layout_v2';
const LEGACY_LAYOUT_KEY = 'fire_layout_v1';
const DASH_TAB = 'tab-dashboard';

// Column layouts a section can use: relative column widths.
const ROW_LAYOUTS = {
    1: { label: 'Full width', cols: [1] },
    2: { label: 'Two equal columns', cols: [1, 1] },
    '2-left': { label: 'Two columns, wide left', cols: [2, 1] },
    '2-right': { label: 'Two columns, wide right', cols: [1, 2] },
    3: { label: 'Three equal columns', cols: [1, 1, 1] },
    '3-center': { label: 'Three columns, wide center', cols: [1, 2, 1] },
    4: { label: 'Four equal columns', cols: [1, 1, 1, 1] },
};

// Default board per tab: [layout, [[card ids per cell]...]]. Any card not
// listed (e.g. one added to index.html later) lands in its own row.
const DEFAULT_BOARDS = {
    'tab-dashboard': [
        ['3', [['dash-card-growth'], ['dash-card-alloc'], ['dash-card-cash']]],
        ['1', [['dash-card-positions']]],
        ['2', [['dash-card-other'], ['dash-card-nw-history']]],
    ],
    'tab-financial': [
        [
            '3',
            [
                ['financial:net-monthly-cash-flow'],
                ['financial:income-sources'],
                ['financial:monthly-expenses'],
            ],
        ],
        ['1', [['financial:add-accounts-assets']]],
        ['1', [['financial:holdings']]],
        ['1', [['financial:properties']]],
        ['1', [['financial:vehicles']]],
        ['1', [['cd-ladder-card']]],
    ],
    'tab-expenses': [
        [
            '2-left',
            [
                ['expenses:basic-budget-expenses'],
                ['expenses:tax-estimator-summary'],
            ],
        ],
        ['1', [['expenses:spending-upload']]],
    ],
    'tab-insights': [
        ['1', [['insights:portfolio-insights']]],
        ['1', [['insights:portfolio-rebalancing']]],
        ['1', [['insights:tax-loss-harvesting-alerts']]],
    ],
    'tab-sidegig': [
        [
            '2-left',
            [
                ['sidegig:platform-fee-calculator'],
                ['sidegig:side-hustle-accelerators'],
            ],
        ],
        ['1', [['sidegig:ebay-sales-sync']]],
        ['1', [['sidegig:side-gig-ledger-manual-sales-income-hist']]],
    ],
    'tab-projections': [
        [
            '2-right',
            [['proj-settings-card'], ['projections:retirement-growth-path']],
        ],
        [
            '2',
            [
                ['projections:milestone-predictions'],
                ['projections:scenario-comparison'],
            ],
        ],
    ],
    'tab-settings': [
        [
            '3',
            [
                ['settings:projection-defaults'],
                ['settings:notifications-alerts'],
                ['settings:plaid-transaction-sync', 'cointracker-card'],
            ],
        ],
        [
            '3',
            [
                ['settings:privacy-terms'],
                ['settings:data-management'],
                ['settings:google-drive-backup'],
            ],
        ],
        ['1', [['settings:danger-zone']]],
    ],
};

let lmRowSeq = 0;
const newRow = (layout, cells) => ({
    id: `r${Date.now().toString(36)}${(lmRowSeq++).toString(36)}`,
    layout: ROW_LAYOUTS[layout] ? layout : '1',
    cells,
});
const isPh = (token) => typeof token === 'string' && token.startsWith('ph:');
const phId = (token) => token.slice(3);

function loadLayout() {
    const blank = { boards: {}, collapsed: {}, hidden: [], legacyBorrowed: [] };
    try {
        const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY));
        const plainObject = (v) =>
            !!v && typeof v === 'object' && !Array.isArray(v);
        if (plainObject(saved) && plainObject(saved.boards))
            return {
                ...blank,
                boards: saved.boards,
                collapsed:
                    saved.collapsed && typeof saved.collapsed === 'object'
                        ? saved.collapsed
                        : {},
                hidden: Array.isArray(saved.hidden) ? saved.hidden : [],
            };
        // v1 (flat column order) → keep what still means something.
        const v1 = JSON.parse(localStorage.getItem(LEGACY_LAYOUT_KEY));
        if (v1 && typeof v1 === 'object')
            return {
                ...blank,
                collapsed:
                    v1.collapsed && typeof v1.collapsed === 'object'
                        ? v1.collapsed
                        : {},
                hidden: Array.isArray(v1.hidden) ? v1.hidden : [],
                legacyBorrowed: Object.keys(v1.borrowed || {}),
            };
    } catch {
        /* storage unavailable or corrupt — default layout */
    }
    return blank;
}

const LayoutManager = {
    layout: null,
    pickerOpener: null, // focus returns here when the picker closes
    cards: new Map(), // id -> { el, pane, title }
    roots: new Map(), // paneId -> .lm-board
    parking: new Map(), // paneId -> hidden holder for removed cards
    placeholders: new Map(), // card id -> "pinned to Dashboard" element
    ready: false,

    save() {
        const { boards, collapsed, hidden } = this.layout;
        try {
            localStorage.setItem(
                LAYOUT_STORAGE_KEY,
                JSON.stringify({ v: 2, boards, collapsed, hidden }),
            );
            localStorage.removeItem(LEGACY_LAYOUT_KEY);
        } catch {
            /* storage unavailable — layout just won't persist */
        }
    },

    slug(text) {
        return (
            String(text || '')
                .toLowerCase()
                .replace(/&amp;/g, 'and')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'card'
        );
    },

    titleEl(card) {
        return [...card.querySelectorAll('.card-title')].find(
            (t) => t.closest('.card') === card,
        );
    },

    tabName(paneId) {
        const tab = paneId.replace(/^tab-/, '');
        return (
            document.querySelector(`.nav-btn[data-tab="${tab}"] .nav-label`)
                ?.textContent || tab
        );
    },

    panes() {
        return [...document.querySelectorAll('.tab-pane')].filter((p) =>
            this.roots.has(p.id),
        );
    },

    // ── Registration: find each tab's top-level cards, give them ids and
    // controls, and swap the tab's hand-built containers for a board. ──
    register() {
        document.querySelectorAll('.tab-pane').forEach((pane) => {
            const used = new Set();
            const homeContainers = new Set();
            pane.querySelectorAll('.card').forEach((card) => {
                if (
                    card.hasAttribute('hidden') ||
                    card.parentElement.closest('.card')
                )
                    return;
                const tEl = this.titleEl(card);
                const title =
                    card.dataset.cardTitle ||
                    (tEl ? tEl.textContent.trim() : '') ||
                    'Card';
                let id =
                    card.id ||
                    card.dataset.cardId ||
                    `${pane.id.replace(/^tab-/, '')}:${this.slug(title)}`;
                while (used.has(id)) id += '-2';
                used.add(id);
                card.dataset.lmId = id;
                card.dataset.lmTitle = title;
                this.cards.set(id, { el: card, pane, title });
                homeContainers.add(card.parentElement);
                this.decorate(card, tEl);
            });
            if (!homeContainers.size) return;

            const root = document.createElement('div');
            root.className = 'lm-board';
            root.dataset.pane = pane.id;
            // Insert at the tab's top level, before the first old container.
            let anchor = [...homeContainers][0];
            while (anchor.parentElement !== pane) anchor = anchor.parentElement;
            pane.insertBefore(root, anchor);
            const park = document.createElement('div');
            park.className = 'lm-parking';
            park.hidden = true;
            pane.appendChild(park);
            this.roots.set(pane.id, root);
            this.parking.set(pane.id, park);
            this.oldContainers = [
                ...(this.oldContainers || []),
                ...homeContainers,
            ];
        });
    },

    // Hide the old layout containers once the cards have left them; they
    // may still hold hidden helper elements that renderers write into.
    hideEmptiedContainers() {
        const visibleChild = (el) =>
            [...el.children].some(
                (c) =>
                    !c.classList.contains('lm-emptied') &&
                    !c.hidden &&
                    c.style.display !== 'none' &&
                    c.tagName !== 'SCRIPT',
            );
        (this.oldContainers || []).forEach((el) => {
            let node = el;
            while (node && !node.classList.contains('tab-pane')) {
                if (visibleChild(node)) break;
                node.classList.add('lm-emptied');
                node = node.parentElement;
            }
        });
    },

    decorate(card, tEl) {
        const id = card.dataset.lmId;
        if (tEl) {
            // Stays a heading for assistive tech (no role override); the
            // edit-mode ▾ button is the labelled toggle with aria-expanded.
            tEl.classList.add('lm-collapsible');
            tEl.setAttribute('tabindex', '0');
            tEl.title = 'Click to collapse / expand';
            const toggle = (e) => {
                if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')
                    return;
                if (e.type === 'keydown') e.preventDefault();
                this.setCollapsed(id, !card.classList.contains('lm-collapsed'));
            };
            tEl.addEventListener('click', toggle);
            tEl.addEventListener('keydown', toggle);
        } else {
            card.classList.add('lm-untitled');
        }

        const ctl = document.createElement('div');
        ctl.className = 'lm-controls';
        ctl.innerHTML = `
            <button type="button" class="lm-handle" aria-label="Drag to move" title="Drag to move">⠿</button>
            <span class="lm-ctl-title"></span>
            <button type="button" class="lm-btn" data-lm-act="up" aria-label="Move earlier" title="Move earlier">↑</button>
            <button type="button" class="lm-btn" data-lm-act="down" aria-label="Move later" title="Move later">↓</button>
            <button type="button" class="lm-btn" data-lm-act="collapse" aria-label="Collapse card" aria-expanded="true" title="Collapse / expand">▾</button>
            <button type="button" class="lm-btn lm-btn-remove" data-lm-act="remove" aria-label="Remove from Dashboard" title="Remove from Dashboard">✕</button>`;
        ctl.querySelector('.lm-ctl-title').textContent = card.dataset.lmTitle;
        card.prepend(ctl);
        ctl.addEventListener('click', (e) => {
            const act = e.target.closest('[data-lm-act]')?.dataset.lmAct;
            if (act === 'up') this.step(id, -1);
            else if (act === 'down') this.step(id, 1);
            else if (act === 'collapse')
                this.setCollapsed(id, !card.classList.contains('lm-collapsed'));
            else if (act === 'remove') this.removeFromDashboard(id);
        });
        this.enableDrag(card, ctl.querySelector('.lm-handle'));
    },

    // ── Collapse ────────────────────────────────────────────────────────
    setCollapsed(id, collapsed, persist = true) {
        const entry = this.cards.get(id);
        if (!entry) return;
        entry.el.classList.toggle('lm-collapsed', collapsed);
        entry.el
            .querySelector('[data-lm-act="collapse"]')
            ?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (!collapsed) this.resizeCharts(entry.el);
        if (!persist) return;
        if (collapsed) this.layout.collapsed[id] = true;
        else delete this.layout.collapsed[id];
        this.save();
    },

    resizeCharts(root) {
        if (typeof Chart === 'undefined' || !Chart.getChart) return;
        requestAnimationFrame(() =>
            root
                .querySelectorAll('canvas')
                .forEach((c) => Chart.getChart(c)?.resize()),
        );
    },

    // ── Board model helpers ─────────────────────────────────────────────
    defaultBoard(paneId) {
        return (DEFAULT_BOARDS[paneId] || []).map(([layout, cells]) =>
            newRow(
                layout,
                cells.map((c) => [...c]),
            ),
        );
    },

    locate(token) {
        for (const [paneId, rows] of Object.entries(this.layout.boards))
            for (let ri = 0; ri < rows.length; ri++)
                for (let ci = 0; ci < rows[ri].cells.length; ci++) {
                    const idx = rows[ri].cells[ci].indexOf(token);
                    if (idx >= 0) return { paneId, ri, ci, idx };
                }
        return null;
    },

    removeToken(token) {
        const at = this.locate(token);
        if (at)
            this.layout.boards[at.paneId][at.ri].cells[at.ci].splice(at.idx, 1);
        return at;
    },

    // First empty cell of a board, else a new full-width row at the end.
    placeInBoard(paneId, token) {
        const rows = this.layout.boards[paneId];
        for (const row of rows) {
            const empty = row.cells.find((c) => c.length === 0);
            if (empty) {
                empty.push(token);
                return;
            }
        }
        rows.push(newRow('1', [[token]]));
    },

    homeOf(id) {
        return this.cards.get(id)?.pane.id;
    },

    // Make the saved boards agree with the cards that actually exist:
    // every card exactly once (or removed from the Dashboard), every pin
    // paired with a placeholder on its home tab, and cell counts matching
    // each row's layout. `prune` drops sections with nothing in them.
    sanitize({ prune = false } = {}) {
        const L = this.layout;
        this.panes().forEach((p) => {
            if (!Array.isArray(L.boards[p.id])) L.boards[p.id] = [];
        });
        Object.keys(L.boards).forEach((k) => {
            if (!this.roots.has(k)) delete L.boards[k];
        });
        L.hidden = L.hidden.filter(
            (id) => this.cards.has(id) && this.homeOf(id) === DASH_TAB,
        );
        const seen = new Set(L.hidden);
        const pinned = new Set();
        // Pass 1: cards (not placeholders).
        Object.entries(L.boards).forEach(([paneId, rows]) => {
            L.boards[paneId] = rows
                .filter((r) => r && Array.isArray(r.cells))
                .map((r) => {
                    const layout = ROW_LAYOUTS[r.layout] ? r.layout : '1';
                    const n = ROW_LAYOUTS[layout].cols.length;
                    let cells = r.cells.map((c) =>
                        (Array.isArray(c) ? c : []).filter((t) => {
                            if (typeof t !== 'string') return false;
                            if (isPh(t)) return true;
                            const home = this.homeOf(t);
                            const ok =
                                home &&
                                !seen.has(t) &&
                                (home === paneId || paneId === DASH_TAB);
                            if (ok) {
                                seen.add(t);
                                if (home !== paneId) pinned.add(t);
                            }
                            return ok;
                        }),
                    );
                    if (cells.length > n)
                        cells = [
                            ...cells.slice(0, n - 1),
                            cells.slice(n - 1).flat(),
                        ];
                    while (cells.length < n) cells.push([]);
                    return { id: r.id || newRow('1', []).id, layout, cells };
                });
        });
        // Pass 2: placeholders valid only for pinned cards on their home tab.
        const phSeen = new Set();
        Object.entries(L.boards).forEach(([paneId, rows]) =>
            rows.forEach((r) => {
                r.cells = r.cells.map((c) =>
                    c.filter((t) => {
                        if (!isPh(t)) return true;
                        const id = phId(t);
                        const ok =
                            pinned.has(id) &&
                            this.homeOf(id) === paneId &&
                            !phSeen.has(id);
                        if (ok) phSeen.add(id);
                        return ok;
                    }),
                );
            }),
        );
        pinned.forEach((id) => {
            if (!phSeen.has(id))
                L.boards[this.homeOf(id)].push(newRow('1', [[`ph:${id}`]]));
        });
        // Cards missing from every board go home in their own row.
        this.cards.forEach((entry, id) => {
            if (!seen.has(id))
                L.boards[entry.pane.id].push(newRow('1', [[id]]));
        });
        if (prune)
            Object.keys(L.boards).forEach((k) => {
                L.boards[k] = L.boards[k].filter((r) =>
                    r.cells.some((c) => c.length),
                );
            });
    },

    // ── Rendering ───────────────────────────────────────────────────────
    isWide(token) {
        return (
            !isPh(token) &&
            !!this.cards.get(token)?.el.classList.contains('growth-size-wide')
        );
    },

    tokenEl(token) {
        if (!isPh(token)) return this.cards.get(token)?.el;
        const id = phId(token);
        if (!this.placeholders.has(id)) {
            const ph = document.createElement('div');
            ph.className = 'card glass-card lm-placeholder';
            ph.dataset.lmPlaceholderFor = id;
            ph.innerHTML = `<p>📌 <strong></strong> is pinned to your Dashboard.</p>
                <div class="lm-placeholder-actions">
                    <button type="button" class="action-btn" data-lm-ph="go">Go to Dashboard</button>
                    <button type="button" class="action-btn" data-lm-ph="back">Move back here</button>
                </div>`;
            ph.querySelector('strong').textContent =
                this.cards.get(id)?.title || id;
            ph.addEventListener('click', (e) => {
                const act = e.target.closest('[data-lm-ph]')?.dataset.lmPh;
                if (act === 'go')
                    document.getElementById('btn-tab-dashboard')?.click();
                else if (act === 'back') this.returnHome(id);
            });
            this.placeholders.set(id, ph);
        }
        return this.placeholders.get(id);
    },

    layoutPreview(key) {
        return ROW_LAYOUTS[key].cols
            .map((f) => `<span data-flex="${f}"></span>`)
            .join('');
    },

    rowBar(paneId, ri, row, total) {
        const bar = document.createElement('div');
        bar.className = 'lm-row-bar';
        bar.innerHTML = `
            <span class="lm-row-label">Section ${ri + 1}</span>
            <div class="lm-layouts" role="group" aria-label="Section layout">
                ${Object.entries(ROW_LAYOUTS)
                    .map(
                        ([key, l]) =>
                            `<button type="button" class="lm-layout-btn${key === row.layout ? ' active' : ''}" data-lm-layout="${key}" aria-pressed="${key === row.layout}" aria-label="${l.label}" title="${l.label}">${this.layoutPreview(key)}</button>`,
                    )
                    .join('')}
            </div>
            <span class="lm-row-spacer"></span>
            <button type="button" class="lm-btn" data-lm-row="up" aria-label="Move section up" title="Move section up"${ri === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="lm-btn" data-lm-row="down" aria-label="Move section down" title="Move section down"${ri === total - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="lm-btn lm-btn-remove-row" data-lm-row="delete" aria-label="Delete section" title="Delete section (its cards move to a neighbouring section)">🗑</button>`;
        // CSP: no style="" in markup — size the preview bars via the CSSOM.
        bar.querySelectorAll('[data-flex]').forEach((sp) => {
            sp.style.flex = sp.dataset.flex;
        });
        bar.addEventListener('click', (e) => {
            const lay = e.target.closest('[data-lm-layout]')?.dataset.lmLayout;
            const act = e.target.closest('[data-lm-row]')?.dataset.lmRow;
            if (lay) this.setRowLayout(paneId, ri, lay);
            else if (act === 'up') this.moveRow(paneId, ri, -1);
            else if (act === 'down') this.moveRow(paneId, ri, 1);
            else if (act === 'delete') this.deleteRow(paneId, ri);
        });
        return bar;
    },

    renderPane(paneId, placed) {
        const root = this.roots.get(paneId);
        const pane = document.getElementById(paneId);
        const editing = pane.classList.contains('lm-editing');
        const rows = this.layout.boards[paneId];
        root.textContent = '';
        const gap = (index) => {
            const g = document.createElement('div');
            g.className = 'lm-row-gap';
            g.dataset.gap = index;
            return g;
        };
        const addRowEl = (cells, layoutKey, ri, row) => {
            const filled = editing
                ? cells.map((c, i) => ({ c, i }))
                : cells.map((c, i) => ({ c, i })).filter(({ c }) => c.length);
            if (!filled.length) return;
            const el = document.createElement('div');
            el.className = 'lm-row';
            if (ri !== null) el.dataset.row = ri;
            const fr = ROW_LAYOUTS[layoutKey].cols;
            el.style.gridTemplateColumns =
                filled.length === 1
                    ? 'minmax(0, 1fr)'
                    : filled.map(({ i }) => `minmax(0, ${fr[i]}fr)`).join(' ');
            el.dataset.cols = filled.length;
            if (editing && row)
                el.appendChild(this.rowBar(paneId, ri, row, rows.length));
            filled.forEach(({ c, i }) => {
                const cell = document.createElement('div');
                cell.className = 'lm-cell';
                cell.dataset.cell = i;
                c.forEach((t) => {
                    const node = this.tokenEl(t);
                    if (!node) return;
                    cell.appendChild(node);
                    if (!isPh(t)) placed.add(t);
                });
                if (editing && !c.length) {
                    const hint = document.createElement('div');
                    hint.className = 'lm-cell-empty';
                    hint.textContent = 'Drop a card here';
                    cell.appendChild(hint);
                }
                el.appendChild(cell);
            });
            root.appendChild(el);
        };
        rows.forEach((row, ri) => {
            if (editing) root.appendChild(gap(ri));
            let cells = row.cells;
            // The growth chart's ⤢ expander: outside Customize mode a wide
            // card gets a full-width row of its own above its section.
            if (!editing) {
                const filledCount = cells.filter((c) => c.length).length;
                const wide = cells
                    .flat()
                    .filter(
                        (t) =>
                            this.isWide(t) &&
                            (filledCount > 1 ||
                                cells.find((c) => c.includes(t)).length > 1),
                    );
                wide.forEach((t) => addRowEl([[t]], '1', null, null));
                cells = cells.map((c) => c.filter((t) => !wide.includes(t)));
            }
            addRowEl(cells, row.layout, ri, row);
        });
        if (editing) {
            root.appendChild(gap(rows.length));
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'lm-add-row';
            add.textContent = '＋ Add section';
            add.addEventListener('click', () => this.addRow(paneId));
            root.appendChild(add);
        }
    },

    renderAll() {
        const placed = new Set();
        this.panes().forEach((p) => this.renderPane(p.id, placed));
        // Removed / not-yet-placed cards wait (still in the DOM, so their
        // renderers keep working) in their home tab's hidden parking spot.
        this.cards.forEach((entry, id) => {
            if (!placed.has(id))
                this.parking.get(entry.pane.id)?.appendChild(entry.el);
        });
        const active = document.querySelector('.tab-pane.active');
        if (active) this.resizeCharts(active);
    },

    commit({ prune = false } = {}) {
        this.sanitize({ prune });
        this.save();
        this.renderAll();
    },

    // ── Section operations ──────────────────────────────────────────────
    setRowLayout(paneId, ri, key) {
        const row = this.layout.boards[paneId][ri];
        if (!row || !ROW_LAYOUTS[key]) return;
        const n = ROW_LAYOUTS[key].cols.length;
        const cells = row.cells;
        // Fewer columns: cards from dropped columns stack into the last one.
        if (cells.length > n)
            row.cells = [...cells.slice(0, n - 1), cells.slice(n - 1).flat()];
        while (row.cells.length < n) row.cells.push([]);
        row.layout = key;
        this.commit();
    },

    moveRow(paneId, ri, dir) {
        const rows = this.layout.boards[paneId];
        const j = ri + dir;
        if (j < 0 || j >= rows.length) return;
        [rows[ri], rows[j]] = [rows[j], rows[ri]];
        this.commit();
    },

    deleteRow(paneId, ri) {
        const rows = this.layout.boards[paneId];
        const [row] = rows.splice(ri, 1);
        const tokens = row.cells.flat();
        if (tokens.length) {
            const target = rows[ri - 1] || rows[ri];
            if (target) target.cells[target.cells.length - 1].push(...tokens);
            else rows.push(newRow('1', [tokens]));
        }
        this.commit();
    },

    addRow(paneId) {
        this.layout.boards[paneId].push(newRow('2', [[], []]));
        this.commit();
    },

    // ↑/↓ on a card: swap with its neighbour in reading order.
    step(id, dir) {
        const at = this.locate(id);
        if (!at) return;
        const rows = this.layout.boards[at.paneId];
        const order = [];
        rows.forEach((r, ri) =>
            r.cells.forEach((c, ci) =>
                c.forEach(
                    (t, idx) => !isPh(t) && order.push({ t, ri, ci, idx }),
                ),
            ),
        );
        const i = order.findIndex((o) => o.t === id);
        const other = order[i + dir];
        if (!other) return;
        rows[at.ri].cells[at.ci][at.idx] = other.t;
        rows[other.ri].cells[other.ci][other.idx] = id;
        this.commit();
        this.cards
            .get(id)
            .el.querySelector(`[data-lm-act="${dir < 0 ? 'up' : 'down'}"]`)
            ?.focus();
    },

    // Rebuild a tab's board from the DOM after a drag (edit mode only:
    // every cell is rendered, so DOM order is the full model).
    readBoard(paneId) {
        const root = this.roots.get(paneId);
        const old = this.layout.boards[paneId];
        const tokensIn = (el) =>
            [...el.children]
                .map((c) =>
                    c.dataset.lmId
                        ? c.dataset.lmId
                        : c.dataset.lmPlaceholderFor
                          ? `ph:${c.dataset.lmPlaceholderFor}`
                          : null,
                )
                .filter(Boolean);
        const rows = [];
        [...root.children].forEach((el) => {
            if (el.classList.contains('lm-row-gap')) {
                const t = tokensIn(el);
                if (t.length) rows.push(newRow('1', [t]));
            } else if (el.classList.contains('lm-row')) {
                const prev = old[Number(el.dataset.row)];
                rows.push({
                    id: prev.id,
                    layout: prev.layout,
                    cells: [...el.querySelectorAll(':scope > .lm-cell')].map(
                        tokensIn,
                    ),
                });
            }
        });
        this.layout.boards[paneId] = rows;
    },

    // ── Drag & drop (pointer events: mouse, pen and touch) ──────────────
    enableDrag(card, handle) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const pane = card.closest('.tab-pane');
            if (!pane?.classList.contains('lm-editing')) return;
            e.preventDefault();
            const paneId = pane.id;
            const root = this.roots.get(paneId);
            const scroller = document.querySelector('.scroll-container');
            const origin = {
                parent: card.parentElement,
                next: card.nextSibling,
            };

            const drop = document.createElement('div');
            drop.className = 'lm-drop-ph';
            drop.style.height = Math.min(card.offsetHeight, 220) + 'px';
            card.replaceWith(drop);

            const ghost = document.createElement('div');
            ghost.className = 'lm-ghost';
            ghost.textContent = `⠿ ${card.dataset.lmTitle}`;
            document.body.appendChild(ghost);
            pane.classList.add('lm-drag-active');

            let lastX = e.clientX;
            let lastY = e.clientY;
            let hot = null;
            const setHot = (el) => {
                if (hot === el) return;
                hot?.classList.remove('lm-hot');
                hot = el;
                hot?.classList.add('lm-hot');
            };
            const placeGhost = () => {
                ghost.style.left = lastX + 'px';
                ghost.style.top = lastY + 'px';
            };
            placeGhost();

            let raf = requestAnimationFrame(function scroll() {
                if (scroller) {
                    const r = scroller.getBoundingClientRect();
                    const edge = 80;
                    let dy = 0;
                    if (lastY < r.top + edge)
                        dy = -Math.ceil((r.top + edge - lastY) / 5);
                    else if (lastY > r.bottom - edge)
                        dy = Math.ceil((lastY - (r.bottom - edge)) / 5);
                    if (dy) scroller.scrollTop += dy;
                }
                raf = requestAnimationFrame(scroll);
            });

            const insertInCell = (cell, y) => {
                const items = [...cell.children].filter(
                    (c) =>
                        c !== drop &&
                        (c.dataset.lmId || c.dataset.lmPlaceholderFor),
                );
                const before = items.find((c) => {
                    const r = c.getBoundingClientRect();
                    return y < r.top + r.height / 2;
                });
                if (before) cell.insertBefore(drop, before);
                else cell.appendChild(drop);
            };

            const onMove = (ev) => {
                lastX = ev.clientX;
                lastY = ev.clientY;
                placeGhost();
                const under = document.elementFromPoint(lastX, lastY);
                if (!under || !root.contains(under)) return;
                const gapEl = under.closest('.lm-row-gap');
                if (gapEl) {
                    if (drop.parentElement !== gapEl) gapEl.appendChild(drop);
                    setHot(gapEl);
                    return;
                }
                let cell = under.closest('.lm-cell');
                if (!cell) {
                    // Row bar or row padding: the nearest cell by x.
                    const row = under.closest('.lm-row');
                    if (!row) return;
                    const cells = [
                        ...row.querySelectorAll(':scope > .lm-cell'),
                    ];
                    cell = cells.reduce((best, c) => {
                        const r = c.getBoundingClientRect();
                        const d = Math.abs(lastX - (r.left + r.width / 2));
                        return !best || d < best.d ? { c, d } : best;
                    }, null)?.c;
                    if (!cell) return;
                }
                insertInCell(cell, lastY);
                setHot(cell);
            };

            const finish = (cancel) => {
                cancelAnimationFrame(raf);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onCancel);
                window.removeEventListener('keydown', onKey);
                setHot(null);
                ghost.remove();
                pane.classList.remove('lm-drag-active');
                if (cancel || !drop.isConnected) {
                    drop.remove();
                    origin.parent.insertBefore(card, origin.next);
                    return;
                }
                drop.replaceWith(card);
                this.readBoard(paneId);
                this.commit();
            };
            const onUp = () => finish(false);
            const onCancel = () => finish(true);
            const onKey = (ev) => {
                if (ev.key === 'Escape') finish(true);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onCancel);
            window.addEventListener('keydown', onKey);
        });
    },

    // ── Dashboard widgets ───────────────────────────────────────────────
    borrow(id) {
        const home = this.homeOf(id);
        if (!home || home === DASH_TAB) return;
        const at = this.locate(id);
        if (at && at.paneId === DASH_TAB) return; // already pinned
        if (at)
            this.layout.boards[at.paneId][at.ri].cells[at.ci][at.idx] =
                `ph:${id}`;
        this.placeInBoard(DASH_TAB, id);
        this.commit();
    },

    returnHome(id) {
        const ph = this.locate(`ph:${id}`);
        this.removeToken(id);
        if (ph) this.layout.boards[ph.paneId][ph.ri].cells[ph.ci][ph.idx] = id;
        this.commit();
        this.resizeCharts(this.cards.get(id).el);
    },

    removeFromDashboard(id) {
        if (this.homeOf(id) !== DASH_TAB) {
            this.returnHome(id);
            return;
        }
        this.removeToken(id);
        if (!this.layout.hidden.includes(id)) this.layout.hidden.push(id);
        this.commit();
    },

    restoreDashCard(id) {
        this.layout.hidden = this.layout.hidden.filter((h) => h !== id);
        this.placeInBoard(DASH_TAB, id);
        this.commit();
        this.resizeCharts(this.cards.get(id).el);
    },

    // ── Widget picker (Dashboard) ───────────────────────────────────────
    openPicker({ focusId = null } = {}) {
        // Rebuilding after Add/Remove keeps the original opener.
        if (!document.querySelector('.lm-picker-overlay'))
            this.pickerOpener = document.activeElement;
        this.closePicker({ restoreFocus: false });
        const overlay = document.createElement('div');
        overlay.className = 'lm-picker-overlay';
        overlay.innerHTML = `<div class="lm-picker" role="dialog" aria-modal="true" aria-labelledby="lm-picker-title">
            <div class="lm-picker-head">
                <h2 id="lm-picker-title">Add widgets to your Dashboard</h2>
                <button type="button" class="lm-btn" data-lm-close aria-label="Close">✕</button>
            </div>
            <p class="text-muted lm-picker-hint">Pinned cards move to the Dashboard and leave a link behind on their home tab. They land in the first empty cell, or a new full-width section.</p>
            <div class="lm-picker-body"></div>
        </div>`;
        const body = overlay.querySelector('.lm-picker-body');
        const groups = new Map();
        this.cards.forEach((entry, id) => {
            const isDash = entry.pane.id === DASH_TAB;
            if (isDash && !this.layout.hidden.includes(id)) return;
            const group = isDash
                ? 'Removed from Dashboard'
                : this.tabName(entry.pane.id);
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push({ id, entry, isDash });
        });
        if (!groups.size)
            body.innerHTML =
                '<p class="text-muted">Every card is already on your Dashboard.</p>';
        groups.forEach((items, group) => {
            const sec = document.createElement('section');
            sec.className = 'lm-picker-group';
            const h = document.createElement('h3');
            h.textContent = group;
            sec.appendChild(h);
            items.forEach(({ id, entry, isDash }) => {
                const pinned = !isDash && this.locate(id)?.paneId === DASH_TAB;
                const row = document.createElement('div');
                row.className = 'lm-picker-row';
                const name = document.createElement('span');
                name.textContent = entry.title;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = pinned ? 'action-btn' : 'primary-btn';
                btn.textContent = pinned ? 'Remove' : 'Add';
                btn.dataset.lmPick = id;
                btn.setAttribute(
                    'aria-label',
                    `${btn.textContent} ${entry.title}`,
                );
                btn.addEventListener('click', () => {
                    if (isDash) this.restoreDashCard(id);
                    else if (pinned) this.returnHome(id);
                    else this.borrow(id);
                    // Re-render with the new state, focus staying on this row.
                    this.openPicker({ focusId: id });
                });
                row.append(name, btn);
                sec.appendChild(row);
            });
            body.appendChild(sec);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-lm-close]'))
                this.closePicker();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePicker();
                return;
            }
            if (e.key !== 'Tab') return;
            // Keep Tab inside the dialog.
            const focusables = [
                ...overlay.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            ];
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });
        document.body.appendChild(overlay);
        const target =
            (focusId &&
                overlay.querySelector(
                    `[data-lm-pick="${CSS.escape(focusId)}"]`,
                )) ||
            overlay.querySelector('[data-lm-close]');
        target.focus();
    },

    closePicker({ restoreFocus = true } = {}) {
        const overlay = document.querySelector('.lm-picker-overlay');
        if (!overlay) return;
        overlay.remove();
        if (restoreFocus) {
            if (this.pickerOpener?.isConnected) this.pickerOpener.focus();
            this.pickerOpener = null;
        }
    },

    // ── Per-tab toolbar + edit mode ─────────────────────────────────────
    addToolbars() {
        this.panes().forEach((pane) => {
            const isDash = pane.id === DASH_TAB;
            const bar = document.createElement('div');
            bar.className = 'lm-toolbar';
            bar.innerHTML = `
                <span class="lm-hint">Drag ⠿ cards between cells or onto “New section” gaps · pick a layout per section · click a title to collapse</span>
                ${isDash ? '<button type="button" class="lm-tool-btn" data-lm-tool="add">＋ Add widget</button>' : ''}
                <button type="button" class="lm-tool-btn" data-lm-tool="section">＋ Section</button>
                <button type="button" class="lm-tool-btn" data-lm-tool="reset">↺ Reset</button>
                <button type="button" class="lm-tool-btn lm-tool-edit" data-lm-tool="edit" aria-pressed="false">✎ Customize</button>`;
            bar.addEventListener('click', (e) => {
                const tool = e.target.closest('[data-lm-tool]')?.dataset.lmTool;
                if (tool === 'edit') this.toggleEdit(pane);
                else if (tool === 'add') this.openPicker();
                else if (tool === 'section') this.addRow(pane.id);
                else if (tool === 'reset') this.resetPane(pane);
            });
            pane.prepend(bar);
        });
    },

    toggleEdit(pane, force) {
        const on = force ?? !pane.classList.contains('lm-editing');
        document.querySelectorAll('.tab-pane.lm-editing').forEach((p) => {
            p.classList.remove('lm-editing');
            const b = p.querySelector('.lm-tool-edit');
            if (b) {
                b.textContent = '✎ Customize';
                b.setAttribute('aria-pressed', 'false');
            }
        });
        if (on) {
            pane.classList.add('lm-editing');
            const b = pane.querySelector('.lm-tool-edit');
            b.textContent = '✓ Done';
            b.setAttribute('aria-pressed', 'true');
        }
        // Leaving edit mode drops sections left empty.
        this.commit({ prune: !on });
    },

    resetPane(pane) {
        if (
            !confirm(
                'Reset this tab to its default sections and expand every card?',
            )
        )
            return;
        const L = this.layout;
        const id = pane.id;
        if (id === DASH_TAB) {
            L.hidden = [];
        } else {
            // Its cards pinned to the Dashboard come home too.
            L.boards[DASH_TAB] = (L.boards[DASH_TAB] || []).map((r) => ({
                ...r,
                cells: r.cells.map((c) =>
                    c.filter((t) => this.homeOf(t) !== id),
                ),
            }));
        }
        L.boards[id] = this.defaultBoard(id);
        if (id === DASH_TAB) {
            // Anything pinned from other tabs goes back too.
            Object.keys(L.boards).forEach((k) => {
                if (k === DASH_TAB) return;
                L.boards[k].forEach((r) =>
                    r.cells.forEach((c, ci) => {
                        r.cells[ci] = c.map((t) => (isPh(t) ? phId(t) : t));
                    }),
                );
            });
        }
        this.cards.forEach((entry, cid) => {
            if (entry.pane.id === id || this.locate(cid)?.paneId === id) {
                this.setCollapsed(cid, false, false);
                delete L.collapsed[cid];
            }
        });
        this.commit({ prune: !pane.classList.contains('lm-editing') });
    },

    refresh() {
        if (this.ready) this.renderAll();
    },

    init() {
        this.layout = loadLayout();
        this.register();
        this.addToolbars();
        this.panes().forEach((p) => {
            const rows = this.layout.boards[p.id];
            if (!Array.isArray(rows) || !rows.length)
                this.layout.boards[p.id] = this.defaultBoard(p.id);
        });
        // Before the hidden filter / v1 migration walk the rows: drop
        // malformed saved rows and tokens.
        this.sanitize();
        // Dashboard cards removed earlier stay off the default board.
        this.layout.boards[DASH_TAB] = (this.layout.boards[DASH_TAB] || []).map(
            (r) => ({
                ...r,
                cells: r.cells.map((c) =>
                    c.filter((t) => !this.layout.hidden.includes(t)),
                ),
            }),
        );
        (this.layout.legacyBorrowed || []).forEach((id) => {
            const at = this.cards.has(id) && this.locate(id);
            if (at && at.paneId !== DASH_TAB) {
                this.layout.boards[at.paneId][at.ri].cells[at.ci][at.idx] =
                    `ph:${id}`;
                this.placeInBoard(DASH_TAB, id);
            }
        });
        delete this.layout.legacyBorrowed;
        Object.keys(this.layout.collapsed).forEach((id) => {
            if (this.cards.has(id)) this.setCollapsed(id, true, false);
        });
        this.ready = true;
        this.commit({ prune: true });
        this.hideEmptiedContainers();

        // Charts on a tab render while it's hidden; size them on arrival.
        document.querySelectorAll('.nav-btn').forEach((btn) =>
            btn.addEventListener('click', () => {
                const pane = document.getElementById(`tab-${btn.dataset.tab}`);
                if (pane) this.resizeCharts(pane);
            }),
        );
    },
};

function initLayoutManager() {
    LayoutManager.init();
}
window.LayoutManager = LayoutManager;
