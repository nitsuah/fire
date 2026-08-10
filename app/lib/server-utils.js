'use strict';

const net = require('net');

function findAvailablePort(candidates) {
    if (!candidates.length) {
        return Promise.reject(new Error('No port candidates provided'));
    }
    const [port, ...rest] = candidates;
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () => {
            if (rest.length) resolve(findAvailablePort(rest));
            else {
                const fallback = net.createServer();
                fallback.once('error', reject);
                fallback.listen(0, () => {
                    const p = fallback.address().port;
                    fallback.close(() => resolve(p));
                });
            }
        });
        probe.once('listening', () => {
            probe.close(() => resolve(port));
        });
        probe.listen(port);
    });
}

/**
 * Parse a numeric value strictly — rejects leading/trailing whitespace and
 * empty strings, so '  3' or '' do not silently become NaN or 0.
 */
function strictNum(v) {
    const s = String(v ?? '');
    if (s !== s.trim() || s === '') return NaN;
    return Number(s);
}

module.exports = { findAvailablePort, strictNum };
