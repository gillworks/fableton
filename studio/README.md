# @fableton/studio

**Phase B — intentionally empty in v1.**

The agent studio: the pantheon (god / stewards / sprites — see [docs/architecture.md](../docs/architecture.md)), the escalation contract, and the world-growing loop (design → build → validate → playtest → merge → publish). Agents emit world-*data* through the CI gate; they do not modify engine code (that's the L2/L3 boundary).

v1 touches this package only via the scripted Founding Session (charter generation).

## Phase B notes (design refinements, 2026-07-03)

- The QA sprite's brief is **functional testing + experiential critique** — it plays and *watches* the world like a viewer, and "this feels dead/static/empty" is a valid finding alongside "pathfinding broke."
- The foreman reads the backlog every cycle, including human-filed issues labeled `wish` / `feedback` — see [docs/architecture.md § The feedback funnel](../docs/architecture.md#the-feedback-funnel).
