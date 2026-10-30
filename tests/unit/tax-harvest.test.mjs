import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// Minimal escHtml used by the loaded module - kept simple for vitest parse compatibility
function escHtml(s) {
    return String(s)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, function () {
            return '&#39;';
        });
}

const APP_LIB = path.join(__dirname, '../../app/lib');
const loadScript = () => {
    const tbody = { innerHTML: '' };
    const summaryEl = { innerHTML: '', style: {} };
    const ctx = {
        state: {},
        formatCurrency: (v) => `$${v.toFixed(2)}`,
        escHtml,
        document: {
            getElementById: (id) => {
                if (id === 'tbody-tax-harvest') return tbody;
                if (id === 'tax-harvest-summary') return summaryEl;
                return null;
            },
        },
        window: {},
    };
    vm.createContext(ctx);
    const script = fs.readFileSync(
        path.join(APP_LIB, 'tables/tax-harvest.js'),
        'utf8',
    );
    vm.runInContext(script, ctx);
    return {
        ctx,
        tbody,
        summaryEl,
        renderTaxHarvestTable: ctx.window.renderTaxHarvestTable,
    };
};

describe('renderTaxHarvestTable XSS', () => {
    it('escapes untrusted taxRate in summaryEl when it contains script tag', () => {
        const { ctx, summaryEl, renderTaxHarvestTable } = loadScript();
        ctx.state = {
            importedPositions: [{ costBasis: 100, value: 50 }],
            taxRate: '<script>alert(1)</script>',
        };
        renderTaxHarvestTable();

        // Untrusted text should be escaped, not injected as raw markup
        expect(summaryEl.innerHTML).not.toContain('<script>');
        expect(summaryEl.innerHTML).toContain('&lt;script&gt;');
        expect(summaryEl.innerHTML).toContain('alert(1)');
    });

    it('renders ordinary taxRate correctly without escaping needed', () => {
        const { ctx, summaryEl, renderTaxHarvestTable } = loadScript();
        ctx.state = {
            importedPositions: [{ costBasis: 100, value: 50 }],
            taxRate: 20,
        };
        renderTaxHarvestTable();

        expect(summaryEl.innerHTML).toContain('20% rate');
        expect(summaryEl.innerHTML).not.toContain('<script>');
    });

    it('escapes untrusted taxRate containing semicolons and quotes in summaryEl', () => {
        const { ctx, summaryEl, renderTaxHarvestTable } = loadScript();
        ctx.state = {
            importedPositions: [{ costBasis: 100, value: 50 }],
            taxRate: '50%; "quote"',
        };
        renderTaxHarvestTable();

        expect(summaryEl.innerHTML).not.toContain('<script>');
        expect(summaryEl.innerHTML).toContain('50%; &quot;quote&quot;');
    });
});
