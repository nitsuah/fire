// @ts-check
const { test, expect } = require('@playwright/test');

async function accept(page) {
    const button = page.getByRole('button', {
        name: /I Understand.*Continue/i,
    });
    await button.waitFor({ state: 'visible' });
    await button.click();
}

test('the privacy window is a dialog that holds focus and closes with Escape', async ({
    page,
}) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: /Privacy Policy/ });
    await expect(dialog).toBeFocused();
    await expect(page.locator('.app-container')).toHaveAttribute('inert', '');

    // First run still needs consent.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await accept(page);
    await expect(page.locator('.app-container')).not.toHaveAttribute('inert');

    const opener = page.locator('#btn-nav-privacy');
    await opener.click();
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test.describe('at phone width', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('the menu has the sidebar actions and nothing is clipped', async ({
        page,
    }) => {
        await page.goto('/');
        await page.getByRole('dialog').waitFor();
        await expect(
            page.locator('#privacy-modal-body table').first(),
        ).toBeVisible();
        const sideways = await page
            .locator('#privacy-modal-body')
            .evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(sideways).toBeLessThanOrEqual(0);
        await accept(page);

        await page.locator('#sidebar-collapse-btn').click();
        for (const name of ['Export JSON Backup', 'Import JSON Backup']) {
            await expect(page.getByRole('button', { name })).toBeVisible();
        }
        await page.getByRole('button', { name: 'Privacy & Terms' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');

        await page.locator('#sidebar-collapse-btn').click();
        await page.locator('#btn-tab-financial').click();
        const clipped = await page
            .locator('#csv-drag-zone')
            .evaluate((zone) => {
                const box = zone.getBoundingClientRect();
                const label = zone.querySelector('.fo-import-label');
                const text = label.getBoundingClientRect();
                return Math.max(
                    text.right - box.right,
                    box.right - window.innerWidth,
                );
            });
        expect(clipped).toBeLessThanOrEqual(1);
    });
});
