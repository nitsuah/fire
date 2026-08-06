'use strict';

const express = require('express');
const session = require('express-session');

const { DATA_DIR, DB_FILE, initDatabase } = require('./lib/db');
const { findAvailablePort } = require('./lib/server-utils');
const { refreshYahooCrumb } = require('./lib/yahoo-prices');

const stateRouter = require('./routes/state');
const syncRouter = require('./routes/sync');
const accountsRouter = require('./routes/accounts');
const cdsRouter = require('./routes/cds');
const pricesRouter = require('./routes/prices');

const PREFERRED_PORT = parseInt(process.env.PORT) || 3001;

console.log(`[Server Init] DATA_DIR: ${DATA_DIR}`);
console.log(`[Server Init] DB_FILE: ${DB_FILE}`);

const app = express();

app.use(
    express.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }),
);
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'a-very-secret-key',
        resave: false,
        saveUninitialized: true,
    }),
);
app.use(express.static(__dirname));

initDatabase();

app.use('/api/state', stateRouter);
app.use('/api/sync', syncRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/cds', cdsRouter);
app.use('/api/prices', pricesRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;

if (require.main === module) {
    findAvailablePort([PREFERRED_PORT, 3002, 3003, 3004, 3005])
        .then((port) => {
            const server = app.listen(port, '0.0.0.0', () => {
                if (port !== PREFERRED_PORT) {
                    console.warn(
                        `[Server] Port ${PREFERRED_PORT} in use — using ${port} instead.`,
                    );
                }
                console.log(
                    `🔥 FIRE Tracker Server running at http://0.0.0.0:${port}`,
                );
                refreshYahooCrumb().catch(() => {});
            });
            server.on('error', (err) => {
                console.error('[Server] Listen error:', err);
                process.exit(1);
            });
        })
        .catch((err) => {
            console.error('[Server] Failed to find available port:', err);
            process.exit(1);
        });
}
