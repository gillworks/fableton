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

if [ ! -f "$WORLD/manifest.json" ]; then
  if [ "$CHARTER" = "charters/_template/charter.yaml" ]; then
    echo "founding the flagship from its hand-authored starter world"
    cp -R /app/engine/test/fixtures/sample-world/. "$WORLD/"
  else
    echo "founding a new world from $CHARTER"
    pnpm --dir /app/engine exec tsx src/generate/cli.ts --charter "/app/$CHARTER" --out "$WORLD"
  fi
fi

# The gate is the standard — an invalid world never serves.
pnpm --dir /app/engine exec tsx src/validate/cli.ts --charter "/app/$CHARTER" --world "$WORLD"

exec pnpm --dir /app/engine exec tsx src/api/cli.ts --charter "/app/$CHARTER" --world "$WORLD"
