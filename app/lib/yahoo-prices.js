'use strict';

const pricesCache = { timestamp: 0, data: {}, cookie: '', crumb: '' };

async function refreshYahooCrumb() {
    try {
        const consentRes = await fetch('https://finance.yahoo.com/quote/AAPL', {
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });
        const rawCookies = typeof consentRes.headers.getSetCookie === 'function'
            ? consentRes.headers.getSetCookie()
            : [consentRes.headers.get('set-cookie') || ''];
        const cookieMatch = rawCookies.join('; ').match(/(A1=[^;]+|A3=[^;]+)/g);
        const cookie = cookieMatch ? cookieMatch.join('; ') : '';

        const crumbRes = await fetch(
            'https://query1.finance.yahoo.com/v1/test/csrfToken',
            {
                signal: AbortSignal.timeout(10000),
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

module.exports = { pricesCache, refreshYahooCrumb };
