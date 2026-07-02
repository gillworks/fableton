# ADR-0002: Client rendering stack — Three.js, R3F first, vanilla-core escape hatch

**Status:** Accepted
**Date:** 2026-07-02

## Context

The world renders in the browser: an ever-growing chunked open world that must stream, cull, and stay inside a per-chunk perf budget on mid-tier hardware — while also serving as the spectator surface (explore camera, click-to-inspect) and, headless, as the stream's director cam and the QA bots' eyes. Dev velocity matters (an agent team iterating fast); so does eventual streaming-and-culling control (the "ever-expanding" ceiling is real — growth lives in the catalog, not in RAM).

## Decision

1. **Three.js** is the rendering engine. WebGL/WebGPU via a mature, widely-known library the agent team has deep training coverage on; no game-engine runtime (Unity/Godot web export) — the client must stay a lightweight, embeddable, open web artifact.
2. **React Three Fiber (R3F) to start** — for dev velocity on UI-adjacent work (panels, overlays, camera modes) and declarative scene scaffolding during v1.
3. **Vanilla-core escape hatch, prepared from day one:** rendering-critical logic (chunk loader, instancing, culling, interpolation) lives in plain TypeScript modules that R3F components *call*, never inside React components. If/when perf demands, the core drops to vanilla Three.js with a custom chunk loader without rewriting the world logic.

## Trigger conditions for dropping to vanilla

Any of: frame budget misses at the charter's chunk caps on mid-tier hardware · React reconciliation showing up in profiles on scene-graph churn (chunk load/unload) · the streaming/LOD system fighting R3F's lifecycle.

## Consequences

- Rendering logic stays out of React components (enforced in review; see CLAUDE.md).
- GPU instancing for props, frustum culling, and per-chunk draw-call budgets are requirements, not optimizations — the CI perf gate enforces the charter's `generation.caps`.
- The client is one codebase with camera modes (explore / walk / director), consumed identically by viewers, QA bots (headless Chromium), and the streamer.
