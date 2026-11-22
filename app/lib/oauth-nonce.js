'use strict';

// Per-attempt return nonce for the browser OAuth flows. The SPA generates a
// random value, sends it as ?n= to the authorize route, the route seals it
// into the pending cookie, and the callback echoes it back in the result
// fragment so the SPA can check the result belongs to the attempt it started.

const NONCE_RE = /^[0-9a-f]{32}$/;

function cleanNonce(value) {
    const v = Array.isArray(value) ? value[0] : value;
    return typeof v === 'string' && NONCE_RE.test(v) ? v : '';
}

// Suffix appended to a result fragment ('' when there is no nonce).
function nonceSuffix(nonce) {
    const n = cleanNonce(nonce);
    return n ? `&n=${n}` : '';
}

module.exports = { cleanNonce, nonceSuffix };
