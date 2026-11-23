import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const source = (name) =>
    fs.readFileSync(new URL('../../app/lib/' + name, import.meta.url), 'utf8');

function makeContext(overrides = {}) {
    const listEl = { innerHTML: '' };
    const stubs = {
        document: {
            getElementById: (id) =>
                id === 'wallet-manager-list' ? listEl : null,
            addEventListener: vi.fn(),
        },
        fetchJson: vi.fn(async () => ({ ok: true, data: { wallets: [] } })),
        escHtml: (s) => String(s),
        console,
    };
    if (overrides.FireDeployMode !== undefined) {
        stubs.FireDeployMode = overrides.FireDeployMode;
    }
    return {
        context: vm.createContext(stubs),
        listEl,
        fetchJson: stubs.fetchJson,
    };
}

describe('loadWallets hosted behavior', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('hosted: does not call fetchJson and shows note', async () => {
        const { context, listEl, fetchJson } = makeContext({
            FireDeployMode: { whenKnown: async () => true },
        });
        vm.runInContext(source('managers/wallets.js'), context);
        await context.loadWallets();
        expect(fetchJson).not.toHaveBeenCalled();
        expect(listEl.innerHTML).toMatch(
            /wallet tracking needs the self-hosted server/i,
        );
    });

    it('self-hosted: calls fetchJson once', async () => {
        const { context, fetchJson } = makeContext({
            FireDeployMode: { whenKnown: async () => false },
        });
        vm.runInContext(source('managers/wallets.js'), context);
        await context.loadWallets();
        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(fetchJson).toHaveBeenCalledWith('/api/wallets');
    });

    it('unknown: calls fetchJson once', async () => {
        const { context, fetchJson } = makeContext({
            FireDeployMode: { whenKnown: async () => null },
        });
        vm.runInContext(source('managers/wallets.js'), context);
        await context.loadWallets();
        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(fetchJson).toHaveBeenCalledWith('/api/wallets');
    });

    it('FireDeployMode absent: calls fetchJson once', async () => {
        const { context, fetchJson } = makeContext({});
        vm.runInContext(source('managers/wallets.js'), context);
        await context.loadWallets();
        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(fetchJson).toHaveBeenCalledWith('/api/wallets');
    });
});
