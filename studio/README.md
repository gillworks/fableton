# @fableton/studio

**Phase B — intentionally empty in v1.**

The agent studio: the pantheon (god / stewards / sprites — see [docs/architecture.md](../docs/architecture.md)), the escalation contract, and the world-growing loop (design → build → validate → playtest → merge → publish). Agents emit world-*data* through the CI gate; they do not modify engine code (that's the L2/L3 boundary).

v1 touches this package only via the scripted Founding Session (charter generation).

## Phase B notes (design refinements, 2026-07-03)

- The QA sprite's brief is **functional testing + experiential critique** — it plays and *watches* the world like a viewer, and "this feels dead/static/empty" is a valid finding alongside "pathfinding broke."
- The foreman reads the backlog every cycle, including human-filed issues labeled `wish` / `feedback` — see [docs/architecture.md § The feedback funnel](../docs/architecture.md#the-feedback-funnel).

## Runtime — DECIDED 2026-07-03: cron-fired headless Claude Code

The thin slice runs **without an orchestration platform**. The repo is the coordinator (issues, PRs, decrees); the three agents never talk live:

- Each role is a headless Claude Code session: `studio/bin/run.sh <role>` invokes `claude -p` with the role's brief from `studio/prompts/`, model per tier (`GOD_MODEL` / `STEWARD_MODEL` / `SPRITE_MODEL`).
- Scheduling is cron on the world host: steward every few hours, QA sprite twice daily, council daily. At a 100% audit slider, the council *is* the taste audit (it reviews every merge since last session).
- Auth: subscription token on the box (`claude setup-token`), `ANTHROPIC_API_KEY` as fallback.
- Coordination artifacts: backlog issues (`wish` / `feedback` / `escalation` labels) in; PRs, decrees, master-plan updates, chronicle lines out.

An orchestration control plane (e.g. Paperclip) is deliberately **not** part of the slice — re-evaluate after the First Autonomous Week milestone, when continuous operation, per-agent budget enforcement, and a single ops dashboard become load-bearing. Anything added then lives in `/deploy` config, never woven through engine or studio code.
