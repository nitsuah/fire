'use strict';

const crypto = require('crypto');

function integrateWebhookData(db, type, data) {
    try {
        switch (type) {
            case 'accounts': {
                const incomingAccounts = Array.isArray(data) ? data : [data];
                incomingAccounts.forEach((incomingAcc) => {
                    const existingIndex = db.customAccounts.findIndex(
                        (acc) => acc.id === incomingAcc.id,
                    );
                    if (existingIndex !== -1) {
                        db.customAccounts[existingIndex] = {
                            ...db.customAccounts[existingIndex],
                            ...incomingAcc,
                        };
                    } else {
                        db.customAccounts.push({
                            id:
                                incomingAcc.id ||
                                crypto.randomBytes(8).toString('hex'),
                            ...incomingAcc,
                        });
                    }
                });
                break;
            }
            case 'cds': {
                const incomingCds = Array.isArray(data) ? data : [data];
                incomingCds.forEach((incomingCd) => {
                    const existingIndex = db.cds.findIndex(
                        (cd) => cd.id === incomingCd.id,
                    );
                    if (existingIndex !== -1) {
                        db.cds[existingIndex] = {
                            ...db.cds[existingIndex],
                            ...incomingCd,
                        };
                    } else {
                        db.cds.push({
                            id: crypto.randomBytes(8).toString('hex'),
                            ...incomingCd,
                        });
                    }
                });
                break;
            }
            case 'positions': {
                const incomingPositions = Array.isArray(data) ? data : [data];
                incomingPositions.forEach((incomingPos) => {
                    const existingIndex = db.importedPositions.findIndex(
                        (pos) => pos.symbol === incomingPos.symbol,
                    );
                    if (existingIndex !== -1) {
                        db.importedPositions[existingIndex] = {
                            ...db.importedPositions[existingIndex],
                            ...incomingPos,
                        };
                    } else {
                        db.importedPositions.push({
                            id: crypto.randomBytes(8).toString('hex'),
                            ...incomingPos,
                        });
                    }
                });
                break;
            }
            case 'expenses': {
                if (
                    typeof data !== 'object' ||
                    data === null ||
                    Array.isArray(data)
                ) {
                    console.warn(
                        `[Webhook] Invalid data for expenses (expected object, got ${typeof data})`,
                    );
                    return false;
                }
                db.expenses = { ...db.expenses, ...data };
                break;
            }
            case 'sideGigLedger': {
                const incomingLedgerEntries = Array.isArray(data)
                    ? data
                    : [data];
                incomingLedgerEntries.forEach((entry) => {
                    const key =
                        entry.id ||
                        `${entry.platform || ''}:${entry.gross || ''}:${entry.net || ''}:${entry.date || ''}`;
                    const exists = db.sideGigLedger.some(
                        (e) =>
                            (e.id && e.id === entry.id) ||
                            (!entry.id &&
                                `${e.platform || ''}:${e.gross || ''}:${e.net || ''}:${e.date || ''}` ===
                                    key),
                    );
                    if (!exists) {
                        db.sideGigLedger.push({
                            id: crypto.randomBytes(8).toString('hex'),
                            ...entry,
                        });
                    }
                });
                break;
            }
            case 'importedFiles': {
                const incomingFiles = Array.isArray(data) ? data : [data];
                incomingFiles.forEach((file) => {
                    db.importedFiles.push(file);
                });
                break;
            }
            case 'taxRate': {
                if (typeof data === 'number') {
                    db.taxRate = data;
                } else {
                    console.warn(
                        `[Webhook] Invalid data for taxRate (expected number, got ${typeof data})`,
                    );

                    return false;
                }
                break;
            }
            case 'projectionSettings': {
                if (typeof data === 'object' && data !== null) {
                    db.projectionSettings = {
                        ...db.projectionSettings,
                        ...data,
                    };
                } else {
                    console.warn(
                        `[Webhook] Invalid data for projectionSettings (expected object, got ${typeof data})`,
                    );
                    return false;
                }
                break;
            }
            default:
                console.warn(`[Webhook] Unhandled webhook type: ${type}`);
                return false;
        }
        return true;
    } catch (error) {
        console.error(
            `[Webhook] Error integrating data of type ${type}:`,
            error,
        );
        return false;
    }
}

module.exports = { integrateWebhookData };
