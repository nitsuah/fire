import { describe, expect, it, vi, afterEach } from 'vitest';

describe('fetchJson', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns structured JSON errors for HTML responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('<!DOCTYPE html><html>404</html>', {
                    status: 404,
                    headers: { 'content-type': 'text/html' },
                }),
            ),
        );

        const { fetchJson } = await import('../../app/lib/fetch-utils.js');
        const result = await fetchJson('/api/missing');

        expect(result.ok).toBe(false);
        expect(result.status).toBe(404);
        expect(result.data.error).toContain(
            'Server returned a non-JSON response (HTTP 404)',
        );
        expect(result.data.error).toContain('<!DOCTYPE html>');
    });

    it('returns parsed JSON without changing successful responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ connected: false }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );

        const { fetchJson } = await import('../../app/lib/fetch-utils.js');
        const result = await fetchJson('/api/status');

        expect(result).toEqual({
            ok: true,
            status: 200,
            data: { connected: false },
        });
    });
});
