import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import request from 'supertest';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-auth-limiter-'));
const ENV_KEYS = [
    'FIRE_DATA_DIR',
    'FIRE_DB_FILE',
    'FIRE_API_KEY',
    'FIRE_ADMIN_KEY',
    'FIRE_AUTH_DISABLED',
    'SESSION_SECRET',
    'NODE_ENV',
    'FIRE_RATE_LIMIT_DISABLED',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.FIRE_DATA_DIR = DATA_DIR;
    process.env.FIRE_DB_FILE = path.join(DATA_DIR, 'db.json');
    process.env.FIRE_API_KEY = 'right-key';
    process.env.FIRE_ADMIN_KEY = 'admin-key';
    process.env.SESSION_SECRET = 'a-strong-non-placeholder-secret';
    delete process.env.FIRE_AUTH_DISABLED;
    delete process.env.NODE_ENV;
    delete process.env.FIRE_RATE_LIMIT_DISABLED;
});

afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function withServer(fn) {
    const { default: app } = await import('../../app/server.js');
    const server = app.listen(0, '127.0.0.1');
    try {
        return await fn(request(server));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

describe('API key gate and limiter order', () => {
    it('counts rejected requests against the limiter', async () => {
        await withServer(async (agent) => {
            const res = await agent.get('/api/state').set('x-api-key', 'nope');
            expect(res.status).toBe(401);
            expect(res.headers['ratelimit-limit']).toBeTruthy();
        });
    });

    it('throttles repeated bad-key requests with 429', async () => {
        await withServer(async (agent) => {
            let last;
            for (let i = 0; i < 301; i++) {
                last = await agent.get('/api/state').set('x-api-key', 'nope');
            }
            expect(last.status).toBe(429);
        });
    }, 60000);

    it('still accepts the right key and rejects near-miss keys', async () => {
        await withServer(async (agent) => {
            const ok = await agent
                .get('/api/state')
                .set('x-api-key', 'right-key');
            expect(ok.status).toBe(200);
            for (const bad of ['right-ke', 'right-keyy', 'RIGHT-KEY', '']) {
                const res = await agent.get('/api/state').set('x-api-key', bad);
                expect(res.status).toBe(401);
            }
            const noKey = await agent.get('/api/state');
            expect(noKey.status).toBe(401);
        });
    });

    it('checks the admin key without a plain comparison', async () => {
        await withServer(async (agent) => {
            const res = await agent
                .post('/api/admin/rotate-key')
                .set('x-api-key', 'right-key')
                .set('x-admin-key', 'admin-keyy')
                .send({ newKey: 'a'.repeat(64) });
            expect(res.status).toBe(401);
        });
    });
});

describe('listen address', () => {
    function boot(extraEnv) {
        return new Promise((resolve, reject) => {
            const child = spawn(
                process.execPath,
                [path.join(__dirname, '../../app/server.js')],
                {
                    env: {
                        ...process.env,
                        PORT: '3971',
                        FIRE_AUTH_DISABLED: 'true',
                        FIRE_DATA_DIR: DATA_DIR,
                        FIRE_DB_FILE: path.join(DATA_DIR, 'boot-db.json'),
                        ...extraEnv,
                    },
                    stdio: ['ignore', 'pipe', 'pipe'],
                },
            );
            let out = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`no listen line: ${out}`));
            }, 20000);
            child.stdout.on('data', (d) => {
                out += d;
                const m = out.match(/running at http:\/\/([^:\s]+):\d+/);
                if (m) {
                    clearTimeout(timer);
                    child.kill();
                    resolve(m[1]);
                }
            });
        });
    }

    it('binds loopback by default', async () => {
        delete process.env.FIRE_BIND_HOST;
        expect(await boot({ FIRE_BIND_HOST: '' })).toBe('127.0.0.1');
    }, 30000);

    it('binds the configured host when FIRE_BIND_HOST is set', async () => {
        expect(await boot({ FIRE_BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    }, 30000);
});
