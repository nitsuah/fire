import { describe, it, expect, beforeEach } from 'vitest';
import { integrateWebhookData } from '../../app/lib/webhook-integration.js';

describe('integrateWebhookData dedupe', () => {
    let db;

    beforeEach(() => {
        db = { sideGigLedger: [], importedFiles: [] };
    });

    describe('sideGigLedger', () => {
        it('generates a 16-hex id for entries without one', () => {
            const entry = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry);
            expect(db.sideGigLedger).toHaveLength(1);
            expect(db.sideGigLedger[0].id).toMatch(/^[0-9a-f]{16}$/);
            expect(db.sideGigLedger[0].platform).toBe('eBay');
            expect(db.sideGigLedger[0].gross).toBe(100);
            expect(db.sideGigLedger[0].net).toBe(80);
            expect(db.sideGigLedger[0].date).toBe('2025-01-01');
        });

        it('re-sending same id does not add twice', () => {
            const entry = {
                id: 'abcdef1234567890',
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry);
            integrateWebhookData(db, 'sideGigLedger', entry);
            expect(db.sideGigLedger).toHaveLength(1);
        });

        it('two entries without id but same platform/gross/net/date dedupe to one', () => {
            const entry1 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            const entry2 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry1);
            integrateWebhookData(db, 'sideGigLedger', entry2);
            expect(db.sideGigLedger).toHaveLength(1);
        });

        it('different date adds a second entry', () => {
            const entry1 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            const entry2 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-02',
            };
            integrateWebhookData(db, 'sideGigLedger', entry1);
            integrateWebhookData(db, 'sideGigLedger', entry2);
            expect(db.sideGigLedger).toHaveLength(2);
            expect(db.sideGigLedger[0].id).not.toBe(db.sideGigLedger[1].id);
        });

        it('different platform adds a second entry', () => {
            const entry1 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            const entry2 = {
                platform: 'Etsy',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry1);
            integrateWebhookData(db, 'sideGigLedger', entry2);
            expect(db.sideGigLedger).toHaveLength(2);
        });

        it('different gross adds a second entry', () => {
            const entry1 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            const entry2 = {
                platform: 'eBay',
                gross: 150,
                net: 120,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry1);
            integrateWebhookData(db, 'sideGigLedger', entry2);
            expect(db.sideGigLedger).toHaveLength(2);
        });

        it('different net adds a second entry', () => {
            const entry1 = {
                platform: 'eBay',
                gross: 100,
                net: 80,
                date: '2025-01-01',
            };
            const entry2 = {
                platform: 'eBay',
                gross: 100,
                net: 75,
                date: '2025-01-01',
            };
            integrateWebhookData(db, 'sideGigLedger', entry1);
            integrateWebhookData(db, 'sideGigLedger', entry2);
            expect(db.sideGigLedger).toHaveLength(2);
        });

        it('array adds each new entry', () => {
            const entries = [
                { platform: 'eBay', gross: 100, net: 80, date: '2025-01-01' },
                { platform: 'eBay', gross: 200, net: 160, date: '2025-01-02' },
                { platform: 'Etsy', gross: 50, net: 40, date: '2025-01-01' },
            ];
            integrateWebhookData(db, 'sideGigLedger', entries);
            expect(db.sideGigLedger).toHaveLength(3);
        });

        it('array with duplicate ids dedupes', () => {
            const entries = [
                {
                    id: 'abcdef1234567890',
                    platform: 'eBay',
                    gross: 100,
                    net: 80,
                    date: '2025-01-01',
                },
                {
                    id: 'abcdef1234567890',
                    platform: 'eBay',
                    gross: 200,
                    net: 160,
                    date: '2025-01-02',
                },
            ];
            integrateWebhookData(db, 'sideGigLedger', entries);
            expect(db.sideGigLedger).toHaveLength(1);
        });
    });

    describe('importedFiles', () => {
        it('pushes file with id as given', () => {
            const file = { id: 'file-123', name: 'report.csv', size: 1024 };
            integrateWebhookData(db, 'importedFiles', file);
            expect(db.importedFiles).toHaveLength(1);
            expect(db.importedFiles[0].id).toBe('file-123');
            expect(db.importedFiles[0].name).toBe('report.csv');
        });

        it('file with no id gets id equal to its name', () => {
            const file = { name: 'report.csv', size: 1024 };
            integrateWebhookData(db, 'importedFiles', file);
            expect(db.importedFiles).toHaveLength(1);
            expect(db.importedFiles[0].id).toBe('report.csv');
        });

        it('re-sending same name with no id does not add twice', () => {
            const file = { name: 'report.csv', size: 1024 };
            integrateWebhookData(db, 'importedFiles', file);
            integrateWebhookData(db, 'importedFiles', file);
            expect(db.importedFiles).toHaveLength(1);
        });

        it('file whose id equals existing file id is skipped', () => {
            const file1 = { id: 'file-123', name: 'report.csv', size: 1024 };
            const file2 = { id: 'file-123', name: 'different.csv', size: 2048 };
            integrateWebhookData(db, 'importedFiles', file1);
            integrateWebhookData(db, 'importedFiles', file2);
            expect(db.importedFiles).toHaveLength(1);
            expect(db.importedFiles[0].name).toBe('report.csv');
        });

        it('file whose id equals existing file name is skipped', () => {
            const file1 = { name: 'report.csv', size: 1024 }; // id becomes 'report.csv'
            const file2 = {
                id: 'report.csv',
                name: 'different.csv',
                size: 2048,
            };
            integrateWebhookData(db, 'importedFiles', file1);
            integrateWebhookData(db, 'importedFiles', file2);
            expect(db.importedFiles).toHaveLength(1);
            expect(db.importedFiles[0].name).toBe('report.csv');
        });

        it('id-less file is deduped on name only, so a name equal to an existing id is still added', () => {
            const file1 = {
                id: 'report.csv',
                name: 'original.csv',
                size: 1024,
            };
            const file2 = { name: 'report.csv', size: 2048 };
            integrateWebhookData(db, 'importedFiles', file1);
            integrateWebhookData(db, 'importedFiles', file2);
            expect(db.importedFiles).toHaveLength(2);
            expect(db.importedFiles[1].id).toBe('report.csv');
        });

        it('different file adds a second entry', () => {
            const file1 = { name: 'report1.csv', size: 1024 };
            const file2 = { name: 'report2.csv', size: 2048 };
            integrateWebhookData(db, 'importedFiles', file1);
            integrateWebhookData(db, 'importedFiles', file2);
            expect(db.importedFiles).toHaveLength(2);
        });

        it('array adds each new file', () => {
            const files = [
                { id: 'file-1', name: 'a.csv', size: 100 },
                { name: 'b.csv', size: 200 },
                { id: 'file-3', name: 'c.csv', size: 300 },
            ];
            integrateWebhookData(db, 'importedFiles', files);
            expect(db.importedFiles).toHaveLength(3);
            expect(db.importedFiles[0].id).toBe('file-1');
            expect(db.importedFiles[1].id).toBe('b.csv');
            expect(db.importedFiles[2].id).toBe('file-3');
        });
    });
});
