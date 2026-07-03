# Architecture

## The shape of the system

A **world instance** is shared-nothing: one server, one compose stack, one world. The engine is identical everywhere; the Charter + seed + grown state make each instance unique.

```
Charter + seed ──▶ deterministic generation ──▶ chunks/manifest (static JSON, CDN-cacheable)
Agents (Phase B) ──▶ PRs of world-DATA ──▶ CI gate ──▶ merge = the world grows
world-sim (authoritative) ──▶ WebSocket deltas ──▶ every client (viewers, bots, stream)
```

## Services (per-world compose stack)

| Service | Role |
|---|---|
| `world-sim` | **The authoritative simulation**: NPC behavior trees, world clock, live events. Broadcasts compact WebSocket deltas (1–5 Hz; clients interpolate) to all consumers. |
| `world-api` | Lore/REST endpoints, wish intake (Phase C), admin config (audit slider, escalation cap), **behavior-tree update endpoint**. |
| `postgres` | World-state, chronicle/decision log, job queue (pg-boss). One Postgres, no Redis. |
| `caddy` | Serves the client bundle + chunk JSON, reverse-proxies the APIs. |
| `studio` | Phase B: the agent runtime (the pantheon below). |
| `qa-bot` ×N | Phase B: headless Chromium running the real client, agent-driven playtests. |
| `streamer` | Phase C: the same client in director-cam mode, headless + FFmpeg → RTMP. |

Static pieces (world hub landing page, client bundle) can live on any static host. Chunks serve from the instance behind a CDN cache. Postgres can be swapped for a managed provider via env — the compose default has **zero external dependencies**.

## The pantheon (model tiering — Phase B agents)

Strategic direction runs rarely on the strongest model; operational work runs continuously on cheap ones. One expensive session produces durable **law** (charter, master plan, decrees) that thousands of cheap calls execute against as stable cached context.

| Tier | Default model (env-configurable) | Role | Cadence |
|---|---|---|---|
| God | `GOD_MODEL=claude-fable-5` | Charter authorship, master plan & seasons, taste audit, consolidation/retcons, amendments, escalations | Scheduled sessions + escalations |
| Stewards | `STEWARD_MODEL=claude-sonnet-5` | Foreman (orchestration), world designers, lore, art ops, narrator | Per work item |
| Sprites | `SPRITE_MODEL=claude-haiku-4-5` | QA bot actions — **functional testing *and* experiential critique** (play/watch like a viewer: "the square feels dead at high sun" is a finding) — intake/triage, ticker | Continuous, paced |
| Tier 0 | *(no model)* | Generation, validation, schedulers, **NPC behavior trees** | Every frame |

**Tier 0 carries the load.** NPCs run deterministic behavior trees at frame rate; the trees are world-data with an update API — occasionally *regenerated* by an agent when a character's story changes, never per-decision inference. The LLM writes the mind; the engine runs it.

**Escalation contract (summary):** scheduled god sessions (founding, daily council, weekly consolidation) + a taste-audit sample of merges (admin-configurable 0–100%) + event-driven escalation rules (charter ambiguity, continuity conflicts, novel art direction, law-changing requests). Down-rules: the god never assigns individual work items or writes content directly. A human executive producer sits above the god (art direction, pivots, budget).

**The data/code seam in practice:** a finding that's buildable as world-*data* (richer behavior trees, new region, more lore) flows backlog → steward → PR → gate. A finding that requires an engine *capability* (new schema field, new client surface — e.g. "viewers can't see what NPCs are thinking") is not buildable by studio agents: the foreman escalates, the god rules it an engine gap and decrees an engine issue, and it lands with the dev-agent rails under EP review. Studio agents notice, diagnose, and propose across the seam; they only build on the data side of it.

## The feedback funnel

One funnel, three sources, all landing in the world repo's backlog, read by the foreman every cycle:

| Source | Channel | When |
|---|---|---|
| Founder / EP | GitHub issues labeled **`wish`** or **`feedback`** | Now |
| QA sprites | Playtest findings (functional + experiential) filed as issues | Phase B |
| Viewers | In-client wish box → intake sprite triages → backlog | Phase C |

Types: **`wish`** = a content request ("build a lighthouse") — triaged into the backlog. **`feedback`** = an experiential observation ("NPCs feel static") — diagnosed first (data gap vs capability gap), then routed per the seam above. A wish or feedback item that would change world *laws* escalates to the god as a constitutional question.

**Divine artifacts:** everything the god produces is a durable, versioned file in the world repo — charter (immutable; amendable only via constitutional act), master plan (rolling), decrees (append-only), world-bible amendments. Lower-tier calls carry `[charter + world-bible core + master plan]` as a stable context prefix, task-specific content after it — that ordering is what makes prompt caching work across the fleet.

## The explore surface

Each world has a public URL where it runs live in the browser. Visual language: [design.md](design.md) — charter-themed dioramas; the UI theme (palette, typography, accent, day-phase names) is charter data, the layout grammar is engine-fixed.

- **One client (Three.js — see [ADR-0002](adr/0002-client-rendering-stack.md)), three camera modes**: explore (drag/zoom/orbit — the public default), walk (later), director (cinematic auto-cam; the `streamer` service is this client headless).
- **Static geometry** streams as cached chunks; **dynamic state** (NPC transforms, activity, clock, events) arrives over the `world-sim` WebSocket. Slow ticks + interpolation ⇒ thousands of concurrent viewers per instance.
- **Click-to-inspect**: raycast pick → panel with name, portrait, story, relationships (lore via `world-api`) + current activity read from live behavior-tree state. This is why every tree node must carry a diegetic label.
- **The studio, visible in-world** (Phase B/C): regions under generation render as construction sites; clicking one links to the open PR, the agent working it, CI status.
- Inspection is read-only; world mutation flows only through the agent pipeline (and, Phase C, the viewer-wish queue).

## Keys & configuration

Bring-your-own-keys, all via env: `ANTHROPIC_API_KEY` (or an authenticated Claude Code runtime for the studio), model tier overrides (`GOD_MODEL`, `STEWARD_MODEL`, `SPRITE_MODEL`), Twitch/social keys (Phase C). The repo ships no secrets; `.env` is gitignored.
