/* global module, require, Buffer */
'use strict';

const crypto = require('node:crypto');

/**
 * Constant-time comparison of a provided secret with the expected one,
 * without hashing either: both are copied into equal-length buffers so
 * timingSafeEqual always scans the same span, and the lengths must also
 * match. Only the longer of the two lengths is observable.
 * @param {unknown} provided
 * @param {unknown} expected
 * @returns {boolean}
 */
function tokensMatch(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') {
        return false;
    }
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const len = Math.max(a.length, b.length, 1);
    const pa = Buffer.alloc(len);
    const pb = Buffer.alloc(len);
    a.copy(pa);
    b.copy(pb);
    const same = crypto.timingSafeEqual(pa, pb);
    return same && a.length === b.length;
}

module.exports = { tokensMatch };
