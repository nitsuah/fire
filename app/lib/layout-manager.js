/* ==========================================================================
   layout-manager.js — Customizable card layout on every tab

   - Click a card's title to collapse/expand it.
   - "Customize" on any tab: drag (⠿, mouse or touch) or ↑/↓ to reorder
     cards; on the Dashboard cards can also move between the two columns.
   - Dashboard: "Add widget" pulls any card from another tab onto the
     Dashboard (its home tab shows a placeholder to send it back), and
     Dashboard's own cards can be removed and re-added.

   Cards are moved, never cloned, so every element id and event handler
   keeps working wherever the card lives. Persisted per browser in
   localStorage, like the growth-chart size and sidebar state.
   ========================================================================== */

const LAYOUT_STORAGE_KEY = 'fire_layout_v1';
const DASH_TAB = 'tab-dashboard';

function emptyLayout() {
    return { order: {}, collapsed: {}, borrowed: {}, hidden: [] };
}

function loadLayout() {
    try {
        const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY));
        if (saved && typeof saved === 'object')
            return {
                order:
                    saved.order && typeof saved.order === 'object'
                        ? saved.order
                        : {},
                collapsed:
                    saved.collapsed && typeof saved.collapsed === 'object'
                        ? saved.collapsed
                        : {},
                borrowed:
                    saved.borrowed && typeof saved.borrowed === 'object'
                        ? saved.borrowed
                        : {},
                hidden: Array.isArray(saved.hidden) ? saved.hidden : [],
            };
    } catch {
        /* storage unavailable or corrupt — default layout */
    }
    return emptyLayout();
}

