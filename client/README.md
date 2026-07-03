# @fableton/client

Three.js browser client (React Three Fiber to start). One codebase, three camera modes: **explore** (drag/zoom/orbit — the public default), **walk** (later), **director** (cinematic auto-cam used headless by the streamer).

Consumes: chunk JSON (static geometry) + the `world-sim` WebSocket (dynamic state, interpolated client-side). See [docs/architecture.md § The explore surface](../docs/architecture.md) and [docs/design.md](../docs/design.md) for the diorama grammar.

## Architecture (ADR-0002)

Rendering-critical logic lives in plain TS under [`src/core/`](src/core/) — chunk streaming + frustum culling (`streamer.ts`), terrain/instancing (`chunkMeshes.ts`), delta interpolation (`interpolator.ts`), charter theme → lighting (`theme.ts`). The R3F components in [`src/scene/`](src/scene/) only *call* the core, so dropping to vanilla three stays a component rewrite, not a logic rewrite. Props render as GPU instances: one `InstancedMesh` per kit-asset sub-mesh per chunk.

The UI theme is charter data: palette/accent/typography arrive from `/api/world` and map through the engine's canonical name→color hash (`@fableton/engine/color`). Phase changes relight (sun, gradient, fog) — never relayout.

The **HUD chrome** (docs/design.md) is engine anatomy skinned by charter tokens: name/premise/chips top-left, the DAY·PHASE pill + four-segment phase selector top-right (segments preview a relight; the sim clock stays authoritative), the CHRONICLE bar below (polls `/api/chronicle`), and construction markers wherever `/api/world.construction` reports a site (`?construction=<chunk>:<pr>` demos one). Pale skies get ink, dark skies get paper. A charter omitting theme tokens renders neutral engine defaults — never another world's values.

Click an NPC to open the **inspect panel** (docs/design.md anatomy): lore from `/api/npcs/:id`, the activity pill fed live by the sim stream. Parchment-cream in every world — the panel is the reader's lamplight.

## Dev

```sh
pnpm --dir ../engine serve   # sim ws://:8090 + api http://:8091 on the sample world
pnpm dev                     # vite on :8080 — proxies /api + /sim, serves /world + /assets
```

In production caddy plays vite's role: serves the bundle, `/world/*` chunk JSON, `/assets/*` kit files, and proxies `/api` + `/sim`. The client only ever uses those relative paths.
