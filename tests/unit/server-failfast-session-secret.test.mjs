import { describe, it, expect, vi, afterAll } from 'vitest';

// PROD Phase 3 (docs/security-hardening.md): server.js fails fast with
// process.exit(1) when SESSION_SECRET is unset (or left at the placeholder)
// AND NODE_ENV=production. tests/unit/auth-required-by-default.test.js
// exercises the sibling FIRE_API_KEY fail-fast via a spawned subprocess,
// which is correct for behavior but earns no coverage credit for the parent
// test process. This file instead imports server.js in-process, with
// process.exit/console.error mocked so the module's synchronous top-level
// throw can be caught, giving real branch/function coverage for the
// production fail-fast path in app/server.js (lines ~34-39).
const ORIGINAL_ENV = { ...process.env };

afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('server.js fail-fast — SESSION_SECRET required in production', () => {
    it('calls process.exit(1) when SESSION_SECRET is unset in production', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.SESSION_SECRET;
        // Avoid tripping the *other* fail-fast checks so this test isolates
        // the SESSION_SECRET branch specifically.
        process.env.FIRE_AUTH_DISABLED = 'true';
        process.env.FIRE_ADMIN_KEY = 'test-admin-key-for-session-secret-test';

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
            expect.stringContaining(
                'SESSION_SECRET must be set to a strong random value in production',
            ),
        );

        exitSpy.mockRestore();
    });
});
