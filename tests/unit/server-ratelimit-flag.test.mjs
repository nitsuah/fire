import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// FIRE_RATE_LIMIT_DISABLED turns the /api limiters off for the Playwright
// UI suite's own server (config/playwright.config.js), which outruns the
// 300/min general limit. It only works with NODE_ENV explicitly test or
// development: unset, production or anything else keeps the limits.
// app/server.js reads env at load, so each case re-imports it.
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-ratelimit-flag-test-${process.pid}.json`,
);
const ENV_KEYS = [
    'FIRE_DB_FILE',
    'FIRE_AUTH_DISABLED',
    'SESSION_SECRET',
    'FIRE_ADMIN_KEY',
    'NODE_ENV',
    'FIRE_RATE_LIMIT_DISABLED',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

fs.writeFileSync(TEST_DB, JSON.stringify({ customAccounts: [] }));

beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.FIRE_DB_FILE = TEST_DB;
    process.env.FIRE_AUTH_DISABLED = 'true';
    process.env.SESSION_SECRET = 'a-strong-non-placeholder-secret';
    delete process.env.NODE_ENV;
    delete process.env.FIRE_ADMIN_KEY;
    delete process.env.FIRE_RATE_LIMIT_DISABLED;
});

afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    fs.rmSync(TEST_DB, { force: true });
});

// One past the general limit (300 requests per minute per client).
async function statusesAfterBurst() {
    const { default: app } = await import('../../app/server.js');
    const agent = request(app);
    let last;
    for (let i = 0; i < 301; i++) last = await agent.get('/api/state');
    return { last: last.status, warned: console.warn.mock.calls.flat() };
}

describe('FIRE_RATE_LIMIT_DISABLED', () => {
    it('rate limiting applies when the flag is unset', async () => {
        const { last } = await statusesAfterBurst();
        expect(last).toBe(429);
    });

    it.each(['test', 'development'])(
        'turns the limiter off (with a warning) when NODE_ENV=%s',
        async (env) => {
            process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
            process.env.NODE_ENV = env;
            const { last, warned } = await statusesAfterBurst();
            expect(last).toBe(200);
            expect(warned.join(' ')).toMatch(/rate limiting is off/);
        },
    );

    it.each([
        ['unset', undefined],
        ['production', 'production'],
        ['misspelled', 'prodution'],
        ['staging', 'staging'],
    ])('is ignored when NODE_ENV is %s', async (_label, env) => {
        process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
        if (env) process.env.NODE_ENV = env;
        if (env === 'production') process.env.FIRE_ADMIN_KEY = 'test-admin-key';
        const { last, warned } = await statusesAfterBurst();
        expect(last).toBe(429);
        expect(warned.join(' ')).toMatch(/ignored unless NODE_ENV is test/);
    });

    it('only the exact value "true" disables it', async () => {
        process.env.NODE_ENV = 'test';
        process.env.FIRE_RATE_LIMIT_DISABLED = '1';
        const { last } = await statusesAfterBurst();
        expect(last).toBe(429);
    });
});
