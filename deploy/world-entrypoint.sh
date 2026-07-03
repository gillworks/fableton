#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# First boot founds the world; every boot gates it before serving.
# - Default charter (the template): the flagship's hand-authored starter
#   world, residents included.
# - Any other charter: deterministic skeleton generation (agents move the
#   residents in later phases).
set -e
CHARTER="${FABLETON_CHARTER:-charters/_template/charter.yaml}"
WORLD=/world

if [ ! -f "/app/$CHARTER" ]; then
  echo "✗ charter not found in the image: $CHARTER" >&2
  exit 1
fi

# Phase B: for worlds committed to the repo (worlds/<name>/), the REPO is the
# source of truth — the studio grows the world through merged PRs, auto-deploy
# rebuilds, and every boot re-syncs the volume from the repo. This holds until
# runtime mutation exists (live behavior-tree hot-swaps that must persist);
# at that point sync becomes a merge, not a wipe.
NAME=$(basename "$(dirname "$CHARTER")")
[ "$CHARTER" = "charters/_template/charter.yaml" ] && NAME=fableton
if [ -d "/app/worlds/$NAME" ]; then
  echo "syncing $NAME from the world repo (repo is source of truth)"
  rm -rf "$WORLD"/* 2>/dev/null || true
  cp -R "/app/worlds/$NAME/." "$WORLD/"
elif [ ! -f "$WORLD/manifest.json" ]; then
  echo "founding a new world from $CHARTER"
  # First boot IS the founding — stamp it so the clock survives redeploys.
  pnpm --dir /app/engine exec tsx src/generate/cli.ts --charter "/app/$CHARTER" --out "$WORLD" \
    --founded-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# The gate is the standard — an invalid world never serves.
pnpm --dir /app/engine exec tsx src/validate/cli.ts --charter "/app/$CHARTER" --world "$WORLD"

exec pnpm --dir /app/engine exec tsx src/api/cli.ts --charter "/app/$CHARTER" --world "$WORLD"
