#!/usr/bin/env node
/* ==========================================================================
   fin-checkin.mjs — deterministic weekly financial check-in

   Replaces the long agentic `week-fin-sum` run (see docs/weekly-checkin-prompt.md,
   which stays the source of truth for tone and rules). Every number comes from
   the same read-only code the fire MCP server uses (handleTool in
   app/mcp-server.mjs over readState in app/lib/db.js), so the data pulls are
   deterministic. A model is called at most once, only to rewrite an already
   templated check-in as calm prose; if it is unavailable or its answer adds
   numbers that are not in the template, the template is printed as is.

   Read-only: nothing is written to the repo or the database, and the MCP
   audit log is not touched (handleTool is called directly).
   The check-in goes to stdout; diagnostics go to stderr. The router key is
   never printed.

   Usage: node scripts/fin-checkin.mjs [--no-model] [--json]
                                       [--rates rates.json] [--date YYYY-MM-DD]
   Env:   FIRE_DATA_DIR / FIRE_DB_FILE / SYNC_MASTER_KEY  (as the app)
          FIN_RATES_URL    JSON {hysa, cd3, cd6, cd12} (percent)
          ANTHROPIC_BASE_URL, NINEROUTER_KEY  (else ~/.claude/settings.json env)
   ========================================================================== */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { handleTool } from '../app/mcp-server.mjs';

