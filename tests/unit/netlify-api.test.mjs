import { describe, expect, it } from 'vitest';
import { handler } from '../../netlify/functions/fire-api.mjs';

describe('hosted fire API', () => {
    it('returns JSON for unsupported hosted endpoints', async () => {
        const result = await handler(
            new Request(
                'https://lifefire.netlify.app/api/does-not-exist',
            ),
        );

        expect(result.status).toBe(404);
        expect(result.headers.get('Content-Type')).toContain('application/json');

        const body = await result.json();
        expect(body.error).toContain(
            'not available in the hosted browser deployment',
        );
        expect(body.path).toBe('/api/does-not-exist');
    });

    it('returns a JSON Plaid status in hosted mode', async () => {
        const result = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/status',
            ),
        );

        expect(result.status).toBe(200);
        const body = await result.json();
        expect(body).toMatchObject({
            connected: false,
            hosted: true,
        });
    });
});
