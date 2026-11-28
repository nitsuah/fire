import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
    new URL('../../app/lib/etsy-sync.js', import.meta.url),
    'utf8',
);

// Renders the card against an unconfigured backend and returns its text.
async function renderUnconfigured(browserOnly) {
    const status = { textContent: '', style: {} };
    const context = {
        document: {
            querySelectorAll: (selector) =>
                selector === '.etsy-status' ? [status] : [],
        },
        localStorage: { getItem: () => null },
        state: {},
        isBrowserOnlyModeAsync: async () => browserOnly,
        fetch: async () => ({
            ok: true,
            json: async () => ({ configured: false }),
        }),
    };
    vm.runInNewContext(source, context);
    await context.renderEtsyStatus();
    return status.textContent;
}

describe('renderEtsyStatus without Etsy credentials', () => {
    it('hosted: says unavailable and names no server settings', async () => {
        expect(await renderUnconfigured(true)).toBe(
            'Status: Etsy is not available on the hosted site',
        );
    });

    it('self-hosted: keeps the configuration message', async () => {
        expect(await renderUnconfigured(false)).toContain(
            'not configured on this deployment (ETSY_CLIENT_ID',
        );
    });
});
