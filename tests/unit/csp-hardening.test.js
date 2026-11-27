'use strict';

const fs = require('fs');
const path = require('path');
const APP_DIR = path.join(__dirname, '../../app');
const read = (file) => fs.readFileSync(path.join(APP_DIR, file), 'utf8');

function cspSources(headers, directive) {
    const policy = headers.match(
        /^\s*Content-Security-Policy:\s*([^\r\n]+)/im,
    )?.[1];
    if (!policy) throw new Error('Content-Security-Policy header is missing');
    const directives = new Map();
    for (const part of policy.split(';')) {
        const [name, ...sources] = part.trim().split(/\s+/);
        const key = name.toLowerCase();
        if (key && !directives.has(key)) directives.set(key, sources);
    }
    const effectiveSources =
        directives.get(directive) ?? directives.get('default-src');
    if (!effectiveSources) {
        throw new Error(
            `CSP directive ${directive} and default-src are missing`,
        );
    }
    return effectiveSources;
}

describe('CSP hardening', () => {
    it('does not allow unsafe-inline in the server CSP', () => {
        expect(read('server.js')).not.toContain("'unsafe-inline'");
    });

    it('does not allow unsafe-inline in the Netlify CSP', () => {
        expect(read('_headers')).not.toContain("'unsafe-inline'");
    });

    it('blocks Cloudflare Web Analytics in script-src', () => {
        const sources = cspSources(read('_headers'), 'script-src');
        expect(sources).not.toContain('https://static.cloudflareinsights.com');
        expect(sources).not.toContain('https:');
        expect(sources).not.toContain('*');
        expect(sources).not.toContain('*.cloudflareinsights.com');
    });

    it('blocks Cloudflare Web Analytics in connect-src', () => {
        const sources = cspSources(read('_headers'), 'connect-src');
        expect(sources).not.toContain('https://cloudflareinsights.com');
        expect(sources).not.toContain('https:');
        expect(sources).not.toContain('*');
        expect(sources).not.toContain('https://*.cloudflareinsights.com');
    });

    it('keeps the static app free of inline handlers and style attributes', () => {
        const index = read('index.html');
        expect(index).not.toMatch(/\bon(?:click|change)\s*=/i);
        expect(index).not.toMatch(/\bstyle\s*=/i);
        expect(index).not.toMatch(
            /<script>(?!\s*<\/script>)[\s\S]*?<\/script>/i,
        );
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
            expect(source).not.toMatch(/\bon(?:click|change)\s*=/i);
            expect(source).not.toMatch(/\bstyle\s*=/i);
        }
    });
});
