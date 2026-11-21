import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const LIVE_DATA = path.join(ROOT, 'data');

function envOf(configFile) {
    const mod = require(path.join(ROOT, 'config', configFile));
    return mod.webServer.env;
}

describe.each(['playwright.config.js', 'playwright.journeys.config.js'])(
    '%s test server',
    (file) => {
        it('uses a private FIRE_DATA_DIR outside the repo data dir', () => {
            const env = envOf(file);
            expect(env.FIRE_DATA_DIR).toBeTruthy();
            expect(path.resolve(env.FIRE_DATA_DIR).startsWith(LIVE_DATA)).toBe(
                false,
            );
            expect(
                path.resolve(env.FIRE_DATA_DIR).startsWith(os.tmpdir()),
            ).toBe(true);
        });

        it('keeps its DB file inside that data dir', () => {
            const env = envOf(file);
            expect(path.dirname(env.FIRE_DB_FILE)).toBe(env.FIRE_DATA_DIR);
        });
    },
);
