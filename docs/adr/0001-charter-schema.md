# ADR-0001: Charter schema

**Status:** Accepted (implemented in `@fableton/engine`; open questions resolved below)
**Date:** 2026-07-02

## Context

The Charter is the founding constitution of a world: part seed, part law, part generation-steering config. It is the single richest creative lever and the anti-slop anchor — every agent obeys it as top-of-context law, and the deterministic generator reads it as config. Everything else in the engine reads from this schema, so it lands first.

## Decision drivers

1. **Two-layer randomness, charter-bounded.** The charter dictates what kind of randomness the world permits: a seeded PRNG reproduces the structural skeleton; LLM-authored content is charter-*constrained* but not bit-reproducible.
2. **Charters are shareable, forkable content** — like map seeds/mods. Authoring format must be human-writable and diff-friendly.
3. **Versioned + migratable.** Worlds outlive engine versions; `schema_version` + migration functions are first-class from day one.
4. **Validating.** Zod is the source of truth; a charter that parses is a charter the engine can found a world on.

## Proposed shape

Top-level sections (see [`charters/_template/charter.yaml`](../../charters/_template/charter.yaml) for the annotated template):

| Section | Contents | Consumed by |
|---|---|---|
| `identity` | name, one-line premise, seed | everything |
| `tone` | emotional register, pillars | agents (prompt context) |
| `laws` | what's true here (magic, seasons, mortality, time, economy) | agents + sim |
| `aesthetic` | palette, architecture language, silhouette rules, hard never-list | agents + asset validation |
| `inhabitants` | kinds of beings, factions, naming conventions | agents + NPC generation |
| `generation` | biome mix, density, scale caps, region cadence, growth rate | deterministic generator |
| `taboos` | hard guardrails keeping the world coherent and on-brand | agents + CI gate |
| `prime_directives` | what the studio optimizes for in this world | agents |
| `amendments` | rules for constitutional change | studio governance |

**Engine-canon (not per-charter):** every world has a god named Fable that speaks through the Chronicle; those mechanics live in the engine, not the charter.

**Divine artifacts** are sibling document types sharing the versioning scheme, not charter fields: the charter is immutable (amendable only via constitutional act); `master-plan` (rolling), `decrees` (append-only), and `world-bible` amendments are mutable world-state.

**Behavior trees are world-data, not charter data** — they live in the NPC schema (every node carries a human-readable `label`), governed by the charter's laws.

## Deliverable

`@fableton/engine` exports `CharterSchema`, `parseCharter()` (YAML in, typed object out), `migrateCharter()`, plus the divine-artifact schemas. Fixture tests: valid/invalid charters, round-trip, migration from `schema_version: 0`.

## Resolutions (sprint-1 PR)

1. **Authoring format: YAML-first.** Charters are authored as YAML (comments matter for a template people fork); `parseCharter()` parses via the `yaml` package and the canonical wire/storage form is the parsed JSON. No JSON5.
2. **Enforceability is marked per rule.** Every `aesthetic.never` and `taboos` entry is `{ rule, enforced: gate | prompt }`. `gate` = machine-checked by the CI validation gate (matched against asset-registry tags — wired up in the CI-gate issue); `prompt` = carried as law in every agent's context and caught by the taste audit. Migration from v0 defaults every entry to `prompt`; gate enforcement is opt-in per rule.
3. **Seed: single integer root seed** (uint32, so every PRNG implementation agrees on range) — shareable like a map seed. Generation subsystems (terrain, layout, props) derive named sub-seeds from it deterministically; sub-seeds are never authored.

`schema_version: 1` is the first schema-governed version; `migrateCharter()` migrates v0 (the pre-v1 draft template) forward. Charter immutability is governance (constitutional acts), not schema — the schema validates shape, the workflow enforces law.
