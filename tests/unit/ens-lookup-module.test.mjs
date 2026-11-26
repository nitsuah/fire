import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ENS lookup native module wiring', () => {
    it('imports fetchJson instead of relying on the window bridge', () => {
        const source = readFileSync(new URL('../../app/lib/managers/ens-lookup.js', import.meta.url), 'utf8');
        expect(source.startsWith("import { fetchJson } from '../fetch-utils.js';")).toBe(true);
        expect(source).toContain('await fetchJson(');
    });

    it('loads after fetch-utils.js as a native module', () => {
        const html = readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8');
        const fetchTag = '<script type="module" src="lib/fetch-utils.js"></script>';
        const ensTag = '<script type="module" src="lib/managers/ens-lookup.js"></script>';
        expect(html).toContain(fetchTag);
        expect(html).toContain(ensTag);
        expect(html.indexOf(fetchTag)).toBeLessThan(html.indexOf(ensTag));
    });
});
