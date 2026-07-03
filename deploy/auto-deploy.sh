#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Pull-based auto-deploy: track origin/main; rebuild when it moves.
# No secrets, no inbound access — the instance watches the public repo.
# CI gates main before merge; the boot gate re-validates the world anyway.
#
# Install (cron, every 2 min, flock prevents overlapping builds):
#   */2 * * * * flock -n /run/fableton-deploy.lock /opt/fableton/deploy/auto-deploy.sh >> /var/log/fableton-deploy.log 2>&1
set -e
REPO_DIR="${FABLETON_DIR:-/opt/fableton}"
cd "$REPO_DIR"

BRANCH=$(git symbolic-ref --short HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "[$(date -u +%FT%TZ)] not on main (on $BRANCH) — refusing to auto-deploy" >&2
  exit 1
fi

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "[$(date -u +%FT%TZ)] deploying $(git rev-parse --short HEAD) -> $(git rev-parse --short origin/main)"
# --ff-only: if the instance clone ever diverges (on-box edits), stop and
# complain rather than merge — a human untangles, the world keeps serving.
git merge --ff-only origin/main
cd deploy && docker compose up -d --build
echo "[$(date -u +%FT%TZ)] deployed $(git rev-parse --short HEAD):"
docker compose ps --format '{{.Name}}: {{.Status}}'
