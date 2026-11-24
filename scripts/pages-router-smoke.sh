#!/bin/sh
# Smoke test for the Cloudflare Pages Function router, run against
# `wrangler pages dev app` with no secrets (see .github/workflows/pages-router.yml).
# Usage: scripts/pages-router-smoke.sh [base-url]
set -u
BASE="${1:-http://127.0.0.1:8788}"
fail=0

# check <path> <expected status> <body substring or ''> <json: 1|0>
check() {
    out=$(curl -sS -m 15 -o /tmp/body -w '%{http_code} %{content_type}' "$BASE$1") || { echo "FAIL $1: curl error"; fail=1; return; }
    code=${out%% *}; ctype=${out#* }
    ok=1
    [ "$code" = "$2" ] || ok=0
    if [ "$4" = 1 ]; then case "$ctype" in *json*) ;; *) ok=0;; esac; fi
    if [ -n "$3" ]; then grep -q "$3" /tmp/body || ok=0; fi
    if [ $ok = 1 ]; then echo "ok   $1 -> $code"; else echo "FAIL $1 -> $code ($ctype): $(head -c 200 /tmp/body)"; fail=1; fi
}

check /api/health 200 '' 1
check /api/sync/ebay/marketplace-account-deletion 503 '' 1
check /api/sync/ebay/status 200 '"configured":false' 1
check /api/state 404 '' 1
check /nope 404 '' 0
exit $fail
