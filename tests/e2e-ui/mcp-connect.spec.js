// @ts-check
// #514: the hosted MCP consent page, against a fake relay (no network).
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

const SID_RE = /^[0-9a-f]{32}$/;
const PENDING = {
    client_name: 'Test Agent',
    redirect_uri: 'https://client.example/cb',
    state: 'st-9',
    scope: ['summary', 'accounts', 'transactions'],
    exp: Date.now() + 300000,
};
const REQ = `${Buffer.from(JSON.stringify(PENDING)).toString('base64url')}.sig`;
const URL_HASH = `/#/mcp-connect?req=${REQ}`;

async function setup(page, { withData = true } = {}) {
    // Same-origin relay so the page's connect-src 'self' covers the socket.
    await page.route('**/', async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replace(
            /<meta name="fire-relay-url" content="[^"]*">/,
            '<meta name="fire-relay-url" content="ws://localhost:3011">',
        );
        await route.fulfill({ response: res, body });
    });
    await page.addInitScript((data) => {
        localStorage.setItem('fire_privacy_v1_accepted', String(Date.now()));
        if (data)
            localStorage.setItem(
                'fire_tracker_state',
                JSON.stringify({
                    customAccounts: [
                        { name: 'Demo Savings', type: 'Savings', value: 1234 },
                    ],
                }),
            );
    }, withData);
}

async function fakeRelay(page, log, onReady = () => {}) {
    await page.routeWebSocket(/\/bridge\//, (ws) => {
        ws.onMessage((raw) => {
            const frame = JSON.parse(String(raw));
            log.push(frame);
            if (frame.type === 'HELLO') {
                ws.send(
                    JSON.stringify({
                        v: 1,
                        type: 'CHALLENGE',
                        sid: frame.sid,
                        nonce: crypto.randomBytes(16).toString('hex'),
                        exp: Date.now() + 10000,
                    }),
                );
            } else if (frame.type === 'PROVE') {
                const hello = log.find((f) => f.type === 'HELLO');
                ws.send(
                    JSON.stringify({
                        v: 1,
                        type: 'READY',
                        sid: frame.sid,
                        expiresAt: hello.expiresAt,
                        idleTimeout: 600000,
                        scope: hello.scope,
                    }),
                );
                onReady(ws, frame.sid);
            }
        });
    });
}

test.describe('MCP consent page', () => {
    test('shows the unverified client, redirect host, groups and defaults', async ({
        page,
    }) => {
        await setup(page);
        await page.goto(URL_HASH);
        const panel = page.getByRole('dialog');
        await expect(panel).toContainText('Test Agent');
        await expect(panel).toContainText('not verified');
        await expect(panel).toContainText('client.example');
        await expect(
            panel.getByRole('checkbox', { name: /Net worth/ }),
        ).toBeChecked();
        await expect(
            panel.getByRole('checkbox', { name: /transactions/i }),
        ).not.toBeChecked();
        await expect(panel.locator('select')).toHaveValue('1800000');
    });

    test('approve connects the bridge with the ticked scope and offers the return link', async ({
        page,
        context,
    }) => {
        const log = [];
        await setup(page);
        await fakeRelay(page, log);
        await page.goto(URL_HASH);
        await page
            .getByRole('dialog')
            .getByRole('checkbox', { name: /Accounts/ })
            .uncheck();
        await page.locator('#mcp-connect-approve').click();
        const link = page.getByRole('link', {
            name: /Return to client\.example/,
        });
        await expect(link).toBeVisible();
        const hello = log.find((f) => f.type === 'HELLO');
        expect(hello.sid).toMatch(SID_RE);
        expect(hello.scope).toEqual(['summary']);
        expect(hello.pendingAuth).toBe(REQ);
        expect(hello.pub.d).toBeUndefined();
        // The ticket is a hash, never the pending value itself.
        const href = await link.getAttribute('href');
        const u = new URL(href);
        // Same origin as the app: the deploy rewrites /authorize/complete to the relay.
        expect(u.origin).toBe(new URL(page.url()).origin);
        expect(u.pathname).toBe('/authorize/complete');
        expect(u.searchParams.get('sid')).toBe(hello.sid);
        expect(u.searchParams.get('t')).toBe(
            crypto.createHash('sha256').update(REQ).digest('base64url'),
        );
        expect(href).not.toContain(REQ);
        // The banner shows the client, with Disconnect.
        await expect(
            page.getByText(/Connected agent: Test Agent/),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Disconnect' }).click();
        await expect(page.getByText(/connection ended/i)).toBeVisible();
        expect(log.some((f) => f.type === 'END')).toBe(true);
        void context;
    });

    test('approving serves one tools/call on the real tool core with demo data', async ({
        page,
    }) => {
        const log = [];
        await setup(page);
        await fakeRelay(page, log, (ws, sid) => {
            ws.send(
                JSON.stringify({
                    v: 1,
                    type: 'CALL',
                    sid,
                    seq: 1,
                    id: crypto.randomBytes(16).toString('hex'),
                    deadline: Date.now() + 15000,
                    tool: 'get_net_worth',
                    args: {},
                }),
            );
        });
        await page.goto(URL_HASH);
        await page.locator('#mcp-connect-approve').click();
        await expect
            .poll(() => log.filter((f) => f.type === 'RESULT').length)
            .toBe(1);
        const result = log.find((f) => f.type === 'RESULT');
        expect(result.ok).toBe(true);
        expect(JSON.stringify(result.content)).toContain('1234');
        await expect(page.getByText(/cannot serve MCP tools/)).toHaveCount(0);
    });

    test('deny sends the user back with access_denied and opens no socket', async ({
        page,
    }) => {
        const log = [];
        await setup(page);
        await fakeRelay(page, log);
        await page.route('https://client.example/**', (route) =>
            route.fulfill({ contentType: 'text/html', body: 'client' }),
        );
        await page.goto(URL_HASH);
        await page.locator('#mcp-connect-deny').click();
        await page.waitForURL(/client\.example\/cb/);
        const u = new URL(page.url());
        expect(u.searchParams.get('error')).toBe('access_denied');
        expect(u.searchParams.get('state')).toBe('st-9');
        expect(log).toEqual([]);
    });

    test('says so when this browser has no fire data, and never connects', async ({
        page,
    }) => {
        const log = [];
        await setup(page, { withData: false });
        await fakeRelay(page, log);
        await page.goto(URL_HASH);
        await expect(page.getByRole('dialog')).toContainText(
            'No fire data in this browser',
        );
        await expect(page.locator('#mcp-connect-approve')).toHaveCount(0);
        expect(log).toEqual([]);
    });

    test('an unreadable request is rejected', async ({ page }) => {
        await setup(page);
        await page.goto('/#/mcp-connect?req=garbage.sig');
        await expect(page.getByRole('dialog')).toContainText(
            'could not be read',
        );
    });
});