const require = createRequire(import.meta.url);
const { summarizeDataFreshness } = require('../app/lib/data-freshness.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// Rules. Staleness (> 3 days) and the 10% concentration listing come from
// docs/weekly-checkin-prompt.md and app/lib/data-freshness.js; the rest are
// this script's own thresholds (the prompt file gives no numbers for them).
export const THRESHOLDS = {
    cdSoonDays: 30,
    staleDays: 3,
    runwayMonths: 12,
    concentrationPct: 20,
    rateGapPct: 0.5,
};

const DEFAULT_BASE_URL = 'http://localhost:20128/v1';

/* ---------- dates ---------- */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dayNumber = (y, m, d) => Date.UTC(y, m - 1, d) / DAY_MS;

export function parseToday(value, now = new Date()) {
    if (value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!m) throw new Error(`--date must be YYYY-MM-DD, got "${value}"`);
        return { y: +m[1], m: +m[2], d: +m[3] };
    }
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export function isoWeek({ y, m, d }) {
    const t = new Date(Date.UTC(y, m - 1, d));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return {
        year: t.getUTCFullYear(),
        week: Math.ceil(((t - yearStart) / DAY_MS + 1) / 7),
    };
}

export function upcomingEnds(today) {
    const lastDay = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate();
    const now = dayNumber(today.y, today.m, today.d);
    const monthEnd = ymd(today.y, today.m, lastDay);
    const qm = Math.ceil(today.m / 3) * 3;
    const qLast = new Date(Date.UTC(today.y, qm, 0)).getUTCDate();
    const quarterEnd = ymd(today.y, qm, qLast);
    return {
        monthEnd: {
            date: monthEnd,
            daysAway: dayNumber(today.y, today.m, lastDay) - now,
        },
        quarterEnd: {
            date: quarterEnd,
            daysAway: dayNumber(today.y, qm, qLast) - now,
        },
    };
}

// Whole days from today to a maturity string (negative once matured).
export function daysUntil(maturity, today) {
    if (!maturity) return null;
    const s = String(maturity);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    const target = m
        ? dayNumber(+m[1], +m[2], +m[3])
        : Math.floor(Date.parse(s) / DAY_MS);
    return Number.isFinite(target)
        ? target - dayNumber(today.y, today.m, today.d)
        : null;
}

/* ---------- facts ---------- */

const round1 = (n) => Math.round(n * 10) / 10;

export function collectFacts(state, today) {
    const nw = handleTool('get_net_worth', state);
    const runway = handleTool('get_emergency_runway', state);
    const conc = handleTool('get_concentration_risk', state);
    const cdRes = handleTool('get_cds', state);
    const accts = handleTool('get_accounts', state);
    // Computed against the check-in date (not the wall clock) so --date is deterministic.
    const fresh = summarizeDataFreshness(
        state,
        new Date(Date.UTC(today.y, today.m - 1, today.d, 12)),
    );

    const cds = cdRes.cds
        .map((cd) => ({
            bank: cd.bank || 'CD',
            principal: cd.principal,
            rate: cd.rate,
            maturity: cd.maturity || null,
            days: daysUntil(cd.maturity, today),
        }))
        .sort(
            (a, b) =>
                (a.days ?? Infinity) - (b.days ?? Infinity) ||
                a.bank.localeCompare(b.bank),
        );
    const weighted = (rows, valueKey, rateKey) => {
        const tot = rows.reduce((s, r) => s + r[valueKey], 0);
        return tot > 0
            ? rows.reduce((s, r) => s + r[valueKey] * r[rateKey], 0) / tot
            : null;
    };
    const savings = accts.accounts
        .filter((a) => a.type === 'Savings' && a.value > 0)
        .map((a) => ({ value: a.value, apy: a.apy || 0 }));

    const unpriced = fresh.positionsWithoutPriceSource || [];
    const wk = isoWeek(today);
    return {
        date: ymd(today.y, today.m, today.d),
        weekday: new Date(
            Date.UTC(today.y, today.m - 1, today.d),
        ).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        isoWeek: wk,
        ...upcomingEnds(today),
        netWorth: { total: nw.total, breakdown: nw.breakdown },
        runwayMonths: runway.runwayMonths ?? null,
        runwayUnavailable: runway.unavailableReason || null,
        concentration: conc.risk || [],
        cds,
        cdTotal: cdRes.totalPrincipal,
        cdWeightedRate: cds.length ? weighted(cds, 'principal', 'rate') : null,
        savingsWeightedApy: savings.length
            ? weighted(savings, 'value', 'apy')
            : null,
        freshness: {
            daysStale: fresh.daysStale ?? null,
            stale:
                fresh.daysStale != null &&
                fresh.daysStale > THRESHOLDS.staleDays,
            pricesOldest: fresh.pricesAsOf?.oldest
                ? fresh.pricesAsOf.oldest.slice(0, 10)
                : null,
            lastImport: fresh.lastImport ? fresh.lastImport.slice(0, 10) : null,
            unpriced: unpriced.map((p) => p.symbol),
            unpricedTotal: unpriced.reduce((s, p) => s + (p.value || 0), 0),
        },
    };
}

/* ---------- market rates ---------- */

const RATE_KEYS = ['hysa', 'cd3', 'cd6', 'cd12'];

// Keep only finite percentages in a sane range; never fill in a missing one.
export function sanitizeRates(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const k of RATE_KEYS) {
        const v = Number(raw[k]);
        if (raw[k] != null && Number.isFinite(v) && v >= 0 && v <= 25)
            out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}

export async function loadRates({
    file,
    env = process.env,
    fetchFn = fetch,
    warn = () => {},
}) {
    try {
        if (file) {
            return sanitizeRates(JSON.parse(fs.readFileSync(file, 'utf8')));
        }
        if (env.FIN_RATES_URL) {
            const res = await fetchFn(env.FIN_RATES_URL, {
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                warn(`market rates: FIN_RATES_URL returned HTTP ${res.status}`);
                return null;
            }
            return sanitizeRates(await res.json());
        }
    } catch (err) {
        // Rates are optional and never invented; report that a requested source failed,
        // without echoing the path, URL or file contents.
        warn(
            `market rates: could not load the requested source (${err.name || 'error'})`,
        );
    }
    return null;
}

export function compareRates(facts, rates) {
    if (!rates) return null;
    const cdRates = ['cd3', 'cd6', 'cd12']
        .filter((k) => rates[k] != null)
        .map((k) => ({ term: k, rate: rates[k] }));
    const bestCd = cdRates.length
        ? cdRates.reduce((a, b) => (b.rate > a.rate ? b : a))
        : null;
    const cdGap =
        bestCd && facts.cdWeightedRate != null
            ? round1(bestCd.rate - facts.cdWeightedRate)
            : null;
    const hysaGap =
        rates.hysa != null && facts.savingsWeightedApy != null
            ? round1(rates.hysa - facts.savingsWeightedApy)
            : null;
    return {
        rates,
        bestCd,
        cdGap,
        hysaGap,
        cdsCouldEarnMore: cdGap != null && cdGap >= THRESHOLDS.rateGapPct,
        savingsCouldEarnMore:
            hysaGap != null && hysaGap >= THRESHOLDS.rateGapPct,
    };
}

/* ---------- action item ---------- */

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// First matching rule wins; ordered by how time-bound the item is.
export function pickAction(facts, comparison = null) {
    const cd = facts.cds.find(
        (c) => c.days != null && c.days <= THRESHOLDS.cdSoonDays,
    );
    if (cd) {
        const when =
            cd.days < 0
                ? `matured ${plural(-cd.days, 'day')} ago`
                : cd.days === 0
                  ? 'matures today'
                  : `matures on ${cd.maturity.slice(0, 10)} (${plural(cd.days, 'day')})`;
        return {
            id: 'cd-maturing',
            text: `Your ${cd.bank} CD of ${usd(cd.principal)} at ${cd.rate}% ${when}; decide whether to renew it or move it to a savings or shorter CD option.`,
        };
    }
    if (facts.freshness.stale) {
        return {
            id: 'stale-prices',
            text: `Prices are ${plural(facts.freshness.daysStale, 'day')} old; open the dashboard or import a fresh positions CSV so net worth is current.`,
        };
    }
    if (
        facts.runwayMonths != null &&
        facts.runwayMonths < THRESHOLDS.runwayMonths
    ) {
        return {
            id: 'low-runway',
            text: `Runway is ${facts.runwayMonths} months, under ${THRESHOLDS.runwayMonths}; hold off on new commitments and review monthly expenses.`,
        };
    }
    const top = [...facts.concentration].sort(
        (a, b) => b.percentage - a.percentage,
    )[0];
    if (top && top.percentage >= THRESHOLDS.concentrationPct) {
        return {
            id: 'concentration',
            text: `${top.symbol} is ${top.percentage}% of net worth; confirm that is intended, no trade needed this week.`,
        };
    }
    if (comparison?.cdsCouldEarnMore) {
        return {
            id: 'rate-gap-cd',
            text: `Your CDs earn about ${round1(facts.cdWeightedRate)}% while the best market CD is ${comparison.bestCd.rate}%; consider that at the next maturity rather than breaking one early.`,
        };
    }
    if (comparison?.savingsCouldEarnMore) {
        return {
            id: 'rate-gap-savings',
            text: `Your savings earn about ${round1(facts.savingsWeightedApy)}% while a high-yield savings account pays ${comparison.rates.hysa}%; consider moving idle cash.`,
        };
    }
    return {
        id: 'none',
        text: 'No action needed this week; hold course.',
    };
}

/* ---------- templated check-in ---------- */

export function buildHeader(facts, comparison) {
    const f = facts.freshness;
    const lines = [];
    if (f.stale) {
        lines.push(
            `WARNING: Prices are ${f.daysStale} days old (as of ${f.pricesOldest}), net worth below is not current.`,
        );
    }
    if (f.unpriced.length) {
        lines.push(
            `${f.unpriced.join(', ')} (${usd(f.unpricedTotal)}) only update on a CSV import (last import: ${f.lastImport ?? 'never'}).`,
        );
    }
    if (!comparison) {
        lines.push('market rates: unavailable (provide --rates)');
    }
    return lines;
}

export function buildBody(facts, comparison, action) {
    const s = [];
    s.push(
        `Today is ${facts.weekday} ${facts.date}, ISO week ${facts.isoWeek.week}; month end is in ${plural(facts.monthEnd.daysAway, 'day')} (${facts.monthEnd.date}) and quarter end in ${plural(facts.quarterEnd.daysAway, 'day')} (${facts.quarterEnd.date}).`,
    );
    s.push(
        facts.runwayMonths != null
            ? `Net worth is ${usd(facts.netWorth.total)}, which is about ${plural(facts.runwayMonths, 'month')} of runway at current expenses.`
            : `Net worth is ${usd(facts.netWorth.total)}; runway is unavailable (${facts.runwayUnavailable}).`,
    );
    if (facts.cds.length) {
        const dated = facts.cds.find((c) => c.days != null);
        s.push(
            `You hold ${plural(facts.cds.length, 'CD')} totalling ${usd(facts.cdTotal)}` +
                (dated
                    ? `; the next ${dated.days < 0 ? 'one matured' : 'matures'} ${dated.maturity.slice(0, 10)} at ${dated.rate}% (${usd(dated.principal)}).`
                    : '.'),
        );
    } else {
        s.push('No CDs are on file.');
    }
    s.push(
        facts.concentration.length
            ? `Concentration above 10% of net worth: ${facts.concentration.map((c) => `${c.symbol} ${c.percentage}%`).join(', ')}.`
            : 'No single position is above 10% of net worth.',
    );
    if (comparison) {
        const bits = [];
        if (comparison.bestCd && facts.cdWeightedRate != null)
            bits.push(
                `your CDs average ${round1(facts.cdWeightedRate)}% against a best market CD of ${comparison.bestCd.rate}%`,
            );
        if (comparison.rates.hysa != null && facts.savingsWeightedApy != null)
            bits.push(
                `your savings average ${round1(facts.savingsWeightedApy)}% against ${comparison.rates.hysa}% at a high-yield savings account`,
            );
        if (bits.length)
            s.push(
                `On rates, ${bits.join(' and ')}; ${comparison.cdsCouldEarnMore || comparison.savingsCouldEarnMore ? 'you could be earning meaningfully more' : 'nothing meaningfully better is on offer'}.`,
            );
    }
    s.push(`This week's action: ${action.text}`);
    s.push(
        'Stay mindful of spending during this wealth-preservation phase; steady and unexciting is the goal.',
    );
    return s;
}

/* ---------- model (one optional call) ---------- */

export function resolveRouter(env = process.env, home = os.homedir()) {
    let settingsEnv = {};
    try {
        settingsEnv =
            JSON.parse(
                fs.readFileSync(
                    path.join(home, '.claude', 'settings.json'),
                    'utf8',
                ),
            ).env || {};
    } catch {
        // no settings file: env vars only
    }
    return {
        baseUrl: (
            env.ANTHROPIC_BASE_URL ||
            settingsEnv.ANTHROPIC_BASE_URL ||
            DEFAULT_BASE_URL
        ).replace(/\/$/, ''),
        key: env.NINEROUTER_KEY || settingsEnv.NINEROUTER_KEY || null,
    };
}

// One plain chat completion through 9router (OpenAI format). Never throws,
// never includes the key in its result.
export async function chat({
    prompt,
    router,
    model = 'MAX',
    maxTokens = 900,
    timeoutMs = 90_000,
    fetchFn = fetch,
}) {
    if (!router?.key) return { ok: false, reason: 'no router key' };
    try {
        const res = await fetchFn(`${router.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${router.key}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens,
                stream: false,
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { ok: false, reason: `http-${res.status}` };
        const body = await res.json();
        const choice = body.choices?.[0];
        const text = (choice?.message?.content || '').trim();
        if (!text) return { ok: false, reason: 'empty reply' };
        if (choice.finish_reason === 'length')
            return { ok: false, reason: 'truncated reply' };
        return { ok: true, text };
    } catch (e) {
        return { ok: false, reason: e?.name || 'request failed' };
    }
}

export function buildPrompt(facts, comparison, action, body) {
    return [
        'You write the weekly financial check-in for Austin, who is in a wealth-preservation phase and recovering from burnout.',
        'Rewrite the DRAFT below as 5 to 8 calm, plain sentences in one short paragraph. Tone: steady, kind, unhurried, no hype, no alarm.',
        'Rules: use only facts and numbers that appear in the DRAFT or FACTS; do not round, convert or add any number; keep dates as written; keep the single action item clear; end with one sentence reminding him to stay mindful of spending. Output only the paragraph, no headings or lists.',
        '',
        'DRAFT:',
        body.join(' '),
        '',
        'FACTS (JSON):',
        JSON.stringify({ facts, comparison, action }),
    ].join('\n');
}

const numTokens = (text) =>
    (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((t) =>
        t.replace(/,/g, ''),
    );

// A rewrite may reorder and soften wording but must not introduce numbers.
export function numbersPreserved(reply, allowedText) {
    const allowed = new Set(numTokens(allowedText));
    return numTokens(reply).every((t) => allowed.has(t));
}

/* ---------- run ---------- */

function optionValue(argv, i, name) {
    const v = argv[i];
    if (v === undefined || v.startsWith('--'))
        throw new Error(`${name} needs a value`);
    return v;
}

export function parseArgs(argv) {
    const o = { noModel: false, json: false, rates: null, date: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--no-model') o.noModel = true;
        else if (a === '--json') o.json = true;
        else if (a === '--rates') o.rates = optionValue(argv, ++i, '--rates');
        else if (a === '--date') o.date = optionValue(argv, ++i, '--date');
        else throw new Error(`Unknown argument: ${a}`);
    }
    return o;
}

function loadState() {
    const { DB_FILE, readState } = require('../app/lib/db.js');
    // readState would silently return an empty default for a missing file.
    if (!fs.existsSync(DB_FILE)) {
        throw new Error(`fire database not found at ${DB_FILE}`);
    }
    return readState();
}

// Returns { text, json }. All side channels are injectable for tests.
export async function run(
    argv,
    {
        env = process.env,
        now = new Date(),
        readStateFn = loadState,
        fetchFn = fetch,
        warn = (m) => console.error(m),
        home = os.homedir(),
    } = {},
) {
    const opts = parseArgs(argv);
    const today = parseToday(opts.date, now);
    const facts = collectFacts(readStateFn(), today);
    const rates = await loadRates({ file: opts.rates, env, fetchFn, warn });
    const comparison = compareRates(facts, rates);
    const action = pickAction(facts, comparison);
    const header = buildHeader(facts, comparison);
    const body = buildBody(facts, comparison, action);

    let prose = body.join(' ');
    let modelUsed = false;
    if (!opts.noModel && !opts.json) {
        const result = await chat({
            prompt: buildPrompt(facts, comparison, action, body),
            router: resolveRouter(env, home),
            fetchFn,
        });
        if (
            result.ok &&
            numbersPreserved(result.text, `${header.join(' ')} ${prose}`)
        ) {
            prose = result.text;
            modelUsed = true;
        } else {
            warn(
                `model unavailable (${result.ok ? 'reply changed the numbers' : result.reason}); using templated check-in`,
            );
        }
    }
    const text = [...header, ...(header.length ? [''] : []), prose].join('\n');
    return {
        text,
        json: { facts, comparison, action, header, body, modelUsed },
    };
}

const isMain =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run(process.argv.slice(2))
        .then(({ text, json }) => {
            console.log(
                process.argv.includes('--json')
                    ? JSON.stringify(json, null, 2)
                    : text,
            );
        })
        .catch((err) => {
            console.error(`fin-checkin: ${err.message}`);
            process.exit(1);
        });
}
