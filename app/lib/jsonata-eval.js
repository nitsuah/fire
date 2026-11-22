/* global module, require, __dirname, setTimeout, clearTimeout, setImmediate */
'use strict';

// Evaluates a JSONata mapping in a worker thread so a runaway expression can
// be terminated for real (a timer on the main thread cannot interrupt
// synchronous evaluation). The worker also gets memory limits, and the
// serialised result is size-capped before it crosses back.

const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_FILE = path.join(__dirname, 'jsonata-worker.js');
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_MAPPING_CHARS = 8 * 1024;

function evaluateMapping(
    mapping,
    input,
    { timeoutMs = DEFAULT_TIMEOUT_MS, maxResultBytes = MAX_RESULT_BYTES } = {},
) {
    return new Promise((resolve, reject) => {
        if (typeof mapping !== 'string' || mapping.length > MAX_MAPPING_CHARS) {
            return reject(new Error('JSONata mapping too large'));
        }
        let settled = false;
        let worker;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (worker) worker.terminate().catch(() => {});
            fn(value);
        };
        const timer = setTimeout(
            () => finish(reject, new Error('JSONata evaluation timed out')),
            timeoutMs,
        );
        try {
            worker = new Worker(WORKER_FILE, {
                workerData: { mapping, input, maxResultBytes },
                resourceLimits: {
                    maxOldGenerationSizeMb: 64,
                    maxYoungGenerationSizeMb: 16,
                    stackSizeMb: 2,
                },
            });
        } catch (err) {
            return finish(reject, err);
        }
        worker.once('message', (msg) => {
            if (msg && msg.ok)
                finish(
                    resolve,
                    msg.json === undefined ? undefined : JSON.parse(msg.json),
                );
            else
                finish(
                    reject,
                    new Error(
                        (msg && msg.error) || 'JSONata evaluation failed',
                    ),
                );
        });
        worker.once('error', (err) =>
            finish(
                reject,
                new Error(
                    err && err.code === 'ERR_WORKER_OUT_OF_MEMORY'
                        ? 'JSONata evaluation exceeded memory limit'
                        : (err && err.message) || 'JSONata evaluation failed',
                ),
            ),
        );
        // Give an already-posted result a turn to be delivered before treating
        // the exit as a failure (finish() ignores this once settled).
        worker.once('exit', () =>
            setImmediate(() =>
                finish(
                    reject,
                    new Error('JSONata evaluation ended unexpectedly'),
                ),
            ),
        );
    });
}

module.exports = {
    evaluateMapping,
    DEFAULT_TIMEOUT_MS,
    MAX_RESULT_BYTES,
    MAX_MAPPING_CHARS,
};
