'use strict';

// Worker-thread side of jsonata-eval.js. Not loaded on the main thread.

const { parentPort, workerData } = require('worker_threads');
const jsonata = require('jsonata');

(async () => {
    try {
        const { mapping, input, maxResultBytes } = workerData;
        const result = await jsonata(mapping).evaluate(input);
        const json = result === undefined ? undefined : JSON.stringify(result);
        if (json !== undefined && Buffer.byteLength(json) > maxResultBytes) {
            throw new Error('JSONata result too large');
        }
        parentPort.postMessage({ ok: true, json });
    } catch (err) {
        parentPort.postMessage({
            ok: false,
            error: String((err && err.message) || err).slice(0, 300),
        });
    }
})();
