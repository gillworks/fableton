# Charters

A charter is the founding constitution of a world: same engine + different charter → a completely different world. Fork [`_template/`](_template/) to found your own.

- [`_template/`](_template/) — the annotated template: every field a founder must detail, with example values.
- [`fableton/`](fableton/) — the flagship: *the town where fables retired* (warm storybook, Alegreya, phases: first light / high sun / lamplighting / hush). Boots the hand-authored starter world in the compose stack; a scripted Founding Session may re-found it under the same identity.
- [`cindervault/`](cindervault/) — divergence one: *the city that banked the last fire* (forge-dark, Zilla Slab, phases: ashdawn / forge-day / smelt-dusk / banked). city scale, 12 regions. Starter residents: a heat-broker, the Vault's clerk, an ash-sweep of the Cold Quarter.
- [`skeinsea/`](skeinsea/) — divergence two: *the archipelago where the fog remembers* (mist-pale, Jost, phases: morning tide / high glass / gloaming / bell-dark). hamlet scale, 3 islets. Starter residents: a bell-keeper, a net-mender, a tide-reader.
- Visual identities: [docs/design.md](../docs/design.md). Swap via `FABLETON_CHARTER=charters/<name>/charter.yaml docker compose up` — same engine, radically different world.

Schema: [ADR-0001](../docs/adr/0001-charter-schema.md). Charters validate against `@fableton/engine`'s `CharterSchema`.
