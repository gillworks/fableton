# Deploy

Target: **one command founds a world.**

```sh
cd deploy && docker compose up -d
# → explorable world at http://localhost:8080 (FABLETON_PORT to change)
```

First boot founds the world into the `world-data` volume: charters with a committed starter world (`worlds/<name>/` — the flagship, Cindervault, Skeinsea) boot it, residents included; any other charter generates a fresh skeleton world. Every boot re-runs the validation gate before serving — an invalid world never comes up. `docker compose down -v` forgets the world; without `-v` it persists.

v1 services: `caddy` (client + chunks + API proxy) · `world-sim` · `world-api` · `postgres`.
Phase B adds: `studio` (agent runtime) · `qa-bot` · orchestration control plane.
Phase C adds: `streamer` (director-cam client + FFmpeg → RTMP).

Configuration is env-only (bring-your-own-keys): copy `.env.example`, set `ANTHROPIC_API_KEY` + model tiers (used by the studio from Phase B; the v1 stack needs no keys) + `FABLETON_CHARTER`. The compose default has zero external dependencies — Postgres runs in-stack (carried for Phase B's world-state/chronicle/queue; v1 doesn't consume it yet), swappable for a managed provider by setting `DATABASE_URL`.

v1 note: `world-sim` + `world-api` run as one `world` service — one process shares the live `WorldSim`, which is what makes the behavior-tree update endpoint hot-swap. They split when Phase B gives them separate lifecycles.
