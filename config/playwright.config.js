// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Real-browser UI regression coverage for the dashboard/projections layout
// fixes and new widgets in the 2026 roadmap cycle. Run with:
//   npx playwright install --with-deps chromium   (one-time)
//   npm run test:e2e-ui
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
        reuseExistingServer: !process.env.CI,
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
