import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

function parseHexColor(hex) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
}

function relativeLuminance({ r, g, b }) {
    const srgb = [r, g, b].map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

function extractCssVariables(css) {
    const vars = {};
    const rootMatch = css.match(/:root\s*{([^}]+)}/);
    if (rootMatch) {
        const declarations = rootMatch[1];
        const varRegex = /--([\w-]+):\s*([^;]+);/g;
        let match;
        while ((match = varRegex.exec(declarations)) !== null) {
            vars[match[1]] = match[2].trim();
        }
    }
    return vars;
}

describe('muted text contrast', () => {
    it('dim token meets WCAG AA 4.5:1 against background', () => {
        const css = readFileSync('site/styles.css', 'utf8');
        const vars = extractCssVariables(css);

        const bg = vars.bg;
        const dim = vars.dim;

        expect(bg).toBeDefined();
        expect(dim).toBeDefined();

        const bgColor = parseHexColor(bg);
        const dimColor = parseHexColor(dim);

        const bgLum = relativeLuminance(bgColor);
        const dimLum = relativeLuminance(dimColor);
        const ratio = contrastRatio(bgLum, dimLum);

        console.log(
            `Background: ${bg}, Dim: ${dim}, Contrast: ${ratio.toFixed(2)}:1`,
        );

        expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
});
