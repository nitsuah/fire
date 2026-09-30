'use strict';

const fs = require('fs');
const path = require('path');
const APP_DIR = path.join(__dirname, '../../app');
const read = (file) => fs.readFileSync(path.join(APP_DIR, file), 'utf8');

describe('CSP hardening', () => {
    it('does not allow unsafe-inline in the server CSP', () => {
        expect(read('server.js')).not.toContain("'unsafe-inline'");
    });

    it('does not allow unsafe-inline in the Netlify CSP', () => {
        expect(read('_headers')).not.toContain("'unsafe-inline'");
    });

    it('keeps the static app free of inline handlers and style attributes', () => {
        const index = read('index.html');
        expect(index).not.toMatch(/\\bon(?:click|change)\\s*=/i);
        expect(index).not.toMatch(/\\bstyle\\s*=/i);
        expect(index).not.toMatch(/<script>(?!\\s*<\\/script>)[\\s\\S]*?<\\/script>/i);
    });

    it('keeps migrated runtime renderers free of inline handlers and styles', () => {
        const files = [
            'lib/charts/allocation.js',
            'lib/tables/dashboard.js',
            'lib/tables/fixed-income.js',
            'lib/tables/positions.js',
            'lib/tables/real-estate.js',
            'lib/tables/vehicles.js',
        ];
        for (const file of files) {
            const source = read(file);
            expect(source).not.toMatch(/\\bon(?:click|change)\\s*=/i);
            expect(source).not.toMatch(/\\bstyle\\s*=/i);
        }
    });
});
