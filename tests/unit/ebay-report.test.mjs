import { describe, it, expect } from 'vitest';
import {
    parseEbayMoney,
    parseEbayListingsReport,
    mergeEbayReport,
} from '../../app/lib/ebay-report.js';
import { parseCSVText } from '../../app/lib/finance-parsing.js';

const HEADER =
    'Listing title,eBay item ID,Quantity sold,Total sales (Includes taxes),Item sales,Taxes and government fees paid by buyer to you,Taxes and government fees paid by buyer to eBay,Shipping and handling paid by buyer to you,Total selling costs,Insertion fees,Optional listing upgrade fees,Final value fees,Promoted Listings - General fees,Promoted Listings - Priority fees,Ads Express fees,Promoted Offsite - Fees,International fees,Other eBay fees,Deposit processing fees,Fee credits,Shipping labels cost (Amount you paid to buy shipping labels on eBay),Net sales (Net of taxes and selling costs),Average Selling price,Quantity sold via promoted listing,';

const report = (range, rows) =>
    [
        ',,,,,,,,,,,,,,',
        'Disclaimers',
        '• This is an analytics report',
        '',
        `"Report for ${range}"`,
        HEADER,
        ...rows,
    ].join('\n');

const ROW_A =
    '"Harry Potter and the Sorcerer\'s Stone (Game Boy Color, 2001)",227297193518,2,$27.02,$20.78,$0.00,$0.00,$6.24,$10.31,$0.00,$0.00,$4.07,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$6.24,$16.71,$13.51,0';
const ROW_REFUND =
    '"NES Console Bundle, Tested",227302362815,1,$0.00,$0.00,$0.00,$0.00,$0.00,$18.42,$0.00,$0.00,$20.53,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$20.13,$18.02,($18.42),$0.00,0';

const parse = (range, rows) =>
    parseEbayListingsReport(parseCSVText(report(range, rows)));

describe('parseEbayMoney', () => {
    it('handles dollars, commas and parenthesised negatives', () => {
        expect(parseEbayMoney('$1,234.50')).toBe(1234.5);
        expect(parseEbayMoney('($18.42)')).toBe(-18.42);
        expect(parseEbayMoney('')).toBe(0);
    });
});

describe('parseEbayListingsReport', () => {
    it('skips the preamble, reads the range, and maps revenue/expenses/net', () => {
        const parsed = parse('Jan 1, 2026 to Sep 18, 2026', [
            ROW_A,
            ROW_REFUND,
        ]);
        expect(parsed.range).toEqual({
            start: '2026-01-01',
            end: '2026-09-18',
        });
        expect(parsed.items).toHaveLength(2);
        const a = parsed.items[0];
        expect(a.itemId).toBe('227297193518');
        expect(a.qty).toBe(2);
        expect(a.revenue).toBe(27.02); // item sales + shipping paid by buyer
        // "Total selling costs" already includes the $6.24 label, so it must
        // not be added again; net matches eBay's own Net sales column.
        expect(a.expenses).toBe(10.31);
        expect(a.net).toBe(16.71);
        const refund = parsed.items[1];
        expect(refund.revenue).toBe(0);
        expect(refund.net).toBe(-18.42);
    });

    it('returns null for a non-eBay CSV', () => {
        expect(parseEbayListingsReport(parseCSVText('a,b\n1,2'))).toBeNull();
    });
});

describe('mergeEbayReport', () => {
    it('adds rows once and skips an identical re-upload', () => {
        const r = parse('Jan 1, 2026 to Sep 18, 2026', [ROW_A]);
        const first = mergeEbayReport([], r);
        expect(first.added).toBe(1);
        const again = mergeEbayReport(first.ledger, r);
        expect(again.added).toBe(0);
        expect(again.skipped).toBe(1);
        expect(again.ledger).toHaveLength(1);
    });

    it('refreshes amounts when the same report is re-imported with different numbers', () => {
        const r = parse('Jan 1, 2026 to Sep 18, 2026', [ROW_A]);
        const stale = {
            ...mergeEbayReport([], r).ledger[0],
            expenses: 16.55,
            net: 10.47,
            basisType: 'business',
            costBasis: 5,
        };
        const again = mergeEbayReport([stale], r);
        expect(again.updated).toBe(1);
        expect(again.added).toBe(0);
        expect(again.ledger).toHaveLength(1);
        expect(again.ledger[0].expenses).toBe(10.31);
        expect(again.ledger[0].net).toBe(11.71); // 27.02 - 10.31 - 5 cost
        expect(again.ledger[0].basisType).toBe('business');
    });

    it('replaces an older range contained in a newer cumulative report', () => {
        const older = mergeEbayReport(
            [],
            parse('Jan 1, 2026 to Jun 30, 2026', [ROW_A]),
        );
        const newer = mergeEbayReport(
            older.ledger,
            parse('Jan 1, 2026 to Sep 18, 2026', [ROW_A]),
        );
        expect(newer.replaced).toBe(1);
        expect(newer.added).toBe(1);
        expect(newer.ledger).toHaveLength(1);
    });

    it('keeps disjoint ranges side by side and leaves manual entries alone', () => {
        const manual = {
            id: 'm1',
            desc: 'Manual',
            category: 'eBay',
            revenue: 5,
            expenses: 1,
            net: 4,
        };
        const a = mergeEbayReport(
            [manual],
            parse('Jan 1, 2026 to Mar 31, 2026', [ROW_A]),
        );
        const b = mergeEbayReport(
            a.ledger,
            parse('Apr 1, 2026 to Jun 30, 2026', [ROW_A]),
        );
        expect(b.ledger).toHaveLength(3);
        expect(b.replaced).toBe(0);
        expect(b.ledger[0]).toBe(manual);
    });

    it('refuses to merge a report with no readable date range', () => {
        const noRange = parseEbayListingsReport(
            parseCSVText([HEADER, ROW_A].join('\n')),
        );
        expect(noRange.range).toBeNull();
        expect(() => mergeEbayReport([], noRange)).toThrow(/date range/);
    });
});
