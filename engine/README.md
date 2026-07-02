# @fableton/engine

Schemas (charter, world-data, divine artifacts), deterministic generation, the authoritative `world-sim` (behavior-tree runtime, clock, WebSocket broadcast), and `world-api`.

Start here: [ADR-0001 Charter schema](../docs/adr/0001-charter-schema.md). Determinism and schema-first rules in [CLAUDE.md](../CLAUDE.md) apply most strictly in this package.

## world-sim

Run the sample world headless: `pnpm sim` → WebSocket on `:8090`. Clients get a full `snapshot` on connect, then `delta` messages at 2 Hz (engine tick rate; within the 1–5 Hz broadcast band). The sim core is pure — state is a function of world data + tick count; wall time only schedules ticks.

**Per-tick byte budget** (held by tests in `src/sim/worldSim.test.ts`): a serialized delta is ≤ **64 bytes envelope + 120 bytes per changed NPC**. Deltas are sparse — only NPCs that changed this tick appear, with only their changed fields — so a world where everyone is holding still broadcasts ~30 bytes. Sample world (3 NPCs): ≤ 424 bytes/tick worst case.