const LayoutManager = {
    layout: emptyLayout(),
    cards: new Map(), // id -> { el, pane, homeZone, title }
    zones: new Map(), // key -> el
    initialOrder: new Map(), // zoneKey -> [ids] as shipped in index.html
    editingPane: null,

    save() {
        try {
            localStorage.setItem(
                LAYOUT_STORAGE_KEY,
                JSON.stringify(this.layout),
            );
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

    isTopLevelCard(card) {
        return (
            !card.hasAttribute('hidden') &&
            !card.classList.contains('lm-placeholder') &&
            !card.parentElement.closest('.card')
        );
    },

    paneOf(el) {
        return el.closest('.tab-pane');
    },

    cardsIn(zone) {
        return [...zone.children].filter((c) => c.dataset && c.dataset.lmId);
    },

    // ── Registration ────────────────────────────────────────────────────
    register() {
        document.querySelectorAll('.tab-pane').forEach((pane) => {
            let zoneN = 0;
            const used = new Set();
            pane.querySelectorAll('.card').forEach((card) => {
                if (!this.isTopLevelCard(card)) return;
                const zone = card.parentElement;
                if (!zone.dataset.lmZone) {
                    zone.dataset.lmZone = zone.id || `${pane.id}:z${zoneN++}`;
                    this.zones.set(zone.dataset.lmZone, zone);
                    this.initialOrder.set(zone.dataset.lmZone, []);
                }
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
                this.cards.set(id, {
                    el: card,
                    pane,
                    homeZone: zone.dataset.lmZone,
                    title,
                });
                this.initialOrder.get(zone.dataset.lmZone).push(id);
                this.decorate(card, tEl, pane);
            });
        });
    },

    decorate(card, tEl, pane) {
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
            <button type="button" class="lm-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
            <span class="lm-ctl-title"></span>
            <button type="button" class="lm-btn" data-lm-act="up" aria-label="Move up" title="Move up">↑</button>
            <button type="button" class="lm-btn" data-lm-act="down" aria-label="Move down" title="Move down">↓</button>
            <button type="button" class="lm-btn" data-lm-act="collapse" aria-label="Collapse card" aria-expanded="true" title="Collapse / expand">▾</button>
            <button type="button" class="lm-btn lm-btn-remove" data-lm-act="remove" aria-label="Remove from Dashboard" title="Remove from Dashboard">✕</button>`;
        ctl.querySelector('.lm-ctl-title').textContent = card.dataset.lmTitle;
        card.prepend(ctl);
        ctl.addEventListener('click', (e) => {
            const act = e.target.closest('[data-lm-act]')?.dataset.lmAct;
            if (act === 'up') this.move(card, -1);
            else if (act === 'down') this.move(card, 1);
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

    // ── Ordering ────────────────────────────────────────────────────────
    // Zones a card may move between: every zone of its current tab.
    paneZones(pane) {
        return [...pane.querySelectorAll('[data-lm-zone]')];
    },

    move(card, dir) {
        const pane = this.paneOf(card);
        // Flattened order across the tab's zones so ↑/↓ can cross from one
        // Dashboard column into the other.
        const flat = this.paneZones(pane)
            .flatMap((z) => this.cardsIn(z))
            .filter((c) => !c.classList.contains('lm-hidden'));
        const i = flat.indexOf(card);
        const target = flat[i + dir];
        if (!target) return;
        if (dir < 0) target.before(card);
        else target.after(card);
        this.persistPaneOrder(pane);
        card.querySelector(
            `[data-lm-act="${dir < 0 ? 'up' : 'down'}"]`,
        )?.focus();
    },

    persistPaneOrder(pane) {
        this.paneZones(pane).forEach((z) => {
            // Placeholders are saved too ("ph:<id>") so a pinned card's
            // "move back here" spot survives a reload.
            this.layout.order[z.dataset.lmZone] = [...z.children]
                .map(
                    (c) =>
                        c.dataset?.lmId ||
                        (c.dataset?.lmPlaceholderFor
                            ? `ph:${c.dataset.lmPlaceholderFor}`
                            : null),
                )
                .filter(Boolean);
        });
        this.save();
        this.syncDashCustomClass();
    },

    applyOrder() {
        Object.entries(this.layout.order).forEach(([zoneKey, ids]) => {
            const zone = this.zones.get(zoneKey);
            if (!zone || !Array.isArray(ids)) return;
            const pane = this.paneOf(zone);
            ids.forEach((id) => {
                if (typeof id === 'string' && id.startsWith('ph:')) {
                    const ph = this.placeholderFor(id.slice(3));
                    if (ph && this.paneOf(ph) === pane) zone.appendChild(ph);
                    return;
                }
                const entry = this.cards.get(id);
                if (!entry) return;
                // A card may only land in a zone of the tab it currently
                // lives on (its home tab, or the Dashboard if borrowed).
                if (this.paneOf(entry.el) !== pane) return;
                zone.appendChild(entry.el);
            });
        });
    },

    // ── Pointer drag (mouse + touch) ────────────────────────────────────
    enableDrag(card, handle) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            const pane = this.paneOf(card);
            const scroller = document.querySelector('.scroll-container');
            handle.setPointerCapture?.(e.pointerId);
            card.classList.add('lm-dragging');
            let lastY = e.clientY;
            let raf = null;

            const autoScroll = () => {
                if (!scroller) return;
                const r = scroller.getBoundingClientRect();
                const edge = 70;
                let dy = 0;
                if (lastY < r.top + edge)
                    dy = -Math.ceil((r.top + edge - lastY) / 6);
                else if (lastY > r.bottom - edge)
                    dy = Math.ceil((lastY - (r.bottom - edge)) / 6);
                if (dy) scroller.scrollTop += dy;
                raf = requestAnimationFrame(autoScroll);
            };
            raf = requestAnimationFrame(autoScroll);

            const onMove = (ev) => {
                lastY = ev.clientY;
                const under = document.elementFromPoint(ev.clientX, ev.clientY);
                if (!under || card.contains(under)) return;
                const target = under.closest('[data-lm-id]');
                if (target && target !== card && this.paneOf(target) === pane) {
                    const r = target.getBoundingClientRect();
                    if (ev.clientY < r.top + r.height / 2) target.before(card);
                    else target.after(card);
                    return;
                }
                // Hovering a (possibly empty) zone's free space: append.
                const zone = under.closest('[data-lm-zone]');
                if (zone && this.paneOf(zone) === pane && !target) {
                    const cards = this.cardsIn(zone);
                    const last = cards[cards.length - 1];
                    if (
                        !last ||
                        ev.clientY > last.getBoundingClientRect().bottom
                    )
                        zone.appendChild(card);
                }
            };
            const onUp = () => {
                cancelAnimationFrame(raf);
                card.classList.remove('lm-dragging');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                this.persistPaneOrder(pane);
                this.resizeCharts(card);
            };
            // On window rather than the handle so the drag keeps tracking
            // even where pointer capture isn't honored.
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        });
    },

    // ── Dashboard widgets ───────────────────────────────────────────────
    dashZones() {
        return this.paneZones(document.getElementById(DASH_TAB));
    },

    // Shortest Dashboard column, so new widgets balance the layout.
    targetDashZone() {
        const zones = this.dashZones();
        return zones.reduce(
            (best, z) =>
                z.getBoundingClientRect().height <
                best.getBoundingClientRect().height
                    ? z
                    : best,
            zones[0],
        );
    },

    placeholderFor(id) {
        return document.querySelector(
            `.lm-placeholder[data-lm-placeholder-for="${CSS.escape(id)}"]`,
        );
    },

    borrow(id, { persist = true, zoneKey = null } = {}) {
        const entry = this.cards.get(id);
        if (!entry || entry.pane.id === DASH_TAB || this.placeholderFor(id))
            return;
        const ph = document.createElement('div');
        ph.className = 'card glass-card lm-placeholder';
        ph.dataset.lmPlaceholderFor = id;
        const tabName =
            document.querySelector(
                `.nav-btn[data-tab="${DASH_TAB.replace('tab-', '')}"] .nav-label`,
            )?.textContent || 'Dashboard';
        ph.innerHTML = `<p>📌 <strong></strong> is pinned to your ${escHtml(tabName)}.</p>
            <div class="lm-placeholder-actions">
                <button type="button" class="action-btn" data-lm-ph="go">Go to Dashboard</button>
                <button type="button" class="action-btn" data-lm-ph="back">Move back here</button>
            </div>`;
        ph.querySelector('strong').textContent = entry.title;
        ph.addEventListener('click', (e) => {
            const act = e.target.closest('[data-lm-ph]')?.dataset.lmPh;
            if (act === 'go')
                document.getElementById('btn-tab-dashboard')?.click();
            else if (act === 'back') this.returnHome(id);
        });
        entry.el.before(ph);
        const zone =
            (zoneKey && this.zones.get(zoneKey)) || this.targetDashZone();
        zone.appendChild(entry.el);
        entry.el.classList.add('lm-borrowed');
        this.resizeCharts(entry.el);
        if (!persist) return;
        this.layout.borrowed[id] = zone.dataset.lmZone;
        this.persistPaneOrder(document.getElementById(DASH_TAB));
    },

    returnHome(id) {
        const entry = this.cards.get(id);
        const ph = this.placeholderFor(id);
        if (!entry || !ph) return;
        ph.replaceWith(entry.el);
        entry.el.classList.remove('lm-borrowed');
        delete this.layout.borrowed[id];
        this.persistPaneOrder(entry.pane);
        this.persistPaneOrder(document.getElementById(DASH_TAB));
        this.resizeCharts(entry.el);
    },

    removeFromDashboard(id) {
        const entry = this.cards.get(id);
        if (!entry) return;
        if (entry.pane.id !== DASH_TAB) {
            this.returnHome(id);
            return;
        }
        entry.el.classList.add('lm-hidden');
        if (!this.layout.hidden.includes(id)) this.layout.hidden.push(id);
        this.save();
        this.syncDashCustomClass();
    },

    restoreDashCard(id) {
        const entry = this.cards.get(id);
        if (!entry) return;
        entry.el.classList.remove('lm-hidden');
        this.layout.hidden = this.layout.hidden.filter((h) => h !== id);
        this.save();
        this.syncDashCustomClass();
        this.resizeCharts(entry.el);
    },

    // The ≥1400px dashboard dissolves its columns into a fixed CSS-order
    // grid; once the user arranges cards themselves, keep the two columns
    // so what they arranged is what they see.
    syncDashCustomClass() {
        const body = document.querySelector('#tab-dashboard .dashboard-body');
        if (!body) return;
        const dashKeys = this.dashZones().map((z) => z.dataset.lmZone);
        const custom =
            this.editingPane?.id === DASH_TAB ||
            dashKeys.some((k) => this.layout.order[k]) ||
            Object.keys(this.layout.borrowed).length > 0 ||
            this.layout.hidden.length > 0;
        body.classList.toggle('lm-custom', custom);
    },

    // ── Widget picker (Dashboard) ───────────────────────────────────────
    openPicker() {
        this.closePicker();
        const overlay = document.createElement('div');
        overlay.className = 'lm-picker-overlay';
        overlay.innerHTML = `<div class="lm-picker" role="dialog" aria-modal="true" aria-labelledby="lm-picker-title">
            <div class="lm-picker-head">
                <h2 id="lm-picker-title">Add widgets to your Dashboard</h2>
                <button type="button" class="lm-btn" data-lm-close aria-label="Close">✕</button>
            </div>
            <p class="text-muted lm-picker-hint">Pinned cards move to the Dashboard and leave a link behind on their home tab.</p>
            <div class="lm-picker-body"></div>
        </div>`;
        const body = overlay.querySelector('.lm-picker-body');
        const groups = new Map();
        this.cards.forEach((entry, id) => {
            const isDash = entry.pane.id === DASH_TAB;
            if (isDash && !this.layout.hidden.includes(id)) return;
            const tab = entry.pane.id.replace(/^tab-/, '');
            const group = isDash
                ? 'Removed from Dashboard'
                : document.querySelector(
                      `.nav-btn[data-tab="${tab}"] .nav-label`,
                  )?.textContent || tab;
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
                const pinned = !isDash && !!this.placeholderFor(id);
                const row = document.createElement('div');
                row.className = 'lm-picker-row';
                const name = document.createElement('span');
                name.textContent = entry.title;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = pinned ? 'action-btn' : 'primary-btn';
                btn.textContent = pinned ? 'Remove' : 'Add';
                btn.addEventListener('click', () => {
                    if (isDash) this.restoreDashCard(id);
                    else if (pinned) this.returnHome(id);
                    else this.borrow(id);
                    this.openPicker(); // re-render with new state
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
            if (e.key === 'Escape') this.closePicker();
        });
        document.body.appendChild(overlay);
        overlay.querySelector('[data-lm-close]').focus();
    },

    closePicker() {
        document.querySelector('.lm-picker-overlay')?.remove();
    },

    // ── Per-tab toolbar + edit mode ─────────────────────────────────────
    addToolbars() {
        document.querySelectorAll('.tab-pane').forEach((pane) => {
            if (!pane.querySelector('[data-lm-zone]')) return;
            const isDash = pane.id === DASH_TAB;
            const bar = document.createElement('div');
            bar.className = 'lm-toolbar';
            bar.innerHTML = `
                <span class="lm-hint">Drag ⠿ or use ↑ ↓ to reorder · click a title to collapse</span>
                ${isDash ? '<button type="button" class="lm-tool-btn" data-lm-tool="add">＋ Add widget</button>' : ''}
                <button type="button" class="lm-tool-btn" data-lm-tool="reset">↺ Reset</button>
                <button type="button" class="lm-tool-btn lm-tool-edit" data-lm-tool="edit" aria-pressed="false">✎ Customize</button>`;
            bar.addEventListener('click', (e) => {
                const tool = e.target.closest('[data-lm-tool]')?.dataset.lmTool;
                if (tool === 'edit') this.toggleEdit(pane);
                else if (tool === 'add') this.openPicker();
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
        this.editingPane = on ? pane : null;
        if (on) {
            pane.classList.add('lm-editing');
            const b = pane.querySelector('.lm-tool-edit');
            b.textContent = '✓ Done';
            b.setAttribute('aria-pressed', 'true');
        }
        this.syncDashCustomClass();
        this.resizeCharts(pane);
    },

    resetPane(pane) {
        if (
            !confirm(
                'Reset this tab to its default card order and expand every card?',
            )
        )
            return;
        const isDash = pane.id === DASH_TAB;
        if (isDash) {
            Object.keys(this.layout.borrowed).forEach((id) =>
                this.returnHome(id),
            );
            [...this.layout.hidden].forEach((id) => this.restoreDashCard(id));
        } else {
            // Cards from this tab pinned to the Dashboard come home too.
            Object.keys(this.layout.borrowed).forEach((id) => {
                if (this.cards.get(id)?.pane === pane) this.returnHome(id);
            });
        }
        this.paneZones(pane).forEach((zone) => {
            const key = zone.dataset.lmZone;
            (this.initialOrder.get(key) || []).forEach((id) => {
                const entry = this.cards.get(id);
                if (entry && !this.placeholderFor(id))
                    zone.appendChild(entry.el);
            });
            delete this.layout.order[key];
        });
        this.cards.forEach((entry, id) => {
            if (this.paneOf(entry.el) === pane)
                this.setCollapsed(id, false, false);
            if (entry.pane === pane) delete this.layout.collapsed[id];
        });
        this.save();
        this.syncDashCustomClass();
        this.resizeCharts(pane);
    },

    init() {
        this.layout = loadLayout();
        this.register();
        this.addToolbars();
        // Restore: pinned widgets first (they change which tab a card is
        // on), then order, then collapsed/removed state.
        Object.entries(this.layout.borrowed).forEach(([id, zoneKey]) => {
            if (this.cards.has(id))
                this.borrow(id, { persist: false, zoneKey });
            else delete this.layout.borrowed[id];
        });
        this.applyOrder();
        Object.keys(this.layout.collapsed).forEach((id) => {
            if (this.cards.has(id)) this.setCollapsed(id, true, false);
        });
        this.layout.hidden = this.layout.hidden.filter((id) =>
            this.cards.has(id),
        );
        this.layout.hidden.forEach((id) =>
            this.cards.get(id).el.classList.add('lm-hidden'),
        );
        this.syncDashCustomClass();

        // Charts in pinned widgets were sized while their tab was hidden.
        document
            .getElementById('btn-tab-dashboard')
            ?.addEventListener('click', () =>
                document
                    .querySelectorAll('.lm-borrowed')
                    .forEach((c) => this.resizeCharts(c)),
            );
    },
};

function initLayoutManager() {
    LayoutManager.init();
}
window.LayoutManager = LayoutManager;
