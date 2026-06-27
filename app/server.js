const express = require('express');
const fs = require('fs');
const net = require('net');
const path = require('path');
const session = require('express-session'); // Moved from further down
const crypto = require('crypto'); // Moved from further down
const jsonata = require('jsonata'); // New: for JSONata transformations

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
            webhookTemplates: [], // New: Store webhook templates
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

// Encryption helpers (Moved from further down)
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

// Function to integrate webhook data into the main application state
function integrateWebhookData(db, type, data) {
    try {
        switch (type) {
            case 'accounts':
                const incomingAccounts = Array.isArray(data) ? data : [data];
                incomingAccounts.forEach(incomingAcc => {
                    const existingIndex = db.customAccounts.findIndex(acc => acc.id === incomingAcc.id);
                    if (existingIndex !== -1) {
                        db.customAccounts[existingIndex] = { ...db.customAccounts[existingIndex], ...incomingAcc };
                    } else {
                        db.customAccounts.push({ id: crypto.randomBytes(8).toString('hex'), ...incomingAcc });
                    }
                });
                break;
            case 'cds':
                const incomingCds = Array.isArray(data) ? data : [data];
                incomingCds.forEach(incomingCd => {
                    const existingIndex = db.cds.findIndex(cd => cd.id === incomingCd.id);
                    if (existingIndex !== -1) {
                        db.cds[existingIndex] = { ...db.cds[existingIndex], ...incomingCd };
                    } else {
                        db.cds.push({ id: crypto.randomBytes(8).toString('hex'), ...incomingCd });
                    }
                });
                break;
            case 'positions':
                const incomingPositions = Array.isArray(data) ? data : [data];
                incomingPositions.forEach(incomingPos => {
                    const existingIndex = db.importedPositions.findIndex(pos => pos.symbol === incomingPos.symbol);
                    if (existingIndex !== -1) {
                        db.importedPositions[existingIndex] = { ...db.importedPositions[existingIndex], ...incomingPos };
                    } else {
                        db.importedPositions.push(incomingPos);
                    }
                });
                break;
            case 'expenses':
                db.expenses = { ...db.expenses, ...data };
                break;
            case 'sideGigLedger':
                const incomingLedgerEntries = Array.isArray(data) ? data : [data];
                incomingLedgerEntries.forEach(entry => {
                    db.sideGigLedger.push({ id: crypto.randomBytes(8).toString('hex'), ...entry });
                });
                break;
            case 'importedFiles':
                const incomingFiles = Array.isArray(data) ? data : [data];
                incomingFiles.forEach(file => {
                    db.importedFiles.push(file);
                });
                break;
            case 'taxRate':
                if (typeof data === 'number') {
                    db.taxRate = data;
                } else {
                    console.warn(`[Webhook] Invalid data for taxRate:`, data);
                    return false;
                }
                break;
            case 'projectionSettings':
                if (typeof data === 'object' && data !== null) {
                    db.projectionSettings = { ...db.projectionSettings, ...data };
                } else {
                    console.warn(`[Webhook] Invalid data for projectionSettings:`, data);
                    return false;
                }
                break;
            default:
                console.warn(`[Webhook] Unhandled webhook type: ${type}. Data:`, data);
                return false;
        }
        return true;
    } catch (error) {
        console.error(`[Webhook] Error integrating data of type ${type}:`, error);
        return false;
    }
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

app.use(session({
    secret: process.env.SESSION_SECRET || 'a-very-secret-key',
    resave: false,
    saveUninitialized: true
}));

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

// Webhook API Endpoints
// 6. Webhook Templates Management APIs
app.post('/api/sync/templates', (req, res) => {
    const db = readState();
    const newTemplate = {
        id: crypto.randomBytes(8).toString('hex'), // Unique ID for the template
        name: req.body.name,
        source: req.body.source, // e.g., "Plaid", "Fidelity", "Custom"
        type: req.body.type,     // e.g., "transactions", "positions", "net_worth"
        mapping: req.body.mapping, // JSON object for data mapping rules
        secret: req.body.secret || null, // Optional: for HMAC verification
        createdAt: new Date().toISOString(),
    };
    db.webhookTemplates.push(newTemplate);
    if (writeState(db)) {
        res.status(201).json(newTemplate);
    } else {
        res.status(500).json({ error: 'Failed to save webhook template.' });
    }
});

app.get('/api/sync/templates', (req, res) => {
    const db = readState();
    res.json(db.webhookTemplates.map(({ secret, ...rest }) => rest)); // Exclude secret from retrieval
});

app.put('/api/sync/templates/:id', (req, res) => {
    const db = readState();
    const templateIndex = db.webhookTemplates.findIndex(
        (t) => t.id === req.params.id,
    );

    if (templateIndex === -1) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    db.webhookTemplates[templateIndex] = {
        ...db.webhookTemplates[templateIndex],
        name: req.body.name || db.webhookTemplates[templateIndex].name,
        source: req.body.source || db.webhookTemplates[templateIndex].source,
        type: req.body.type || db.webhookTemplates[templateIndex].type,
        mapping: req.body.mapping || db.webhookTemplates[templateIndex].mapping,
        secret: req.body.secret || db.webhookTemplates[templateIndex].secret,
    };

    if (writeState(db)) {
        const { secret, ...updatedTemplate } = db.webhookTemplates[templateIndex];
        res.json(updatedTemplate);
    } else {
        res.status(500).json({ error: 'Failed to update webhook template.' });
    }
});

app.delete('/api/sync/templates/:id', (req, res) => {
    const db = readState();
    const initialLength = db.webhookTemplates.length;
    db.webhookTemplates = db.webhookTemplates.filter(
        (t) => t.id !== req.params.id,
    );

    if (db.webhookTemplates.length === initialLength) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'Webhook template successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete webhook template.' });
    }
});

// 7. Generic Webhook Receiver Endpoint
app.post('/api/sync/webhook/:templateId', async (req, res) => {
    const db = readState();
    const template = db.webhookTemplates.find(
        (t) => t.id === req.params.templateId,
    );

    if (!template) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    // Implement HMAC verification if template.secret is set
    if (template.secret) {
        const signature = req.headers['x-webhook-signature'];
        if (!signature) {
            return res.status(401).json({ error: 'Missing webhook signature.' });
        }

        const hmac = crypto.createHmac('sha256', template.secret);
        const digest = hmac.update(JSON.stringify(req.body)).digest('hex');

        if (signature !== `sha256=${digest}`) {
            return res.status(403).json({ error: 'Invalid webhook signature.' });
        }
    }

    // Apply mapping
    let transformedData = {};
    try {
        if (template.mapping && typeof template.mapping === 'string') {
            const expression = jsonata(template.mapping);
            transformedData = await expression.evaluate(req.body);
        } else {
            transformedData = req.body; // No specific mapping, take raw body
        }
    } catch (e) {
        console.error('Error applying webhook mapping:', e);
        return res.status(400).json({ error: 'Error processing webhook data.', details: e.message });
    }

    // Integrate transformedData into the main application state (db.json)
    const dbUpdated = readState(); // Re-read to ensure we have the latest state
    const integrationSuccess = integrateWebhookData(dbUpdated, template.type, transformedData);

    if (integrationSuccess && writeState(dbUpdated)) {
        console.log(`Received webhook for template ${template.name}, integrated data of type ${template.type}.`);
        res.json({ status: 'success', message: `Webhook data for ${template.type} integrated successfully.` });
    } else {
        res.status(500).json({ error: 'Failed to integrate webhook data.' });
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
