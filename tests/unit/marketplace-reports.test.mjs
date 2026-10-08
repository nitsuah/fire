import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    mrMoney,
    mrDate,
    mrPoshmarkFee,
    parseMarketplaceReport,
    mergeMarketplaceEntries,
    MR_FB_TEMPLATE_HEADER,
} from '../../app/lib/marketplace-reports.js';
import { parseCSVText } from '../../app/lib/finance-parsing.js';
import { parseEbayListingsReport } from '../../app/lib/ebay-report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
    parseCSVText(
        fs.readFileSync(
            path.join(here, 'fixtures', 'marketplaces', name),
            'utf8',
        ),
    );

describe('helpers', () => {
    it('parses money and dates in the formats the exports use', () => {
        expect(mrMoney('$1,234.50')).toBe(1234.5);
        expect(mrMoney('($2.95)')).toBe(-2.95);
        expect(mrMoney('-$3.00')).toBe(-3);
        expect(mrMoney('')).toBe(0);
        expect(mrDate('03/02/2026')).toBe('2026-03-02');
        expect(mrDate('3/2/26')).toBe('2026-03-02');
        expect(mrDate('2026-03-02T18:00:00Z')).toBe('2026-03-02');
        expect(mrDate('Mar 2, 2026')).toBe('2026-03-02');
        expect(mrDate('not a date')).toBeNull();
    });

    it('applies the Poshmark fee schedule', () => {
        expect(mrPoshmarkFee(14.99)).toBe(2.95);
        expect(mrPoshmarkFee(15)).toBe(3);
        expect(mrPoshmarkFee(0)).toBe(0);
    });
});

describe('Mercari sales history', () => {
    const report = parseMarketplaceReport(fixture('mercari-sales.csv'));

    it('is recognised and skips canceled orders', () => {
        expect(report.platform).toBe('mercari');
        expect(report.entries).toHaveLength(2);
        expect(report.skipped).toBe(1);
    });

    it('maps revenue, fees and net to match Mercari proceeds', () => {
        const [a, b] = report.entries;
        expect(a).toMatchObject({
            id: 'mercari-m11111111111',
            date: '2026-03-02',
            desc: 'Nintendo DS Lite, Cobalt',
            category: 'Mercari',
            revenue: 45,
            expenses: 11.99,
            net: 33.01,
            marketplaceOrderId: 'm11111111111',
        });
        // Buyer-paid shipping is revenue; sales tax is not.
        expect(b).toMatchObject({ revenue: 35.99, expenses: 3.6, net: 32.39 });
        expect(a.basisType).toBeUndefined();
    });

    it('falls back to Net Seller Proceeds when fee columns are missing', () => {
        const rows = parseCSVText(
            'Item ID,Item Title,Sold Date,Item Price,Net Seller Proceeds\nm9,Thing,2026-04-01,$20.00,$17.10',
        );
        const r = parseMarketplaceReport(rows);
        expect(r.entries[0]).toMatchObject({ revenue: 20, expenses: 2.9 });
    });
});

describe('Poshmark sales report', () => {
    const report = parseMarketplaceReport(fixture('poshmark-sales.csv'));

    it('is recognised, not mistaken for an eBay report, and skips returns', () => {
        expect(
            parseEbayListingsReport(fixture('poshmark-sales.csv')),
        ).toBeNull();
        expect(report.platform).toBe('poshmark');
        expect(report.entries).toHaveLength(2);
        expect(report.skipped).toBe(1);
    });

    it('derives fees from Net Earnings (20% / $2.95 flat)', () => {
        expect(report.entries[0]).toMatchObject({
            id: 'poshmark-63f0aa11bb22cc33dd44ee55',
            date: '2026-02-01',
            category: 'Poshmark',
            revenue: 40,
            expenses: 8,
            net: 32,
        });
        expect(report.entries[1]).toMatchObject({
            revenue: 12,
            expenses: 2.95,
        });
    });

    it('estimates fees from the schedule when there is no net column', () => {
        const rows = parseCSVText(
            'Poshmark Order Id,Order Date,Listing Title,Order Price\nabc,2026-02-01,Tee,$10.00',
        );
        const r = parseMarketplaceReport(rows);
        expect(r.entries[0]).toMatchObject({
            expenses: 2.95,
            feesEstimated: true,
        });
    });
});

describe('FB Marketplace template', () => {
    const report = parseMarketplaceReport(fixture('fb-marketplace.csv'));

    it('matches the shipped template header', () => {
        const shipped = fs
            .readFileSync(
                path.join(here, '../../app/templates/fb-marketplace-sales.csv'),
                'utf8',
            )
            .split(/\r?\n/)[0];
        expect(shipped).toBe(MR_FB_TEMPLATE_HEADER);
        expect(report.platform).toBe('fb');
        expect(report.entries).toHaveLength(4);
    });

    it('reads fees, cost basis and the optional tax tag', () => {
        const [table, helmet] = report.entries;
        expect(table).toMatchObject({
            category: 'FB Marketplace',
            revenue: 45,
            expenses: 0,
            costBasis: 10,
            net: 35,
            basisType: 'business',
        });
        expect(table.id).toMatch(/^fb-csv-[0-9a-f]{8}-1$/);
        expect(helmet).toMatchObject({
            id: 'fb-FB-7781',
            revenue: 38,
            expenses: 8.75,
            net: 29.25,
            basisType: 'personal',
        });
        expect(helmet.costBasis).toBeUndefined();
    });

    it('keeps identical rows apart with stable occurrence ids', () => {
        const [, , a, b] = report.entries;
        expect(a.id).not.toBe(b.id);
        expect(a.id.replace(/-1$/, '')).toBe(b.id.replace(/-2$/, ''));
        const again = parseMarketplaceReport(fixture('fb-marketplace.csv'));
        expect(again.entries.map((e) => e.id)).toEqual(
            report.entries.map((e) => e.id),
        );
    });
});

describe('mergeMarketplaceEntries', () => {
    it('dedupes on re-import and keeps edits on existing rows', () => {
        const { entries } = parseMarketplaceReport(
            fixture('mercari-sales.csv'),
        );
        const first = mergeMarketplaceEntries([], entries);
        expect(first.added).toBe(2);
        first.ledger[0] = {
            ...first.ledger[0],
            basisType: 'business',
            costBasis: 5,
        };
        const second = mergeMarketplaceEntries(first.ledger, entries);
        expect(second).toMatchObject({ added: 0, skipped: 2 });
        expect(second.ledger[0]).toMatchObject({
            basisType: 'business',
            costBasis: 5,
        });
    });

    it('does not mutate the input ledger', () => {
        const ledger = [{ id: 'x' }];
        mergeMarketplaceEntries(ledger, [{ id: 'y' }]);
        expect(ledger).toEqual([{ id: 'x' }]);
    });
});

describe('unrecognised files', () => {
    it('returns null for a spending CSV or an empty file', () => {
        expect(
            parseMarketplaceReport(
                parseCSVText('Date,Description,Amount\n2026-01-01,Coffee,-4'),
            ),
        ).toBeNull();
        expect(parseMarketplaceReport([])).toBeNull();
    });
});
