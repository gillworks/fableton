# Asset kit

## Selection: Kenney Fantasy Town Kit 2.0

**Kit:** [Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit) by Kenney (kenney.nl), version 2.0.
**License:** Creative Commons Zero (CC0-1.0) — public domain dedication.
**Why this kit:**

- **License-compatible with Apache-2.0 distribution.** CC0 places the models in the public domain: they can be vendored in this repo, redistributed with world instances, and served from any CDN with no attribution requirement and no license conflict. (We credit Kenney anyway — it's deserved, not required.)
- **Right register.** Chunky low-poly storybook silhouettes — matches the design language (docs/design.md) and the template charter's "buildings drawn by someone describing them from memory."
- **Right shape for v1.** 167 GLB models with a strong set of *standalone* ambient props (trees, rocks, carts, stalls, fountains, mills) — what the skeleton generator places. The kit's modular wall/roof pieces are there when building assembly lands in a later phase.
- **One kit** (v1.md): one consistent visual grammar, one provenance trail.

## What's vendored

A curated 20-prop subset lives at [`assets/kits/kenney-fantasy-town/`](../assets/kits/kenney-fantasy-town/) (~640 KB) together with the kit's original `License.txt`. Vendoring (rather than a build-time fetch) keeps the compose stack's zero-external-dependency promise: a fresh clone builds an explorable world with no network access and no dependence on a third-party URL staying alive.

## The registry

[`assets/registry.json`](../assets/registry.json) is the canonical asset registry, validated against `AssetRegistrySchema`. Every entry records:

- `id` / `name` / `path` — path resolves to a real vendored file (`pnpm validate` checks this).
- `poly_count` — **measured** from the GLB (scene-graph traversal, indexed triangles per mesh instance), not estimated. The gate sums these against `generation.caps.chunk_poly_budget`.
- `tags` — matched against `enforced: gate` charter rules by the CI gate.
- `license` — SPDX id, source URL + vendored date, attribution. Provenance on the entry itself, per v1.md.

## Adding assets

1. Drop the GLB under `assets/kits/<kit>/` with the kit's license text alongside.
2. Add a registry entry with measured `poly_count` and full license provenance.
3. `pnpm validate` must stay green — it checks the registry parses, every path resolves, and generator output built from this registry passes the world gate.
