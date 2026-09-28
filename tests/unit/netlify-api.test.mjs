import { describe, expect, it } from 'vitest';
import { handler } from '../../netlify/functions/fire-api.mjs';

describe('hosted fire API', () => {
    it('returns JSON for unsupported hosted endpoints', async () => {
        const result = await handler({
            path: '/api/does-not-exist',
            httpMethod: 'GET',
            rawUrl: 'https://lifefire.netlify.app/api/does-not-exist',
        });

        expect(result.statusCode).toBe(404);
        expect(result.headers['Content-Type']).toContain('application/json');

        const body = JSON.parse(result.body);
        expect(body.error).toContain(
            'not available in the hosted browser deployment',
        );
        expect(body.path).toBe('/api/does-not-exist');
    });

    it('returns a JSON Plaid status in hosted mode', async () => {
        const result = await handler({
            path: '/api/sync/plaid/status',
            httpMethod: 'GET',
            rawUrl: 'https://lifefire.netlify.app/api/sync/plaid/status',
        });

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body).toMatchObject({
            connected: false,
            hosted: true,
        });
    });
});
