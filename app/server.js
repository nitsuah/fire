const express = require('express');
const fs = require('fs');
const net = require('net');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PREFERRED_PORT = parseInt(process.env.PORT) || 3001;
const DATA_DIR = process.env.FIRE_DATA_DIR || path.join(__dirname, '../data');
const DB_FILE = process.env.FIRE_DB_FILE || path.join(DATA_DIR, 'db.json');

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'a-very-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use(express.static(__dirname));

// Ensure database directory and file exist on startup
function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
        const defaultState = {
            importedPositions: [],
            customAccounts: [],
            cds: [],
            expenses: {
                housing: 1500,
                utilities: 250,
                food: 400,
                transport: 300,
                healthcare: 150,
                discretionary: 500,
            },
            taxRate: 20,
            sideGigLedger: [],
            projectionSettings: {
                annualSavings: 25000,
                expectedReturn: 8.0,
                inflationRate: 2.5,
                swr: 4.0,
                spanYears: 30,
            },
            importedFiles: [],
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultState, null, 2));
    }
}

initDatabase();

// Helper to read database state
function readState() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(
            'Error reading database, returning default fallback state',
            e,
        );
        return {};
    }
}

// Helper to write database state
function writeState(state) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing to database', e);
        return false;
    }
}

// Encryption helpers
const ALGORITHM = 'aes-256-gcm';
const KEY = process.env.SYNC_MASTER_KEY ? Buffer.from(process.env.SYNC_MASTER_KEY, 'hex') : crypto.randomBytes(32);

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
    const [iv, authTag, encrypted] = text.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/* ==========================================================================
   REST API Endpoints
   ========================================================================== */

// 1. Get entire state
app.get('/api/state', (req, res) => {
    res.json(readState());
});

// 2. Overwrite entire state (useful for JSON backup import)
app.post('/api/state', (req, res) => {
    const success = writeState(req.body);
    if (success) {
        res.json({ message: 'State successfully updated.', state: req.body });
    } else {
        res.status(500).json({ error: 'Failed to write database state.' });
    }
});

// 3. Accounts Management APIs
app.post('/api/accounts', (req, res) => {
    const db = readState();
    const newAcc = {
        id: Date.now().toString(),
        name: req.body.name,
        type: req.body.type || 'Cash',
        value: parseFloat(req.body.value) || 0,
        apy: parseFloat(req.body.apy) || 0,
    };
    db.customAccounts.push(newAcc);
    if (writeState(db)) {
        res.status(201).json(newAcc);
    } else {
        res.status(500).json({ error: 'Failed to save manual account.' });
    }
});

