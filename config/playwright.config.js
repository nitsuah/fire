// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Real-browser UI regression coverage for the dashboard/projections layout
// fixes and new widgets in the 2026 roadmap cycle.
//
// Locally (after `npx playwright install --with-deps chromium` once):
//   npm run test:e2e-ui
//
// In Docker (preferred; avoids Windows bind-mount npm ci flakiness by
// COPYing the repo into the image instead of mounting it):
//   docker build -f config/Dockerfile.playwright -t fire-playwright-e2e .
//   docker run --rm fire-playwright-e2e
//
// Starts the app itself (webServer) against an isolated temp DB so it never
// touches a real data/db.json.
module.exports = defineConfig({
    testDir: '../tests/e2e-ui',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:3011',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'node ../app/server.js',
        url: 'http://localhost:3011',
        // Always start our own instance against the isolated temp DB below —
        // if a server already happens to be listening on :3011 (e.g. a local
        // dev server), reusing it would skip our FIRE_DB_FILE env entirely
        // and this suite would test a stale server against the wrong DB.
        reuseExistingServer: false,
        cwd: __dirname,
        env: {
            PORT: '3011',
            FIRE_DB_FILE: require('path').join(
                require('os').tmpdir(),
                'fire-playwright-test-db.json',
            ),
        },
    },
});
