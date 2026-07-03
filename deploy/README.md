# Deploy

Target: **one command founds a world.**

```sh
cd deploy && docker compose up -d
# → explorable world at http://localhost:8080 (FABLETON_PORT to change)
```

First boot founds the world into the `world-data` volume: charters with a committed starter world (`worlds/<name>/` — the flagship's town, Cindervault, Skeinsea) boot it, residents included; any other charter generates a fresh skeleton world. Every boot re-runs the validation gate before serving — an invalid world never comes up. `docker compose down -v` forgets the world; without `-v` it persists.

**Updating a running world** to the latest engine:

```sh
cd /path/to/fableton && git pull && cd deploy && docker compose up -d --build
```

Updates never reset the world — `world-data` persists and the gate re-validates it on boot. Instance files (`.env`, a local `compose.override.yaml`) are untracked and survive pulls. The only world-destroying command is `down -v`.

**Auto-deploy** (optional): [`auto-deploy.sh`](auto-deploy.sh) is a pull-based poller — it fast-forwards to `origin/main` and rebuilds only when main moves, refuses to run off-main or on a diverged clone, and needs no secrets or inbound access. Install via the cron line in the script header. A failed build leaves the running world untouched.

**Engine updates ≠ world updates.** Auto-deploy ships *code*; a founded world keeps its own state by design. Changes to a *starter world* (`worlds/<name>/`, fixtures) only apply at founding — a running world receives new content through the studio pipeline (Phase B), not through git. Pre-agents, the way to adopt a new starter is to re-found: `docker compose down -v && docker compose up -d` — acceptable only while the world has no grown state worth keeping.

v1 services: `caddy` (client + chunks + API proxy) · `world-sim` · `world-api` · `postgres`.
Phase B adds: `studio` (agent runtime) · `qa-bot` · orchestration control plane.
Phase C adds: `streamer` (director-cam client + FFmpeg → RTMP).

Configuration is env-only (bring-your-own-keys): copy `.env.example`, set `ANTHROPIC_API_KEY` + model tiers (used by the studio from Phase B; the v1 stack needs no keys) + `FABLETON_CHARTER`. The compose default has zero external dependencies — Postgres runs in-stack (carried for Phase B's world-state/chronicle/queue; v1 doesn't consume it yet), swappable for a managed provider by setting `DATABASE_URL`.

v1 note: `world-sim` + `world-api` run as one `world` service — one process shares the live `WorldSim`, which is what makes the behavior-tree update endpoint hot-swap. They split when Phase B gives them separate lifecycles.
