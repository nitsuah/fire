// ─── parseChaseStatement (categorization) ───────────────────────────────────────

describe('parseChaseStatement (categorization)', () => {
    it('maps Chase Food & Drink category to food bucket', () => {
        const rows = [
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-01',
                '2024-01-02',
                'Coffee',
                'Food & Drink',
                'Sale',
                '-15.00',
            ],
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.categories.food).toBeCloseTo(15);
        expect(result.categories.discretionary).toBe(0);
    });

    it('maps Chase Transit category to transportation bucket', () => {
        const rows = [
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-03',
                '2024-01-04',
                'Shell Gas',
                'Transit',
                'Sale',
                '-60.00',
            ],
        ];
        const result = parseChaseStatement(rows);
        expect(result.categories.transport).toBeCloseTo(60);
    });

    it('maps Chase Healthcare category to healthcare bucket', () => {
        const rows = [
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-05',
                '2024-01-06',
                'CVS Pharmacy Purchase',
                'Healthcare',
                'Sale',
                '-22.00',
            ],
        ];
        const result = parseChaseStatement(rows);
        expect(result.categories.healthcare).toBeCloseTo(22);
    });

    it('falls back to keyword matching when category unknown', () => {
        const rows = [
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-07',
                '2024-01-08',
                'Grocery Store Purchase',
                'Retail',
                'Sale',
                '-85.00',
            ],
        ];
        const result = parseChaseStatement(rows);
        expect(result.categories.food).toBeCloseTo(85);
    });

    it('provides months field', () => {
        const rows = [
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-01',
                '2024-01-02',
                'Coffee',
                'Food & Drink',
                'Sale',
                '-5.00',
            ],
            [
                '2024-02-01',
                '2024-02-02',
                'Coffee',
                'Food & Drink',
                'Sale',
                '-5.00',
            ],
        ];
        const result = parseChaseStatement(rows);
        expect(result.months).toBeGreaterThanOrEqual(1);
    });
});

// ─── parseCapitalOneStatement (categorization) ───────────────────────────────

describe('parseCapitalOneStatement (categorization)', () => {
    it('maps grocery category to food bucket', () => {
        const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2024-01-01,2024-01-02,1234,Kroger,Grocery Store/Supermarket,85.00,';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.categories.food).toBeCloseTo(85);
    });

    it('categorizes uncategorized transaction via keyword fallback', () => {
        const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2024-01-01,2024-01-02,1234,Walgreens Pharmacy,Other,12.00,';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.categories.healthcare).toBeCloseTo(12);
    });