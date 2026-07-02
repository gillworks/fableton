# Deploy

Target: **one command founds a world.** `docker compose up` + a charter file → an explorable world, on any server. (Compose file lands with the "one-command deploy" v1 issue.)

v1 services: `caddy` (client + chunks + API proxy) · `world-sim` · `world-api` · `postgres`.
Phase B adds: `studio` (agent runtime) · `qa-bot` · orchestration control plane.
Phase C adds: `streamer` (director-cam client + FFmpeg → RTMP).

Configuration is env-only (bring-your-own-keys): copy `.env.example` (added with the compose issue), set `ANTHROPIC_API_KEY` + model tiers + world charter path. The compose default has zero external dependencies — Postgres runs in-stack, swappable for a managed provider via env.
