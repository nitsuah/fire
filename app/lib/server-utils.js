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

module.exports = { findAvailablePort };
