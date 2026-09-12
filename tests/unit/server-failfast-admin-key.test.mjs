import { describe, it, expect, vi, afterAll } from 'vitest';

// PROD Phase 3 (docs/security-hardening.md): server.js fails fast with
// process.exit(1) when FIRE_ADMIN_KEY is unset AND NODE_ENV=production,
// since the key-rotation endpoint (POST /api/admin/rotate-key) would
// otherwise be unreachable/unprotectable in production. This branch
// (app/server.js lines ~66-70) had no coverage at all — it's untestable via
// the shared `app` instance other suites import (a real process.exit there
// would kill the whole test worker), so it needs its own dedicated,
// env-controlled import with process.exit mocked, matching the pattern in
// server-failfast-session-secret.test.mjs and server-failfast-api-key.test.mjs.
const ORIGINAL_ENV = { ...process.env };

afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('server.js fail-fast — FIRE_ADMIN_KEY required in production', () => {
    it('calls process.exit(1) when FIRE_ADMIN_KEY is unset in production', async () => {
        process.env.NODE_ENV = 'production';
        // Avoid tripping the other two fail-fast checks so only the
        // FIRE_ADMIN_KEY branch under test can fire.
        process.env.SESSION_SECRET = 'a-strong-non-placeholder-secret';
        process.env.FIRE_API_KEY = 'a-test-api-key-value';
        delete process.env.FIRE_AUTH_DISABLED;
        delete process.env.FIRE_ADMIN_KEY;

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`__PROCESS_EXIT_${code}__`);
        });
        const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await expect(import('../../app/server.js')).rejects.toThrow(
            '__PROCESS_EXIT_1__',
        );

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('FIRE_ADMIN_KEY must be set in production'),
        );

        exitSpy.mockRestore();
    });
});
