/* global module */
'use strict';

// Plaid error codes that mean the Item's grant is dead until the user
// re-links it. Retrying the sync can never fix these, so status has to say
// "re-link" instead of "connected" (#293).
const REAUTH_CODES = new Set([
    'ITEM_LOGIN_REQUIRED',
    'ITEM_LOCKED',
    'INVALID_ACCESS_TOKEN',
    'USER_PERMISSION_REVOKED',
]);

// A status payload must never carry tokens or provider payloads (#262), so
// a failure is reduced to its code before it is stored or reported.
function failureCode(err) {
    return err?.plaidErrorCode || err?.code || 'REQUEST_FAILED';
}

function reauthRequired(items) {
    return (items || []).some((item) => REAUTH_CODES.has(item?.lastErrorCode));
}

module.exports = { REAUTH_CODES, failureCode, reauthRequired };
