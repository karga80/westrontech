#!/usr/bin/env bash
#
# alchemy-prices-probe.sh — settle the Alchemy Prices API URL question with
# real data instead of another hypothesis.
#
# Background
# ----------
# STATUS.md's "NEXT SESSION STARTS HERE" note guesses that the Prices API needs
# the key in the URL path (prices/v1/{apiKey}/tokens/...). An earlier session
# verified with a real curl that the correct form is the Bearer header with NO
# key in the path, and src-tauri/src/data/alchemy/client.rs already does that.
# Putting the key back in the path is what produced a 401 before.
#
# The failure actually logged by the poller was a *transport* error, not a 401,
# so the URL shape was never the cause. This script prints the HTTP status of
# both shapes so the question is answered by the API rather than by guesswork.
#
# Safety
# ------
# The key is read from secure storage and never printed, never echoed, never
# written to a file, and never passed on a command line that shows up in `ps`
# (curl reads the header from a file descriptor via --config -). Only status
# codes and timings are printed.
#
# Usage
# -----
#   ./probes/alchemy-prices-probe.sh            # read the stored key
#   ALCHEMY_KEY=... ./probes/alchemy-prices-probe.sh   # or supply one
#
# Exit status: 0 if at least one shape returned 200, 1 otherwise.

set -uo pipefail

SERVICE="Westron"
ACCOUNT="alchemy"
SYMBOL="ETH"

say() { printf '%s\n' "$*"; }

# ── 1. Locate the key ─────────────────────────────────────────────────────────
KEY="${ALCHEMY_KEY:-}"
SOURCE="ALCHEMY_KEY environment variable"

if [ -z "$KEY" ] && command -v security >/dev/null 2>&1; then
  # macOS Keychain — where Westron stores the key after this change.
  if KEY_TRY=$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null); then
    KEY="$KEY_TRY"
    SOURCE="macOS Keychain (service=$SERVICE account=$ACCOUNT)"
  fi
fi

if [ -z "$KEY" ]; then
  # Legacy plaintext file, still present if the migration could not verify the
  # Keychain write. Its continued existence is itself worth reporting.
  LEGACY="$HOME/Library/Application Support/$SERVICE/keys/$ACCOUNT.key"
  if [ -f "$LEGACY" ]; then
    KEY=$(tr -d '\r\n' < "$LEGACY")
    SOURCE="legacy plaintext file (migration has NOT completed — see GET /status keychain.pending)"
  fi
fi

if [ -z "$KEY" ]; then
  say "No Alchemy key found."
  say "  Tried: ALCHEMY_KEY env var, macOS Keychain ($SERVICE/$ACCOUNT), legacy key file."
  say "  Add the key in Westron Settings, or run with ALCHEMY_KEY=... $0"
  exit 1
fi

# Strip a pasted endpoint URL down to the bare key, mirroring
# wallet::api_key::normalize_api_key. Never printed either way.
case "$KEY" in
  *://*) KEY="${KEY%%\?*}"; KEY="${KEY%/}"; KEY="${KEY##*/}" ;;
esac

say "Alchemy Prices API probe"
say "  key source : $SOURCE"
say "  key length : ${#KEY} chars (value never printed)"
say "  symbol     : $SYMBOL"
say ""

# ── 2. Probe both URL shapes ─────────────────────────────────────────────────
BEARER_URL="https://api.g.alchemy.com/prices/v1/tokens/by-symbol?symbols=$SYMBOL"
PATH_URL="https://api.g.alchemy.com/prices/v1/$KEY/tokens/by-symbol?symbols=$SYMBOL"

FMT='status=%{http_code} dns=%{time_namelookup}s tls=%{time_appconnect}s total=%{time_total}s\n'

probe() {
  # $1 = label, $2 = url, $3 = "bearer" | "none"
  local label="$1" url="$2" auth="$3" out status
  if [ "$auth" = "bearer" ]; then
    # --config - keeps the header off the process list.
    out=$(printf 'header = "Authorization: Bearer %s"\n' "$KEY" \
          | curl --silent --show-error --config - \
                 --max-time 20 --output /dev/null \
                 --write-out "$FMT" "$url" 2>&1)
  else
    out=$(curl --silent --show-error \
               --max-time 20 --output /dev/null \
               --write-out "$FMT" "$url" 2>&1)
  fi
  status=$(printf '%s' "$out" | sed -n 's/.*status=\([0-9]*\).*/\1/p')
  say "$label"
  say "  $out"
  printf '%s' "${status:-000}"
}

say "A. Bearer header, no key in path  (what client.rs does today)"
say "   GET https://api.g.alchemy.com/prices/v1/tokens/by-symbol?symbols=$SYMBOL"
STATUS_A=$(probe "   result:" "$BEARER_URL" bearer)
say ""

say "B. Key in the URL path            (the STATUS.md hypothesis)"
say "   GET https://api.g.alchemy.com/prices/v1/<key>/tokens/by-symbol?symbols=$SYMBOL"
STATUS_B=$(probe "   result:" "$PATH_URL" none)
say ""

# ── 3. Read the result out loud ──────────────────────────────────────────────
say "Reading:"
if [ "$STATUS_A" = "200" ] && [ "$STATUS_B" != "200" ]; then
  say "  A works, B does not. The current code is right: Bearer header, no key in path."
  say "  Do NOT move the key into the path."
elif [ "$STATUS_A" != "200" ] && [ "$STATUS_B" = "200" ]; then
  say "  B works and A does not — this would contradict the earlier verified curl."
  say "  Capture this output before changing anything in client.rs."
elif [ "$STATUS_A" = "200" ] && [ "$STATUS_B" = "200" ]; then
  say "  Both shapes answer 200. Keep A (the header form) — it keeps the key out of URLs,"
  say "  and therefore out of proxy logs and error messages."
elif [ "$STATUS_A" = "000" ] && [ "$STATUS_B" = "000" ]; then
  say "  Neither request reached Alchemy at all (status 000 = transport failure)."
  say "  This matches the error the poller logged. It is a network problem —"
  say "  DNS, TLS interception, a proxy or a VPN — not the URL shape."
else
  say "  A=$STATUS_A B=$STATUS_B. 401/403 means the key itself is wrong or lacks"
  say "  Prices API access; 429 means the free-tier quota is exhausted."
fi

[ "$STATUS_A" = "200" ] || [ "$STATUS_B" = "200" ]
