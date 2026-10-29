import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// fixed-income.js and html-utils.js are classic browser scripts, so load them into a stubbed context.
const APP_LIB = path.join(__dirname, '../../app/lib');
const load = (...files) => {
    const tbody = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = {
        state: { importedFiles: [], customAccounts: [], cds: [] },
        document: { querySelector: () => tbody },
    };
    vm.createContext(ctx);
    for (const f of files)
        vm.runInContext(fs.readFileSync(path.join(APP_LIB, f), 'utf8'), ctx);
    return { ctx, tbody };
};

describe('renderImportedFilesTable', () => {
    it('escapes imported file name, source and date instead of injecting markup', () => {
        const { ctx, tbody } = load('html-utils.js', 'tables/fixed-income.js');
        ctx.state.importedFiles = [
            {
                name: '<img src=x onerror=alert(1)>.csv',
                source: '"><script>1</script>',
                date: '" onmouseover="x',
                records: 3,
            },
        ];
        vm.runInContext('renderImportedFilesTable()', ctx);
        expect(tbody.innerHTML).not.toContain('<img');
        expect(tbody.innerHTML).not.toContain('<script');
        expect(tbody.innerHTML).not.toContain('" onmouseover=');
        expect(tbody.innerHTML).toContain(
            '&lt;img src=x onerror=alert(1)&gt;.csv',
        );
    });

    it('still renders ordinary file rows', () => {
        const { ctx, tbody } = load('html-utils.js', 'tables/fixed-income.js');
        ctx.state.importedFiles = [
            {
                name: 'chase.csv',
                source: 'Chase',
                date: '2026-01-02',
                records: 12,
            },
        ];
        vm.runInContext('renderImportedFilesTable()', ctx);
        expect(tbody.innerHTML).toContain('chase.csv');
        expect(tbody.innerHTML).toContain('Chase');
        expect(tbody.innerHTML).toContain('>12<');
    });
});
