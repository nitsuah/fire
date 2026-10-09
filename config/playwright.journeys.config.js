// @ts-check
// Nightly "AI user" journeys: happy paths a real user takes, one visual
// baseline per step. Run by .github/workflows/journeys.yml through the
// shared nitsuah/.github journeys harness, which files/dedups/closes
// `bot:journey` issues from the JSON report. Contract: nitsuah/.github
// journeys/STANDARD.md.
//
// Run / update baselines (Docker, same image as CI so pixels match):
//   docker build -f config/Dockerfile.playwright -t fire-playwright-e2e .
//   docker run --rm fire-playwright-e2e npx playwright test --config config/playwright.journeys.config.js
//   ...add --update-snapshots and mount tests/journeys to refresh baselines
//   (see tests/journeys/README.md).
const path = require('path');
const os = require('os');
const base = require('./playwright.config.js');

module.exports = {
    ...base,
    testDir: '../tests/journeys',
    // One baseline per step, Linux only: CI and local runs both use the
    // Playwright Docker image, so no per-platform suffix.
    snapshotPathTemplate:
        '{testDir}/__screenshots__/{testFilePath}/{testName}/{arg}{ext}',
    // A missing baseline must fail in CI (it would otherwise be written and
    // thrown away every night, so the visual check would never run).
    updateSnapshots: process.env.CI ? 'none' : 'missing',
    reporter: [
        ['list'],
        [
            'json',
            {
                outputFile: path.resolve(
                    __dirname,
                    '../journeys-report/report.json',
                ),
            },
        ],
    ],
    expect: {
        toHaveScreenshot: {
            // Above canvas text-rendering noise (~650px on fire), well below a layout
            // break; exact text and numbers are asserted with toHaveText instead.
            maxDiffPixels: 1000,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
        },
    },
    use: {
        ...base.use,
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        ...base.webServer,
        env: {
            ...base.webServer.env,
            FIRE_DB_FILE: path.join(os.tmpdir(), 'fire-journeys-db.json'),
        },
    },
};
