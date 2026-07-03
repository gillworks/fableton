# SPDX-License-Identifier: Apache-2.0
#
# One Dockerfile, two targets:
#   world  — the authoritative process: founds the world on first boot
#            (generate or flagship starter), gates it, serves sim + api
#   static — caddy with the built client, the asset kit, and the proxy
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY engine/package.json engine/
COPY client/package.json client/
COPY studio/package.json studio/
RUN pnpm install --frozen-lockfile
COPY engine engine
COPY client client
COPY charters charters
COPY worlds worlds
COPY assets assets
COPY deploy deploy
RUN pnpm --dir client build

FROM node:20-alpine AS world
RUN corepack enable
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 8090 8091
ENTRYPOINT ["sh", "deploy/world-entrypoint.sh"]

FROM caddy:2-alpine AS static
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/caddy-entrypoint.sh /usr/local/bin/caddy-entrypoint.sh
ENTRYPOINT ["sh", "/usr/local/bin/caddy-entrypoint.sh"]
COPY --from=builder /app/client/dist /srv/dist
COPY --from=builder /app/assets /srv/assets
