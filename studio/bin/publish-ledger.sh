#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Publish the redacted per-tier ledger surface off-box so milestone #42's
# week-close "tokens per tier" is readable without SSH to the studio VPS
# (fableton#78). Regenerates the snapshot from the box-local usage.csv and
# commits it to a dedicated `ledger` branch (kept off `main`, rebuilt from
# current origin/main each run so it stays clean and browsable on GitHub).
#
# Cron runs this after the council session — see deploy/crontab.example.
# Requires git + gh already authenticated on the box (same token as run.sh).
# The token needs Contents write; it never touches `main` or branch protection.
set -eu

REPO="${STUDIO_REPO:-/opt/fableton-studio}"
BRANCH="${LEDGER_BRANCH:-ledger}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

cd "$REPO"
git fetch -q origin main

WORK=$(mktemp -d)
trap 'git worktree remove -f "$WORK" 2>/dev/null || true; rm -rf "$WORK"' EXIT
git worktree add -q -f -B "$BRANCH" "$WORK" origin/main

# Read the box-local (gitignored) ledger; write the surface into the worktree.
USAGE_CSV="$REPO/studio/logs/usage.csv" LEDGER_DIR="$WORK/studio/ledger" \
  node "$SCRIPT_DIR/ledger-snapshot.mjs"

cd "$WORK"
git add studio/ledger/tokens-per-tier.md studio/ledger/tokens-per-tier.csv
if git diff --cached --quiet; then
  echo "ledger surface unchanged — nothing to publish"
  exit 0
fi
git commit -q -m "chore(ledger): per-tier token snapshot

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
git push -q -f origin "$BRANCH"
echo "published $BRANCH: $(git rev-parse --short HEAD)"
