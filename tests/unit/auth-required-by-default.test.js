'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

// PROD Phase 3 (docs/security-hardening.md, H-04): FIRE_API_KEY is required
// by default -- the server must fail fast unless FIRE_API_KEY is set, or the
// FIRE_AUTH_DISABLED=true opt-out is used instead. This can't be exercised
// against the shared `app` instance the other server test files import
// (module-load-time fail-fast + process.exit would kill the whole worker),
// so each case spawns a fresh `node -e "require('.../server.js')"` process.
// require.main !== module inside a `-e` script, so this only runs the
// synchronous fail-fast checks at the top of server.js -- it never binds a
// port or hangs waiting for a listener.
const SERVER_PATH = path.join(__dirname, '..', '..', 'app', 'server.js');
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-auth-default-test-${process.pid}.json`,
);

afterAll(() => {
    for (const f of [TEST_DB, `${TEST_DB}.tmp`]) {
        try {
            fs.unlinkSync(f);
        } catch {
            /* ignore */
        }
    }
});

function baseEnv(overrides = {}) {
    const env = { ...process.env };
    delete env.FIRE_API_KEY;
    delete env.FIRE_AUTH_DISABLED;
    env.FIRE_DB_FILE = TEST_DB;
    return Object.assign(env, overrides);
}

// Generous timeout: this spawns a real node process that requires express,
// express-session, express-rate-limit, etc. from scratch. Under a
// bind-mounted Docker volume (e.g. Docker Desktop on Windows) that cold
// module resolution can take several seconds — well past vitest's default
// 5s test timeout, and spawnSync's own `timeout` kills the child (leaving
// stderr empty) if set too low.
const SPAWN_TIMEOUT_MS = 45000;
const TEST_TIMEOUT_MS = 60000;

function requireServer(env) {
    return spawnSync(
        process.execPath,
        ['-e', `require(${JSON.stringify(SERVER_PATH)});`],
        { env, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
    );
}

describe('FIRE_API_KEY required by default (fail-fast)', () => {
    it(
        'exits non-zero with guidance when neither FIRE_API_KEY nor FIRE_AUTH_DISABLED is set',
        () => {
            const result = requireServer(baseEnv());
            expect(result.status).not.toBe(0);
            expect(result.stderr).toMatch(/FIRE_API_KEY/);
            expect(result.stderr).toMatch(/FIRE_AUTH_DISABLED/);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'starts cleanly when FIRE_API_KEY is set',
        () => {
            const result = requireServer(
                baseEnv({ FIRE_API_KEY: 'a-test-key-value' }),
            );
            expect(result.status).toBe(0);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'starts cleanly with no key when FIRE_AUTH_DISABLED=true',
        () => {
            const result = requireServer(
                baseEnv({ FIRE_AUTH_DISABLED: 'true' }),
            );
            expect(result.status).toBe(0);
        },
        TEST_TIMEOUT_MS,
    );
});
