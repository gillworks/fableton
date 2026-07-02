# ADR-0003: Design language — charter-themed dioramas, theme-as-charter-data

**Status:** Accepted
**Date:** 2026-07-02

## Context

Design concepts (Claude Design, "Fableton Worlds.dc.html" — see [docs/design.md](../design.md)) were approved 2026-07-02 showing three worlds sharing one visual grammar with radically different skins: Fableton (warm storybook, Alegreya), Cindervault (forge-dark, Zilla Slab), Skeinsea (mist-pale, Jost). Each world has its own palette, typeface pair, accent, and even day-phase *names*.

## Decision

1. **The presentation layer follows the engine/world split.** Layout grammar (diorama framing, HUD anatomy, inspect-panel anatomy, four-phase mechanics, construction markers) is engine-fixed. Palette, typography, accent, day-phase names, premise, and chronicle voice are **charter data** — the charter's `aesthetic` section carries theme tokens (`theme`, `typography`, `palette`, `accent`, `day_phases[4]`).
2. **The diorama is the frame.** Worlds render as low-poly vignettes on an elliptical ground coin over a charter-gradient page; the explore camera operates within it at village scale.
3. **The inspect panel is always parchment-cream**, in every world — a fixed reading surface independent of world darkness.
4. **Exactly four day phases**, charter-named; phase changes relight, never relayout.
5. **The divergence-demo worlds are the designed identities**: Cindervault and Skeinsea (superseding the earlier salvage/archipelago placeholders), alongside flagship Fableton.

## Consequences

- Charter schema (ADR-0001 / issue #1) gains the theme-token fields; the template is updated.
- The client consumes theme tokens from the parsed charter only — hardcoding a world's values in `client/` fails review (engine/world separation, CLAUDE.md invariant 5).
- NPC data contract confirmed by the concepts: lore at `lore/<id>.json`, trees namespaced `<archetype>.<state>`, relationships as name+clause pairs, chronicle entries with optional PR refs (issue #2).
- Divergence acceptance (DoD test 2) now has a concrete visual bar: swapping charters must change palette, type, phase names, and mood — not just geometry.
