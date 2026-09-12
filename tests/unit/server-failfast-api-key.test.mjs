import { describe, it, expect, vi, afterAll } from 'vitest';

// PROD Phase 3 (docs/security-hardening.md, H-04): server.js fails fast with
// process.exit(1) when neither FIRE_API_KEY nor FIRE_AUTH_DISABLED=true is
// set. tests/unit/auth-required-by-default.test.js already verifies this
// behavior end-to-end via a spawned subprocess (deliberately, since a real
// process.exit() would otherwise kill the whole vitest worker), but a
// subprocess's execution isn't attributed to this process's coverage
// instrumentation. This file re-covers the same branch in-process with
// process.exit mocked, so app/server.js's fail-fast branch (lines ~52-58)
// actually counts toward branch/function coverage.
const ORIGINAL_ENV = { ...process.env };

afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('server.js fail-fast — FIRE_API_KEY required by default', () => {
    it('calls process.exit(1) when FIRE_API_KEY and FIRE_AUTH_DISABLED are both unset', async () => {
        // Keep NODE_ENV non-production and give SESSION_SECRET a real value
        // so only the FIRE_API_KEY branch under test can fire.
        process.env.NODE_ENV = 'test';
        process.env.SESSION_SECRET = 'a-strong-non-placeholder-secret';
        delete process.env.FIRE_API_KEY;
        delete process.env.FIRE_AUTH_DISABLED;

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
            expect.stringContaining('FIRE_API_KEY must be set'),
        );

        exitSpy.mockRestore();
    });
});
