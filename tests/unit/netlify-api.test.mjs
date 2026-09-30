import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import handler from '../../netlify/functions/fire-api.mjs';

describe('hosted fire API', () => {
    it('returns JSON for unsupported hosted endpoints', async () => {
        const result = await handler(
            new Request('https://lifefire.netlify.app/api/does-not-exist'),
        );

        expect(result.status).toBe(404);
        expect(result.headers.get('Content-Type')).toContain(
            'application/json',
        );

        const body = await result.json();
        expect(body.error).toContain(
            'not available in the hosted browser deployment',
        );
        expect(body.path).toBe('/api/does-not-exist');
    });

    it('routes /api/sync/plaid/* to the Plaid function before the generic fallback', () => {
        // Plaid is served by netlify/functions/plaid.mjs; fire-api.mjs must
        // never see those paths.
        const toml = fs.readFileSync(
            path.join(process.cwd(), 'netlify.toml'),
            'utf8',
        );
        const plaidRule = toml.indexOf('from = "/api/sync/plaid/*"');
        const fallbackRule = toml.indexOf('from = "/api/*"');
        expect(plaidRule).toBeGreaterThan(-1);
        expect(fallbackRule).toBeGreaterThan(plaidRule);
        expect(toml.slice(plaidRule, fallbackRule)).toContain(
            'to = "/.netlify/functions/plaid/:splat"',
        );
    });
});
