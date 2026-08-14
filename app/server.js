'use strict';

const express = require('express');
const path = require('path');
const session = require('express-session');

const { DATA_DIR, DB_FILE, initDatabase, rotateMasterKey } = require('./lib/db');
const { findAvailablePort } = require('./lib/server-utils');
const { refreshYahooCrumb } = require('./lib/yahoo-prices');

const stateRouter = require('./routes/state');
const syncRouter = require('./routes/sync');
const accountsRouter = require('./routes/accounts');
const cdsRouter = require('./routes/cds');
const pricesRouter = require('./routes/prices');
const walletsRouter = require('./routes/wallets');
const backupRouter = require('./routes/backup');
const vehiclesRouter = require('./routes/vehicles');

const PREFERRED_PORT = parseInt(process.env.PORT) || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

console.log(`[Server Init] DATA_DIR: ${DATA_DIR}`);
console.log(`[Server Init] DB_FILE: ${DB_FILE}`);

// ─── Fail-fast checks (production only) ──────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === 'change_me_in_production') {
    if (IS_PRODUCTION) {
        console.error('[Server] FATAL: SESSION_SECRET must be set to a strong random value in production.');
        process.exit(1);
    } else {
        console.warn(
            '[Server] WARNING: SESSION_SECRET is not set or is using the default placeholder. ' +
                'Set a strong random value in production.',
        );
    }
}

const API_KEY = process.env.FIRE_API_KEY || null;
if (!API_KEY && IS_PRODUCTION) {
    console.warn('[Server] WARNING: FIRE_API_KEY is not set. All /api/* routes are unauthenticated.');
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

let rateLimitFn;
try {
    rateLimitFn = require('express-rate-limit').rateLimit;
} catch {
    rateLimitFn = null;
}

function makeRateLimiter(max, windowMs, message) {
    if (!rateLimitFn) return (req, res, next) => next();
    return rateLimitFn({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
}

const generalLimiter = makeRateLimiter(300, 60 * 1000, 'Too many requests. Slow down.');
const syncLimiter = makeRateLimiter(30, 60 * 1000, 'Too many sync requests. Slow down.');

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(
    express.json({
        limit: '1mb',
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }),
);

app.use(
    session({
        secret: SESSION_SECRET || 'a-very-secret-key',
        resave: false,
        saveUninitialized: true,
        cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION },
    }),
);

app.use(express.static(__dirname));
app.use('/docs', express.static(path.join(__dirname, '../docs')));

if (API_KEY) {
    app.use('/api', (req, res, next) => {
        const key = req.headers['x-api-key'];
        if (!key || key !== API_KEY) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        next();
    });
}

app.use('/api', generalLimiter);
app.use('/api/sync', syncLimiter);

initDatabase();

app.use('/api/state', stateRouter);
app.use('/api/sync', syncRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/cds', cdsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/wallets', walletsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/vehicles', vehiclesRouter);

// Key rotation endpoint
app.post('/api/admin/rotate-key', (req, res) => {
    const { newKey } = req.body;
    if (!newKey || !/^[0-9a-fA-F]{64}$/.test(newKey)) {
        return res.status(400).json({ error: 'newKey must be 64 hex characters.' });
    }
    try {
        rotateMasterKey(newKey);
        res.json({ status: 'success', message: 'Database re-encrypted with new key. Update SYNC_MASTER_KEY in your .env.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
                console.log(`🔥 FIRE Tracker Server running at http://0.0.0.0:${port}`);
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