app.put('/api/accounts/:id', (req, res) => {
    const db = readState();
    const accountIndex = db.customAccounts.findIndex(
        (acc) => acc.id === req.params.id,
    );

    if (accountIndex === -1) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    // Merge changes
    db.customAccounts[accountIndex] = {
        ...db.customAccounts[accountIndex],
        name: req.body.name || db.customAccounts[accountIndex].name,
        type: req.body.type || db.customAccounts[accountIndex].type,
        value:
            req.body.value !== undefined
                ? parseFloat(req.body.value)
                : db.customAccounts[accountIndex].value,
        apy:
            req.body.apy !== undefined
                ? parseFloat(req.body.apy)
                : db.customAccounts[accountIndex].apy,
    };

    if (writeState(db)) {
        res.json(db.customAccounts[accountIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update manual account.' });
    }
});

app.delete('/api/accounts/:id', (req, res) => {
    const db = readState();
    const initialLength = db.customAccounts.length;
    db.customAccounts = db.customAccounts.filter(
        (acc) => acc.id !== req.params.id,
    );

    if (db.customAccounts.length === initialLength) {
        return res.status(444).json({ error: 'Account not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'Account successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete manual account.' });
    }
});

// 4. CDs Management APIs
app.post('/api/cds', (req, res) => {
    const db = readState();
    const newCD = {
        id: Date.now().toString(),
        bank: req.body.bank,
        principal: parseFloat(req.body.principal) || 0,
        rate: parseFloat(req.body.rate) || 0,
        startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
        maturity: req.body.maturity,
    };
    db.cds.push(newCD);
    if (writeState(db)) {
        res.status(201).json(newCD);
    } else {
        res.status(500).json({ error: 'Failed to save CD.' });
    }
});

app.put('/api/cds/:id', (req, res) => {
    const db = readState();
    const cdIndex = db.cds.findIndex((cd) => cd.id === req.params.id);

    if (cdIndex === -1) {
        return res.status(404).json({ error: 'CD not found.' });
    }

    db.cds[cdIndex] = {
        ...db.cds[cdIndex],
        bank: req.body.bank || db.cds[cdIndex].bank,
        principal:
            req.body.principal !== undefined
                ? parseFloat(req.body.principal)
                : db.cds[cdIndex].principal,
        rate:
            req.body.rate !== undefined
                ? parseFloat(req.body.rate)
                : db.cds[cdIndex].rate,
        startDate: req.body.startDate || db.cds[cdIndex].startDate,
        maturity: req.body.maturity || db.cds[cdIndex].maturity,
    };

    if (writeState(db)) {
        res.json(db.cds[cdIndex]);
    } else {
        res.status(500).json({ error: 'Failed to update CD.' });
    }
});

app.delete('/api/cds/:id', (req, res) => {
    const db = readState();
    const initialLength = db.cds.length;
    db.cds = db.cds.filter((cd) => cd.id !== req.params.id);

    if (db.cds.length === initialLength) {
        return res.status(404).json({ error: 'CD not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'CD successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete CD.' });
    }
});

// Mem cache for prices (5 minute TTL)
const pricesCache = { timestamp: 0, data: {}, cookie: '', crumb: '' };

// Fetch Yahoo Finance session cookie + crumb for authenticated API access
async function refreshYahooCrumb() {
    try {
        const consentRes = await fetch('https://finance.yahoo.com/quote/AAPL', {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });
        const rawCookie = consentRes.headers.get('set-cookie') || '';
        // Extract A1 or A3 cookie segment Yahoo uses for consent
        const cookieMatch = rawCookie.match(/(A1=[^;]+|A3=[^;]+)/g);
        const cookie = cookieMatch ? cookieMatch.join('; ') : '';

        // Fetch crumb with the session cookie
        const crumbRes = await fetch(
            'https://query1.finance.yahoo.com/v1/test/csrfToken',
            {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    Cookie: cookie,
                },
            },
        );
        if (crumbRes.ok) {
            const crumb = await crumbRes.text();
            pricesCache.cookie = cookie;
            pricesCache.crumb = crumb.trim();
            console.log(`[Prices] Yahoo crumb refreshed successfully.`);
            return true;
        }
    } catch (e) {
        console.warn('[Prices] Crumb fetch failed:', e.message);
    }
    return false;
}

// 5. Realtime stock prices API (Yahoo Finance wrapper with crumb auth)
app.get('/api/prices', async (req, res) => {
    const rawSymbols = req.query.symbols;
    if (!rawSymbols) return res.json({});

    // Clean symbols: strip asterisks, exclude numeric CUSIPs and known MM fund tickers
    const symbolsArr = rawSymbols
        .split(',')
        .map((s) => s.trim().replace(/\*+$/g, ''))
        .filter(
            (s) =>
                s.length > 0 &&
                !/^\d+/.test(s) &&
                !['SPAXX', 'FDRXX', 'FCASH', 'FDIC'].includes(s.toUpperCase()),
        );

    if (symbolsArr.length === 0) return res.json({});

    const uniqueSymbols = [...new Set(symbolsArr)];
    const now = Date.now();

    // Serve from cache if still fresh (5 minutes)
    if (now - pricesCache.timestamp < 300000) {
        const allInCache = uniqueSymbols.every(
            (s) => pricesCache.data[s] !== undefined,
        );
        if (allInCache) {
            console.log(
                `[Prices] Serving ${uniqueSymbols.length} symbol(s) from cache.`,
            );
            return res.json(pricesCache.data);
        }
    }

    // Ensure we have a valid crumb (refresh if not set)
    if (!pricesCache.crumb) {
        await refreshYahooCrumb();
    }

    const baseHeaders = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: pricesCache.cookie,
    };

    const qStr = encodeURIComponent(uniqueSymbols.join(','));
    const crumbParam = pricesCache.crumb
        ? `&crumb=${encodeURIComponent(pricesCache.crumb)}`
        : '';

    const endpoints = [
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qStr}${crumbParam}`,
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${qStr}`,
        `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${qStr}&fields=regularMarketPrice,regularMarketChangePercent${crumbParam}`,
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url, { headers: baseHeaders });
            if (response.ok) {
                const json = await response.json();
                const quotes =
                    (json.quoteResponse && json.quoteResponse.result) || [];
                if (quotes.length > 0) {
                    quotes.forEach((q) => {
                        pricesCache.data[q.symbol] = {
                            price: q.regularMarketPrice,
                            changePercent: q.regularMarketChangePercent || 0,
                        };
                    });
                    pricesCache.timestamp = now;
                    console.log(`[Prices] Updated ${quotes.length} quote(s).`);
                    return res.json(pricesCache.data);
                }
            } else if (response.status === 401 || response.status === 403) {
                // Crumb expired – refresh and try once more
                console.warn(
                    `[Prices] Auth error ${response.status}, refreshing crumb...`,
                );
                await refreshYahooCrumb();
            } else {
                console.warn(`[Prices] Endpoint status: ${response.status}`);
            }
        } catch (err) {
            console.warn('[Prices] Fetch error:', err.message);
        }
    }

    console.warn(
        `[Prices] All endpoints failed. Returning stale cache (${Object.keys(pricesCache.data).length} items).`,
    );
    res.json(pricesCache.data);
});

function findAvailablePort(candidates) {
    const [port, ...rest] = candidates;
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => {
            if (rest.length) resolve(findAvailablePort(rest));
            else {
                // Let OS assign an ephemeral port
                const fallback = net.createServer();
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

if (require.main === module) {
    findAvailablePort([PREFERRED_PORT, 3002, 3003, 3004, 3005]).then((port) => {
        app.listen(port, () => {
            if (port !== PREFERRED_PORT) {
                console.warn(
                    `[Server] Port ${PREFERRED_PORT} in use — using ${port} instead.`,
                );
            }
            console.log(
                `🔥 FIRE Tracker Server running at http://localhost:${port}`,
            );
            refreshYahooCrumb().catch(() => {});
        });
    });
}

module.exports = app;

// Sync OAuth routes
app.get('/api/sync/init', (req, res) => {
    // 1. Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');

    // Store state in session (simplified for now)
    req.session = { oauthState: state };

    // 2. Construct OAuth URL (Example with placeholders)
    const providerUrl = 'https://oauth.provider.com/authorize';
    const params = new URLSearchParams({
        client_id: process.env.SYNC_CLIENT_ID || 'dummy_client_id',
        redirect_uri: `http://localhost:${PREFERRED_PORT}/api/sync/callback`,
        response_type: 'code',
        scope: 'read_only_accounts',
        state: state
    });

    // 3. Redirect user
    res.redirect(`${providerUrl}?${params.toString()}`);
});

// Placeholder token exchange logic
app.post('/api/sync/callback', async (req, res) => {
    // 1. Verify state parameter
    const { code, state } = req.body;

    if (!state || state !== req.session?.oauthState) {
        return res.status(403).json({ error: 'Invalid or missing state' });
    }

    if (!code) {
        return res.status(400).json({ error: 'Missing code' });
    }

    // 2. TODO: Implement actual token exchange (fetch to provider)
    console.log('Exchanging code for tokens:', code);
    const tokens = { access_token: 'actual_access_token_from_provider', refresh_token: 'actual_refresh_token', expires_in: 3600 };

    // 3. Encrypt tokens
    const encryptedToken = encrypt(JSON.stringify(tokens));

    // 4. Store encrypted tokens
    try {
        const tokenData = { lastUpdated: new Date().toISOString(), data: encryptedToken };
        fs.writeFileSync(path.join(DATA_DIR, 'tokens.json'), JSON.stringify(tokenData));
        res.json({ status: 'success', message: 'Tokens securely stored.' });
    } catch (err) {
        console.error('Failed to store tokens:', err);
        res.status(500).json({ error: 'Failed to store tokens.' });
    }
});

// Proxy API route to external platform (e.g. Fidelity)
app.get('/api/sync/data', async (req, res) => {
    // 1. Read stored tokens
    const tokenFile = path.join(DATA_DIR, 'tokens.json');
    if (!fs.existsSync(tokenFile)) {
        return res.status(401).json({ error: 'No tokens found. Please authorize.' });
    }

    const { data: encryptedToken } = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    
    // 2. Decrypt tokens
    const tokens = JSON.parse(decrypt(encryptedToken));

    // 3. Proxy request (Placeholder: add logic to call external API with tokens)
    res.json({ status: 'success', data: 'Aggregated data (mock)', accessToken: tokens.access_token.substring(0, 5) + '...' });
});
