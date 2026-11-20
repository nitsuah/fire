import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { STEPS, quickStartProgress } = require('../../app/lib/quick-start.js');
const indexHtml = readFileSync(
    new URL('../../app/index.html', import.meta.url),
    'utf8',
);
const sidebarTabs = new Set(
    [...indexHtml.matchAll(/id="btn-tab-([^"]+)"/g)].map(([, tab]) => tab),
);

describe('quickStartProgress', () => {
    it('starts with nothing done and the required steps open', () => {
        const progress = quickStartProgress();
        expect(progress.doneCount).toBe(0);
        expect(progress.total).toBe(STEPS.length);
        expect(progress.requiredDone).toBe(false);
    });

    it('counts a step only when its fact is exactly true', () => {
        const progress = quickStartProgress({
            privacy: 'yes',
            accounts: 1,
            profile: true,
        });
        expect(
            progress.steps.filter((step) => step.done).map((step) => step.id),
        ).toEqual(['profile']);
    });

    it('completes required steps without requiring optional steps', () => {
        const progress = quickStartProgress({
            privacy: true,
            accounts: true,
            profile: true,
        });
        expect(progress.requiredDone).toBe(true);
        expect(progress.doneCount).toBe(3);
        expect(
            progress.steps.filter((step) => step.optional && step.done),
        ).toEqual([]);
    });

    it('keeps ids unique and links only to existing sidebar tabs', () => {
        expect(new Set(STEPS.map((step) => step.id)).size).toBe(STEPS.length);
        expect(
            STEPS.filter((step) => step.tab).every((step) =>
                sidebarTabs.has(step.tab),
            ),
        ).toBe(true);
    });
});

describe('quick start DOM contract', () => {
    const requiredIds = [
        'quick-start-card',
        'quick-start-title',
        'quick-start-progress',
        'quick-start-steps',
        'quick-start-dismiss',
        'quick-start-reopen',
    ];

    it('has all required element IDs in tab-dashboard', () => {
        for (const id of requiredIds) {
            expect(indexHtml).toContain(`id="${id}"`);
        }
    });

    it('card and reopen button start hidden', () => {
        expect(indexHtml).toContain('id="quick-start-card" hidden');
        expect(indexHtml).toContain('id="quick-start-reopen" hidden');
    });

    it('buttons have accessible names and aria-controls', () => {
        expect(indexHtml).toContain('aria-label="Dismiss Quick Start"');
        expect(indexHtml).toContain('aria-controls="quick-start-card"');
        expect(indexHtml).toContain('aria-label="Reopen Quick Start"');
    });

    it('loads quick-start.js model before app.js', () => {
        const modelIdx = indexHtml.indexOf('src="lib/quick-start.js"');
        const appIdx = indexHtml.indexOf('src="app.js"');
        expect(modelIdx).toBeGreaterThan(-1);
        expect(appIdx).toBeGreaterThan(-1);
        expect(modelIdx).toBeLessThan(appIdx);
    });
});

describe('quick start manager', () => {
    const {
        initQuickStart,
        CONSENT_KEY,
        DISMISS_KEY,
    } = require('../../app/lib/managers/quick-start.js');

    function setup(consented) {
        const store = new Map(consented ? [[CONSENT_KEY, '1']] : []);
        const mk = () => {
            const handlers = {};
            return {
                hidden: true,
                handlers,
                addEventListener: (type, fn) => (handlers[type] = fn),
            };
        };
        const clicked = [];
        const target = (id) => ({ click: () => clicked.push(id) });
        const list = {
            children: [],
            set textContent(_) {
                this.children = [];
            },
            appendChild(node) {
                this.children.push(node);
            },
        };
        const els = {
            'quick-start-card': mk(),
            'quick-start-reopen': mk(),
            'quick-start-dismiss': mk(),
            'quick-start-steps': list,
            'btn-nav-privacy': target('btn-nav-privacy'),
        };
        for (const tab of [
            'financial',
            'projections',
            'settings',
            'insights',
        ]) {
            els['btn-tab-' + tab] = target('btn-tab-' + tab);
        }
        globalThis.document = {
            getElementById: (id) => els[id] || null,
            createElement: (tag) => ({
                tag,
                handlers: {},
                children: [],
                addEventListener(type, fn) {
                    this.handlers[type] = fn;
                },
                appendChild(node) {
                    this.children.push(node);
                },
            }),
        };
        globalThis.FireQuickStart = { STEPS };
        globalThis.localStorage = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        };
        initQuickStart();
        return { els, store, list, clicked };
    }

    it('renders one button per step and each opens its tab', () => {
        const { list, clicked } = setup(true);
        const buttons = list.children.map((li) => li.children[0]);
        expect(buttons.map((b) => b.textContent)).toEqual(
            STEPS.map((s) => s.title),
        );
        buttons.forEach((b) => b.handlers.click());
        expect(clicked).toEqual(
            STEPS.map((s) => (s.tab ? 'btn-tab-' + s.tab : 'btn-nav-privacy')),
        );
    });

    it('refreshQuickStart shows the card once consent arrives, without new handlers', () => {
        const { els, store } = setup(false);
        expect(els['quick-start-card'].hidden).toBe(true);
        const dismissHandler = els['quick-start-dismiss'].handlers.click;
        store.set(CONSENT_KEY, '1');
        globalThis.refreshQuickStart();
        expect(els['quick-start-card'].hidden).toBe(false);
        expect(els['quick-start-dismiss'].handlers.click).toBe(dismissHandler);
    });

    it('registers the manager after the model and before app.js', () => {
        const modelIdx = indexHtml.indexOf('src="lib/quick-start.js"');
        const managerIdx = indexHtml.indexOf(
            'src="lib/managers/quick-start.js"',
        );
        const appIdx = indexHtml.indexOf('src="app.js"');
        expect(modelIdx).toBeGreaterThan(-1);
        expect(managerIdx).toBeGreaterThan(-1);
        expect(appIdx).toBeGreaterThan(-1);
        expect(modelIdx).toBeLessThan(managerIdx);
        expect(managerIdx).toBeLessThan(appIdx);
    });

    it('keeps the card and reopen button hidden before consent', () => {
        const { els } = setup(false);
        expect(els['quick-start-card'].hidden).toBe(true);
        expect(els['quick-start-reopen'].hidden).toBe(true);
    });

    it('shows the card after consent, dismisses and reopens', () => {
        const { els, store } = setup(true);
        expect(els['quick-start-card'].hidden).toBe(false);
        expect(els['quick-start-reopen'].hidden).toBe(true);
        els['quick-start-dismiss'].handlers.click();
        expect([...store.keys()].sort()).toEqual([CONSENT_KEY, DISMISS_KEY]);
        expect(store.get(DISMISS_KEY)).toBe('1');
        expect(els['quick-start-card'].hidden).toBe(true);
        expect(els['quick-start-reopen'].hidden).toBe(false);
        els['quick-start-reopen'].handlers.click();
        expect(store.has(DISMISS_KEY)).toBe(false);
        expect(els['quick-start-card'].hidden).toBe(false);
        expect(els['quick-start-reopen'].hidden).toBe(true);
    });
});
