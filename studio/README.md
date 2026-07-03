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

## Phase B files (this package)

- `prompts/steward.md` · `prompts/qa.md` · `prompts/council.md` — the three role briefs. Self-contained: a fresh headless session given only the brief + this repo performs its cycle.
- `bin/run.sh <role> [world]` — the headless runner: fresh `main`, role model from env, brief injected, transcript to `studio/logs/<role>/` (gitignored).
- `bin/validate-artifacts.ts [world]` — divine artifacts vs engine schemas (absent = valid; invalid = fail). No argument = every world; `pnpm validate` runs that form, so an invalid decree log fails the same gate as an invalid chunk (#41).
- Install cadence: `deploy/crontab.example`. The studio runs from its **own clone** (default `/opt/fableton-studio`, `STUDIO_REPO` to change) — never the auto-deploy clone, which must stay fast-forward-only.

The full loop: sprite files findings → steward PRs world-data through the gate → auto-merge on green → auto-deploy syncs the live world from the repo → council audits every merge, rules petitions, sets direction. The repo is the coordinator; nobody talks live.

## The escalation contract (#41)

Escalations are the only channel by which law questions travel upward. The contract, end to end:

1. **Raise.** The steward (mid-build, per `prompts/steward.md`) or the QA sprite (on a charter contradiction in shipped content, per `prompts/qa.md`) opens an issue titled `Petition: …` with the **`escalation`** label — two sentences: what needs ruling, and the cheapest ruling that unblocks. The steward ends its session without building; sprites never build anyway. Nobody else sets the label; humans wanting things use `wish` / `feedback`.
2. **Rule.** The next council session answers **every** open `escalation` issue (a petition never survives a council unanswered): a ruling comment of two or three sentences citing the charter section or decree that grounds it, then close — or relabel `wish` when the ruling turns the petition into buildable work.
3. **Record.** A ruling that sets precedent (anything a future steward must obey) is appended to `worlds/<world>/artifacts/decrees.json` in the same council PR, and the ruling comment cites its decree (`Decree N`). A one-off clarification with no precedent needs no decree — scarcity keeps decrees load-bearing.
4. **The ceiling.** A petition that requires changing the charter itself is relabeled `escalation,needs-ep-review` and argued to the founder, who ratifies or refuses; the council never edits the constitution.

## Context assembly (the cache-friendly prefix)

Every role brief opens by reading the same documents in the same order — charter → `artifacts/master-plan.json` → `artifacts/decrees.json` (→ `amendments/`) → the recent chronicle — before any session-specific input (backlog, PR list, findings). Stable, slow-changing law first and volatile context last keeps the shared prefix of consecutive sessions identical, which is exactly what prompt caching rewards; it is also why decrees are append-only. When editing a brief, preserve that order.

### Non-root requirement (learned in production)

Claude Code refuses `--dangerously-skip-permissions` under root — correctly. The pantheon runs as a dedicated `studio` user that owns its own clone; `deploy/crontab.example` documents the full user setup, including the one-time bootstrap pull (the clone must already contain `run.sh` before cron can invoke it) and token handling (`claude setup-token` → the token lives in the studio user's crontab header, never in world-readable `/etc/environment`). The log file needs `chown studio` once: `touch /var/log/fableton-studio.log && chown studio:studio /var/log/fableton-studio.log`.
