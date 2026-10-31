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
