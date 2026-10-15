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
// Loads app/server.js with the current env and runs `fn(agent)` against a
// single listener (request(app) would start a server per request).
async function withServer(fn) {
    const { default: app } = await import('../../app/server.js');
    const server = app.listen(0);
    try {
        return await fn(request(server));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

// The limiter (standardHeaders: true) stamps RateLimit-* headers on every
// response it counts, so one request shows whether it is active.
async function limiterState() {
    return withServer(async (agent) => {
        const res = await agent.get('/api/state');
        return {
            active: Boolean(res.headers['ratelimit-limit']),
            warned: console.warn.mock.calls.flat(),
        };
    });
}

describe('FIRE_RATE_LIMIT_DISABLED', { timeout: 30_000 }, () => {
    it('rate limiting applies when the flag is unset (301st request is a 429)', async () => {
        const last = await withServer(async (agent) => {
            let res;
            for (let i = 0; i < 301; i++) res = await agent.get('/api/state');
            return res;
        });
        expect(last.status).toBe(429);
        expect(last.headers['ratelimit-limit']).toBe('300');
    });

    it.each(['test', 'development'])(
        'turns the limiter off (with a warning) when NODE_ENV=%s',
        async (env) => {
            process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
            process.env.NODE_ENV = env;
            const { active, warned } = await limiterState();
            expect(active).toBe(false);
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
        const { active, warned } = await limiterState();
        expect(active).toBe(true);
        expect(warned.join(' ')).toMatch(/ignored unless NODE_ENV is test/);
    });

    it('only the exact value "true" disables it', async () => {
        process.env.NODE_ENV = 'test';
        process.env.FIRE_RATE_LIMIT_DISABLED = '1';
        expect((await limiterState()).active).toBe(true);
    });
});
