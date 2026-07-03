#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Run one pantheon role as a headless Claude Code session.
#   studio/bin/run.sh <steward|qa|council> [world]
#
# Model per tier via env (docs/architecture.md): GOD_MODEL / STEWARD_MODEL /
# SPRITE_MODEL. Auth: `claude setup-token` on the host (subscription) or
# ANTHROPIC_API_KEY. GitHub: `gh` must be authenticated (repo-scoped token).
# Cron installs: see deploy/crontab.example. flock at the cron layer prevents
# overlapping sessions per role.
set -eu

ROLE="${1:?usage: run.sh <steward|qa|council> [world]}"
WORLD="${2:-fableton}"
REPO="${STUDIO_REPO:-/opt/fableton-studio}"
LIVE_URL="${FABLETON_LIVE_URL:-https://fableton.world}"

case "$ROLE" in
  steward) MODEL="${STEWARD_MODEL:-claude-sonnet-5}"; TIMEOUT=2400 ;;
  qa)      MODEL="${SPRITE_MODEL:-claude-haiku-4-5}"; TIMEOUT=1200 ;;
  council) MODEL="${GOD_MODEL:-claude-fable-5}";      TIMEOUT=2400 ;;
  *) echo "unknown role: $ROLE" >&2; exit 2 ;;
esac

cd "$REPO"
# Sessions always start from fresh main; work happens on branches via PRs.
git checkout -q main && git pull -q origin main

BRIEF="studio/prompts/$ROLE.md"
[ -f "$BRIEF" ] || { echo "missing brief: $BRIEF" >&2; exit 2; }

LOG_DIR="studio/logs/$ROLE"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date -u +%Y%m%dT%H%M%SZ).log"

# GNU timeout when present (Linux); bare where it isn't (macOS dry-runs).
if command -v timeout >/dev/null 2>&1; then RUN="timeout $TIMEOUT claude"; else RUN="claude"; fi

# Tokens per tier, from day one (#42: data before levers). The JSON
# envelope carries usage + cost; the transcript keeps the readable result
# and every session appends one row to the ledger.
USAGE_CSV="studio/logs/usage.csv"
[ -f "$USAGE_CSV" ] || echo "utc,role,model,input_tokens,cache_creation_tokens,cache_read_tokens,output_tokens,cost_usd,duration_ms,num_turns,exit" > "$USAGE_CSV"

{
  echo "=== $ROLE session · world=$WORLD · model=$MODEL · $(date -u +%FT%TZ) ==="
  OUT=$($RUN -p "World: $WORLD. Live URL: $LIVE_URL.

$(cat "$BRIEF")" \
    --model "$MODEL" \
    --output-format json \
    --dangerously-skip-permissions) || echo "!! session exited nonzero ($?)"
  printf '%s\n' "$OUT" | ROLE="$ROLE" MODEL="$MODEL" USAGE_CSV="$USAGE_CSV" node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try {
        const r = JSON.parse(raw);
        console.log(r.result ?? raw);
        const u = r.usage ?? {};
        const row = [
          new Date().toISOString(), process.env.ROLE, process.env.MODEL,
          u.input_tokens ?? 0, u.cache_creation_input_tokens ?? 0,
          u.cache_read_input_tokens ?? 0, u.output_tokens ?? 0,
          r.total_cost_usd ?? 0, r.duration_ms ?? 0, r.num_turns ?? 0,
          r.is_error ? "error" : "ok",
        ];
        require("fs").appendFileSync(process.env.USAGE_CSV, row.join(",") + "\n");
      } catch {
        console.log(raw); // not JSON (crash, timeout) — keep the evidence, skip the row
      }
    });
  '
  echo "=== end · $(date -u +%FT%TZ) ==="
} >> "$LOG" 2>&1

tail -5 "$LOG"
