import {
    describe,
    expect,
    it,
    vi,
    beforeEach,
    afterEach,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MASTER_KEY = '22'.repeat(32);

describe('hosted Plaid Netlify function', () => {
    beforeEach(() => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        process.env.PLAID_ENV = 'sandbox';
        process.env.SYNC_MASTER_KEY = MASTER_KEY;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.SYNC_MASTER_KEY;
        vi.resetModules();
    });

    it('creates a Link token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ link_token: 'link-sandbox' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ linkToken: 'link-sandbox' });
    });

    it('exchanges a public token into an encrypted browser token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        access_token: 'access-secret',
                        item_id: 'item-1',
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/exchange',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ public_token: 'public-sandbox' }),
                },
            ),
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.status).toBe('success');
        expect(body.plaidToken).toMatch(/^1\./);
        expect(body.plaidToken).not.toContain('access-secret');
    });

    it('surfaces structured Plaid error metadata', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        error_code: 'INVALID_INPUT',
                        error_message: 'Invalid sandbox request.',
                        request_id: 'req-test-123',
                    }),
                    {
                        status: 400,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({
            error: 'Invalid sandbox request.',
            code: 'INVALID_INPUT',
            requestId: 'req-test-123',
        });
    });

    it('converts non-JSON Plaid failures to JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('Bad request', {
                    status: 400,
                    headers: { 'content-type': 'text/plain' },
                }),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );

        expect(response.status).toBe(502);
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
        expect((await response.json()).error).toContain(
            'Plaid returned a non-JSON response',
        );
    });
});

describe('Netlify routing', () => {
    it('preserves the Plaid route splat when rewriting to the function', () => {
        const netlifyToml = fs.readFileSync(
            path.join(process.cwd(), 'netlify.toml'),
            'utf8',
        );
        expect(netlifyToml).toContain(
            'to = "/.netlify/functions/plaid/:splat"',
        );
    });
});
