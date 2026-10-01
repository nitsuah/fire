// @ts-check
/* global scenarioOffset, dashboardProjectionsChart, projectionsChart, buildProjectionData, state, getAggregateCash, getMonthlyExpensesBase, FireChaos */
const { test, expect } = require('@playwright/test');

async function dismissPrivacyModal(page) {
    const continueBtn = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    try {
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    } catch (err) {
        if (err.name === 'TimeoutError') return;
        throw err;
    }
    await continueBtn.click();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissPrivacyModal(page);
});

test.describe('Chaos mode', () => {
    test('toggles life events on both charts, survives reload, and rerolls', async ({
        page,
    }) => {
        const dashBtn = page.locator('#dash-card-growth .chaos-btn');
        await expect(dashBtn).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#dash-chaos-timeline')).toBeHidden();

        await dashBtn.click();
        await expect(dashBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#dash-chaos-timeline')).toBeVisible();
        await expect(page.locator('#dash-chaos-timeline')).toContainText(
            /life events? in view/,
        );

        const dash = await page.evaluate(() => ({
            labels: dashboardProjectionsChart.data.datasets.map((d) => d.label),
            markers: Object.keys(
                dashboardProjectionsChart.options.plugins.annotation
                    ?.annotations || {},
            ).filter((k) => k.startsWith('chaos_')).length,
        }));
        expect(dash.labels).toContain('Without chaos');
        expect(dash.markers).toBeGreaterThan(0);

        // Same events drive the Projections chart and its chip timeline.
        await page.locator('#btn-tab-projections').click();
        await expect(
            page.locator('#tab-projections .chaos-btn'),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(
            page.locator('#proj-chaos-timeline .chaos-chip').first(),
        ).toBeVisible();

        // A 1-year window still shows at least one event.
        await page.locator('#btn-tab-dashboard').click();
        await page
            .locator('#dash-period-btns button', { hasText: '1Y' })
            .click();
        const oneYear = await page.evaluate(
            () =>
                Object.keys(
                    dashboardProjectionsChart.options.plugins.annotation
                        ?.annotations || {},
                ).filter((k) => k.startsWith('chaos_')).length,
        );
        expect(oneYear).toBeGreaterThanOrEqual(1);

        const seedBefore = await page.evaluate(
            () => JSON.parse(localStorage.getItem('fire_chaos_mode')).seed,
        );
        await page.reload();
        await expect(
            page.locator('#dash-card-growth .chaos-btn'),
        ).toHaveAttribute('aria-pressed', 'true');

        await page.locator('#dash-card-growth .chaos-reroll-btn').click();
        const seedAfter = await page.evaluate(
            () => JSON.parse(localStorage.getItem('fire_chaos_mode')).seed,
        );
        expect(seedAfter).not.toBe(seedBefore);

        await page.locator('#dash-card-growth .chaos-btn').click();
        await expect(page.locator('#dash-chaos-timeline')).toBeHidden();
        const after = await page.evaluate(() =>
            dashboardProjectionsChart.data.datasets.map((d) => d.label),
        );
        expect(after).not.toContain('Without chaos');
    });

    test('chaos changes net worth only through its events', async ({
        page,
    }) => {
        await page.locator('#dash-card-growth .chaos-btn').click();
        const r = await page.evaluate(() => {
            const d = buildProjectionData();
            const s = state.projectionSettings;
            const args = {
                startNW: d.networth,
                cashFraction:
                    d.networth > 0
                        ? Math.min(
                              Math.max(getAggregateCash() / d.networth, 0),
                              1,
                          )
                        : 0,
                realReturn: d.realReturn,
                savings: d.savings,
                annualExpenses: d.annualExpenses,
                spending: getMonthlyExpensesBase() * 12,
                currentAge: s.currentAge,
                retireAge: s.retireAge,
                span: s.spanYears,
            };
            const none = FireChaos.simulate({ ...args, events: [] });
            const first = d.chaos.events[0];
            return {
                // The engine with no events must reproduce the app's own path.
                sameAsBase:
                    JSON.stringify(none.nwData) ===
                    JSON.stringify(d.noChaosData),
                // Nothing changes before the first event lands.
                untilFirst:
                    JSON.stringify(d.nwData.slice(0, first.yearIndex + 1)) ===
                    JSON.stringify(d.noChaosData.slice(0, first.yearIndex + 1)),
                differs:
                    JSON.stringify(d.nwData) !== JSON.stringify(d.noChaosData),
            };
        });
        expect(r).toEqual({
            sameAsBase: true,
            untilFirst: true,
            differs: true,
        });

        // Milestone estimates follow the chaos path.
        await page.locator('#btn-tab-projections').click();
        await expect(
            page.locator('#projection-milestones-container'),
        ).toContainText('🌪️');
    });

    test('mitigations in Insights shrink covered chaos hits and persist', async ({
        page,
    }) => {
        await page.locator('#dash-card-growth .chaos-btn').click();
        await page.locator('#btn-tab-insights').click();
        const block = page.locator('#chaos-mitigations');
        await expect(block).toContainText('Mitigate life events');
        const pet = block.locator('[data-mitigation="pet-insurance"]');
        await pet.check();
        await expect(block.locator('.mit-item.is-on')).toContainText(
            'Pet insurance',
        );
        const premiums = await page.evaluate(
            () => buildProjectionData().chaos.premiumTotal,
        );
        expect(premiums).toBeGreaterThan(0);
        await page.reload();
        await page.locator('#btn-tab-insights').click();
        await expect(
            page.locator(
                '#chaos-mitigations [data-mitigation="pet-insurance"]',
            ),
        ).toBeChecked();
    });

    test('Bear / Base / Bull pass numeric offsets (CSP delegation sends strings)', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        const offsets = {};
        for (const [name, off] of [
            ['bear', '-2'],
            ['base', '0'],
            ['bull', '2'],
        ]) {
            await page.locator(`.scenario-btn[data-offset="${off}"]`).click();
            offsets[name] = await page.evaluate(() => ({
                offset: scenarioOffset,
                last: buildProjectionData().nwData.at(-1),
            }));
        }
        expect(offsets.base.offset).toBe(0);
        expect(offsets.bear.offset).toBe(-2);
        expect(offsets.bull.offset).toBe(2);
        Object.values(offsets).forEach((o) =>
            expect(Number.isFinite(o.last)).toBe(true),
        );
        expect(offsets.bear.last).toBeLessThan(offsets.base.last);
        expect(offsets.base.last).toBeLessThan(offsets.bull.last);
    });

    test('Bear/Bull buttons leave the chaos toggle alone', async ({ page }) => {
        await page.locator('#btn-tab-projections').click();
        const chaos = page.locator('#tab-projections .chaos-btn');
        await chaos.click();
        await page.locator('.scenario-btn[data-offset="-2"]').click();
        await expect(chaos).toHaveClass(/active/);
        const hasMarkers = await page.evaluate(() =>
            Object.keys(
                projectionsChart.options.plugins.annotation?.annotations || {},
            ).some((k) => k.startsWith('chaos_')),
        );
        expect(hasMarkers).toBe(true);
    });
});

test('chaos, mitigations and Customize run under the strict CSP', async ({
    page,
}) => {
    const violations = [];
    page.on('console', (m) => {
        if (/Content Security Policy/i.test(m.text()))
            violations.push(m.text());
    });
    await page.reload();
    await page.locator('#dash-card-growth .chaos-btn').click();
    await page.locator('#dash-chaos-timeline summary').click();
    await page.locator('#tab-dashboard [data-lm-tool="edit"]').click();
    await page.locator('#btn-tab-projections').click();
    await page.locator('#btn-tab-insights').click();
    await page
        .locator('#chaos-mitigations [data-mitigation="pet-insurance"]')
        .check();
    // Chip colors and layout previews are set via the CSSOM, not style="".
    const chipColor = await page
        .locator('#proj-chaos-timeline .chaos-chip')
        .first()
        .evaluate((el) => el.style.getPropertyValue('--chaos-cat'));
    expect(chipColor).toMatch(/^#/);
    expect(violations).toEqual([]);
});

test.describe('Customizable layout', () => {
    test('collapse a card by its title and keep it collapsed after reload', async ({
        page,
    }) => {
        const card = page.locator('#dash-card-other');
        await card.locator('.card-title').click();
        await expect(card).toHaveClass(/lm-collapsed/);
        await expect(
            card.locator('#dashboard-other-assets-panel'),
        ).toBeHidden();
        await page.reload();
        await expect(page.locator('#dash-card-other')).toHaveClass(
            /lm-collapsed/,
        );
        await page.locator('#dash-card-other .card-title').click();
        await expect(page.locator('#dash-card-other')).not.toHaveClass(
            /lm-collapsed/,
        );
    });

    test('reorder cards with the arrow controls on any tab and persist', async ({
        page,
    }) => {
        await page.locator('#btn-tab-settings').click();
        const pane = page.locator('#tab-settings');
        await pane.locator('[data-lm-tool="edit"]').click();
        await pane
            .locator('[data-lm-id="settings:danger-zone"] [data-lm-act="up"]')
            .click();
        const order = () =>
            pane
                .locator('[data-lm-id]')
                .evaluateAll((els) => els.map((e) => e.dataset.lmId));
        const before = await order();
        expect(before.indexOf('settings:danger-zone')).toBe(before.length - 2);

        await page.reload();
        await page.locator('#btn-tab-settings').click();
        expect(await order()).toEqual(before);

        page.once('dialog', (d) => d.accept());
        await pane.locator('[data-lm-tool="edit"]').click();
        await pane.locator('[data-lm-tool="reset"]').click();
        const reset = await order();
        expect(reset[reset.length - 1]).toBe('settings:danger-zone');
    });

    test('a card alone in its section spans the full width; layouts are per section', async ({
        page,
    }) => {
        await page.locator('#btn-tab-projections').click();
        const pane = page.locator('#tab-projections');
        const board = pane.locator('.lm-board');
        const settings = page.locator('#proj-settings-card');
        const chart = page.locator(
            '[data-lm-id="projections:retirement-growth-path"]',
        );
        // Default: Growth Settings beside the chart, chart wider (1:2).
        let [s, c] = await Promise.all([
            settings.boundingBox(),
            chart.boundingBox(),
        ]);
        expect(Math.abs(s.y - c.y)).toBeLessThan(2);
        expect(c.width).toBeGreaterThan(s.width * 1.5);

        await pane.locator('[data-lm-tool="edit"]').click();
        const firstRow = pane.locator('.lm-row').first();
        // Equal columns → equal widths.
        await firstRow.locator('[data-lm-layout="2"]').click();
        [s, c] = await Promise.all([
            pane.locator('#proj-settings-card').boundingBox(),
            chart.boundingBox(),
        ]);
        expect(Math.abs(s.width - c.width)).toBeLessThan(4);

        // Drag Growth Settings onto the "New section" gap at the end.
        const handle = page.locator('#proj-settings-card .lm-handle');
        const hb = await handle.boundingBox();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x + 40, hb.y + 40, { steps: 4 });
        // The gap moves as the placeholder reflows the rows it passes,
        // so keep re-aiming at it until it lights up (as a person would).
        const gap = pane.locator('.lm-row-gap').last();
        for (let i = 0; i < 5; i++) {
            await gap.scrollIntoViewIfNeeded();
            const gb = await gap.boundingBox();
            await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, {
                steps: 3,
            });
            if (await gap.evaluate((el) => el.classList.contains('lm-hot')))
                break;
        }
        await expect(gap).toHaveClass(/lm-hot/);
        await page.mouse.up();
        await pane.locator('[data-lm-tool="edit"]').click(); // Done

        // Both cards now sit alone in their sections → full width each.
        const b = await board.boundingBox();
        [s, c] = await Promise.all([
            pane.locator('#proj-settings-card').boundingBox(),
            chart.boundingBox(),
        ]);
        expect(s.width).toBeGreaterThan(b.width - 4);
        expect(c.width).toBeGreaterThan(b.width - 4);
        expect(s.y).toBeGreaterThan(c.y);

        // Survives a reload.
        await page.reload();
        await page.locator('#btn-tab-projections').click();
        const b2 = await page
            .locator('#tab-projections .lm-board')
            .boundingBox();
        const s2 = await page.locator('#proj-settings-card').boundingBox();
        expect(s2.width).toBeGreaterThan(b2.width - 4);
    });

    test.describe('at phone width', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('every section collapses to a single column', async ({ page }) => {
            const [g, a, c] = await Promise.all(
                [
                    '#dash-card-growth',
                    '#dash-card-alloc',
                    '#dash-card-cash',
                ].map((sel) => page.locator(sel).boundingBox()),
            );
            expect(Math.abs(g.x - a.x)).toBeLessThan(2);
            expect(a.y).toBeGreaterThan(g.y + g.height - 1);
            expect(c.y).toBeGreaterThan(a.y + a.height - 1);
        });
    });

    test('pin a card from another tab to the Dashboard, then send it back', async ({
        page,
    }) => {
        const dash = page.locator('#tab-dashboard');
        await dash.locator('[data-lm-tool="edit"]').click();
        await dash.locator('[data-lm-tool="add"]').click();
        await page
            .locator('.lm-picker-row', { hasText: 'Scenario Comparison' })
            .getByRole('button', { name: 'Add' })
            .click();
        await page.keyboard.press('Escape');

        const pinned = dash.locator(
            '[data-lm-id="projections:scenario-comparison"]',
        );
        await expect(pinned).toBeVisible();
        await page.reload();
        await expect(
            page.locator(
                '#tab-dashboard [data-lm-id="projections:scenario-comparison"]',
            ),
        ).toHaveCount(1);

        await page.locator('#btn-tab-projections').click();
        const ph = page.locator('#tab-projections .lm-placeholder');
        await expect(ph).toContainText('Scenario Comparison');
        await ph.getByRole('button', { name: 'Move back here' }).click();
        await expect(
            page.locator(
                '#tab-projections [data-lm-id="projections:scenario-comparison"]',
            ),
        ).toBeVisible();
        await expect(page.locator('.lm-placeholder')).toHaveCount(0);
    });

    test('remove a Dashboard card and restore it from the picker', async ({
        page,
    }) => {
        const dash = page.locator('#tab-dashboard');
        await dash.locator('[data-lm-tool="edit"]').click();
        await page
            .locator('#dash-card-nw-history [data-lm-act="remove"]')
            .click();
        await expect(page.locator('#dash-card-nw-history')).toBeHidden();
        await dash.locator('[data-lm-tool="add"]').click();
        await page
            .locator('.lm-picker-row', { hasText: 'Net Worth History' })
            .getByRole('button', { name: 'Add' })
            .click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dash-card-nw-history')).toBeVisible();
    });
});
