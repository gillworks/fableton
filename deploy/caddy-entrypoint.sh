#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# The social card comes from the world's charter, not instance env
# (issue #55): the world container writes /world/og.env at boot; source
# it before caddy renders the {{env ...}} placeholders. The wait covers
# first boot, when caddy can start before the world finishes founding.
# Engine-generic fallbacks cover a volume that never gets the file.
i=0
while [ ! -f /world/og.env ] && [ $i -lt 60 ]; do i=$((i + 1)); sleep 1; done

if [ -f /world/og.env ]; then
  . /world/og.env
else
  echo "og.env never appeared — serving engine-default social card" >&2
fi
export OG_TITLE="${OG_TITLE:-Fableton — charter-founded worlds, grown by an autonomous studio}"
export OG_DESC="${OG_DESC:-An open-source engine where AI agents grow living worlds in public. Every change is a PR.}"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
