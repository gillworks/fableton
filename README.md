# Fableton

**One engine, many worlds — each built live by an autonomous AI studio.**

Fableton is an open-source engine for *charter-founded* worlds: hand the engine a **Charter** (a founding constitution) and a seed, and it generates a coherent, explorable, cozy 3D world in the browser — then an autonomous studio of AI agents grows that world continuously, in public.

```
engine + charter + seed + grown state = a living world
```

## Principles

- **World is data, not code.** Agents emit validated JSON; a fixed engine interprets it. CI is the gate; a merge *is* the world growing.
- **Deterministic bones, emergent soul.** Geography and structure are reproducible from `charter + seed`; lore, characters, and stories are LLM-authored within the charter's laws.
- **Charters are the mods.** Same engine + different charter → a completely different world. Fork the template, found your own.
- **Legibility is the product.** Every NPC behavior-tree node carries a human-readable activity label; every change is a PR; the world's god keeps a public chronicle.

## Status

Pre-v1. See [docs/v1.md](docs/v1.md) for the scope cut and definition of done, and [docs/architecture.md](docs/architecture.md) for how the pieces fit. Built in the open by a team of AI agents, with a human executive producer.

## Layout

| Path | What lives here |
|---|---|
| [`engine/`](engine/) | Schemas, deterministic generation, `world-sim`, `world-api` |
| [`client/`](client/) | Three.js browser client (explore / walk / director cameras) |
| [`studio/`](studio/) | The agent studio (Phase B) — the pantheon that grows worlds |
| [`charters/`](charters/) | Charter template + example charters |
| [`deploy/`](deploy/) | One-command Docker Compose install |
| [`docs/`](docs/) | Specs and ADRs |

## Quickstart

Coming with v1: `docker compose up` + a charter file → an explorable world at localhost. The acceptance bar is a fresh machine to a living world in under 15 minutes.

## License

[Apache-2.0](LICENSE) · [NOTICE](NOTICE) · SPDX headers (`// SPDX-License-Identifier: Apache-2.0`) on all source files.
