# ADR-0004: Wish-ledger schema

**Status:** Proposed (implemented in `@fableton/engine`; awaits EP review — `needs-ep-review`)
**Date:** 2026-07-10
**Petition:** [gillworks/fableton#172](https://github.com/gillworks/fableton/issues/172) (`wish` + `needs-ep-review`) · master plan rev 7, goal 1 · thematically the Council's "season of the open book" (#174)

## Context

Winsome, the wishing-well attendant, keeps a book: wishes fished from the well and filed by sincerity, pledges the town makes against them, and debts "closed at compound narrative interest." Today that book lives **only in prose** — behavior-tree labels in `worlds/fableton/npcs/winsome.json` and chronicle lines (the bridge wish, PR #144 → Tam's match closing its debt, PR #171). Nothing off-page, no schema, no way for a viewer to inspect the well's account or for the gate to check it holds together.

Petition #172 asks to give the book a container so a future world-data session can move it off-page as JSON. This is the same shape as ADR-0001's ruling for behavior trees and the rumors doc (#81): **world-DATA gets a versioned Zod schema in the engine; the entries are authored under `worlds/`.**

### The seam (data vs. code)

Per `docs/architecture.md` and CLAUDE.md invariant 1, the routing is clean:

- **Engine / code (this ADR):** the *container* — field shapes, versioning, and the integrity checks. No world content is hardcoded; nothing named "Winsome" or "the bridge" lives in engine code (the `keeper` default is a slug, defaulted for ergonomics, overridable per world).
- **World / data (out of scope here, Council territory):** the *entries* — the actual wishes, pledges, and accounting lines under `worlds/fableton/wish-ledger.json`. Writing that file is a `worlds/` change and belongs to the pantheon, not to engineering.

So this ADR ships the schema, its tests, and the gate wiring; it deliberately does **not** add `worlds/fableton/wish-ledger.json`.

## Decision

### Schema shape

`engine/src/schemas/wishLedger.ts` (exported from the engine index). A document is one well's book:

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `literal(WORLD_DATA_SCHEMA_VERSION)` | see **Versioning** below |
| `keeper` | `idSlug` (default `winsome`) | the resident who keeps the book; resolves to a placed NPC |
| `wishes` | `Wish[]` | one entry per wish |

Each **`Wish`**:

| Field | Type | Notes |
|---|---|---|
| `id` | `idSlug` | unique within the ledger |
| `text` | non-empty | the wish as recorded — viewer-facing |
| `sincerity` | `'sincere' \| 'insincere'` | Winsome files by sincerity; insincere = "gold-egg wishes" |
| `status` | `'standing' \| 'paid' \| 'returned'` | owed / closed / coin returned |
| `wisher` | non-empty, optional | usually anonymous (a coin in a well), so free text, not an NPC ref |
| `recorded_on` | non-empty | the beat the well filed it (diegetic string, not a machine date) |
| `closed_on` | non-empty, optional | the beat the debt was settled; required once not `standing` |
| `pledges` | `Pledge[]` (default `[]`) | promises made against the wish |
| `accounting` | `LedgerLine[]` (default `[]`) | the compound-interest account, oldest line first |
| `notable` | boolean (default `true`) | writes a chronicle line on state changes |

Each **`Pledge`**: `id` (slug, unique within the wish), `by` (`idSlug` → a placed NPC), `what` (non-empty, diegetic), `redeemed` (bool, default `false`), `redeemed_on` (optional).

Each **`LedgerLine`** (the "compound narrative interest" the chronicle already narrates): `on` (beat), `note` (the account line — "filed under owed, not granted"; "counting the stone in her head"; "closed at compound interest"), `chronicle_ref` (optional, e.g. `"PR #144"`).

**Cross-field invariants** live in the schema's `.check()` (like the rumors duplicate-id check):

- insincere ⇒ `returned`; sincere ⇒ never `returned` (a coin is returned, never owed).
- `closed_on` present iff `status !== 'standing'`.
- a `paid` wish may not carry an unredeemed pledge — the debt closes only once every promise against it is kept.
- wish ids unique across the ledger; pledge ids unique within a wish.

### Versioning

`schema_version` reuses the shared `WORLD_DATA_SCHEMA_VERSION` (currently `1`) from `engine/src/schemas/common.ts`, exactly as chunks, manifest, assets, NPCs, and rumors do. `common.ts` already documents the split rule: *"version together for now; split into per-schema versions if they ever migrate independently."* The wish-ledger joins that shared cohort — no new version axis until it needs to migrate on its own.

### Where the validation check lives

Mirrors the rumors block in `engine/src/validate/validateWorld.ts` (the merged pattern for an optional world-data doc), and follows the **FABA-69 / PR #167** precedent for wiring a new world-data check into the gate (a new document class added to `WorldDocs`, parsed against its own file, cross-checked against the residents):

- `WorldDocs.wishLedger?` is optional — a world with no well simply omits it (like `rumors?`).
- `validateWorld` parses it with `WishLedgerDocSchema`; a parse failure is a `schema-valid` violation naming `wish-ledger.json`.
- Ref resolution (rule `asset-refs-resolve`, the same rule a rumor's `origin` uses): the `keeper` resolves to a placed NPC, and every pledge's `by` resolves to a placed NPC — a promise from no one is no promise.
- `engine/src/validate/cli.ts` loads `worlds/<name>/wish-ledger.json` when present, so `pnpm validate` covers it automatically.

Note on advisory-vs-hard: PR #167's `severity: warning` advisory mechanism is **not yet merged to `main`**, so this check is a **hard** integrity check (like rumors), not an advisory taste heuristic. That is the right call — a pledge by a non-existent resident is a broken reference, not a matter of taste. If a future *taste-level* wish check is wanted (e.g. "every standing debt should have at least one pledge"), that is the natural place to adopt the FABA-69 advisory-warning pattern once it lands.

## Migration path for the prose-tracked wishes

The prose tracks **one recorded sincere wish — the millstream bridge — carried from a coin to a closed debt over four pledges.** ("Four" in petition #172 refers to the four pledges against the bridge wish, redeemed in order; the well has recorded exactly one debt-bearing wish so far, plus the uncounted "gold-egg" insincere coins Winsome returns.)

A future world-data session authoring `worlds/fableton/wish-ledger.json` maps the prose to **one `Wish` entry** roughly as:

```jsonc
{
  "id": "the-millstream-bridge",
  "text": "a bridge over the mill stream",
  "sincerity": "sincere",
  "status": "paid",              // closed by Tam's match, PR #171
  "recorded_on": "council 2026-07-06 / PR #144",
  "closed_on": "PR #171",
  "pledges": [
    { "id": "quills-goose",  "by": "quill",      "what": "…", "redeemed": true, "redeemed_on": "PR #164" },
    { "id": "humble-pots-pot", "by": "humble-pot", "what": "…", "redeemed": true, "redeemed_on": "PR #169" },
    { "id": "granny-ashs-share", "by": "granny-ash", "what": "…", "redeemed": true, "redeemed_on": "PR #170" },
    { "id": "tams-match", "by": "tam-the-lamplighter", "what": "a match struck on the new stone", "redeemed": true, "redeemed_on": "PR #171" }
  ],
  "accounting": [
    { "on": "PR #144", "note": "filed under owed, not granted — the well's first debt", "chronicle_ref": "PR #144" },
    { "on": "PR #148", "note": "a fair floated to raise the stone faster than a season of waiting", "chronicle_ref": "PR #148" },
    { "on": "PR #150", "note": "the god ruled a promise weighs the same as a wish", "chronicle_ref": "PR #150" },
    { "on": "PR #155", "note": "ground broke on the bridge; the first stone counted out loud", "chronicle_ref": "PR #155" },
    { "on": "PR #171", "note": "Tam's match struck — the debt closed at compound interest", "chronicle_ref": "PR #171" }
  ]
}
```

Exact `text`/`what` wording, `keeper`, and NPC slugs are the Council's to author (they must match the real NPC ids in `worlds/fableton/npcs/`); the mapping above fixes the *structure*, not the words. The insincere gold-egg coins, if ever recorded individually, become `sincerity: "insincere", status: "returned"` entries. Once the file exists, `pnpm validate` checks it with no further engine change.

## Consequences

- A new optional world-data document; worlds without a well are unaffected.
- The well's book becomes inspectable and gate-checked instead of living only in prose.
- No runtime interpreter is added here (the schema is a container, per the petition's scope). If the sim ever needs to *react* to the ledger (e.g. an NPC behavior that reads standing debts), that is a separate engine issue with its own runtime + tests, matching how `gossipRuntime.ts` interprets rumors.

## Verification

`engine/` typecheck + full suite, plus the repo gate:

```
tsc --noEmit                       # typecheck OK
Test Files  28 passed (28)
     Tests  261 passed (261)       # +16 new: 12 schema, 4 gate (sample-world fixture round-trips)
pnpm validate                      # all worlds pass; sample-world exercises wish-ledger.json
```
