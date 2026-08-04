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

app.use(express.json());
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

module.exports = app;

if (require.main === module) {
    findAvailablePort([PREFERRED_PORT, 3002, 3003, 3004, 3005]).then((port) => {
        app.listen(port, '0.0.0.0', () => {
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
    });
}
