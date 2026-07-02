# Fableton — Engineering Conventions

Read [docs/v1.md](docs/v1.md) (scope + definition of done) and [docs/architecture.md](docs/architecture.md) before starting any task. If a task conflicts with those docs, stop and raise it on the issue — don't improvise around the spec.

## Invariants (violating these fails review)

1. **World is DATA, not code.** Agents and generators emit schema-validated JSON; the engine interprets it. Never special-case world content in engine code. New mechanics = new data type + schema + interpreter, via an approved issue.
2. **Schema-first.** Zod schemas in `engine/` are the single source of truth; JSON is the wire/storage format. No untyped payloads. Every schema ships with fixture round-trip tests and a `schema_version`.
3. **Determinism in the generation path.** `charter + seed → identical skeleton world, every run, every machine.` No `Date.now()`, `Math.random()`, unordered map iteration, or float-order dependence anywhere in `engine/` generation or sim-tick code. Randomness comes from the seeded PRNG, passed explicitly.
4. **Legibility all the way down.** Every behavior-tree node carries a diegetic, human-readable `label` ("kneading dough", not `node_47`). Anything notable writes to the decision log. If a viewer can't see it and understand it, it doesn't count.
5. **Engine/world separation.** Nothing named "Fableton-the-world" (or any world) hardcoded in `engine/` or `client/`. Worlds are instances; the flagship is just the first charter.

## Stack

- TypeScript **strict** everywhere · Node ≥ 20 · **pnpm** workspaces · **vitest** · **Zod**
- Client: Three.js via React Three Fiber to start (be prepared to drop to a vanilla core when perf demands — keep rendering logic out of React components where practical)
- No new runtime dependencies without an approved issue. No framework sprawl.

## Workflow

- Work flows **issue → branch → PR → green CI → merge**. No direct pushes to `main` after scaffold.
- Branch names: `<issue-number>-short-slug`. Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`).
- **SPDX header on every source file:** `// SPDX-License-Identifier: Apache-2.0` (YAML/shell: `#` form).
- PRs are small and single-purpose. The PR description states what changed and how it was verified — paste test output, don't assert.
- **Review routing:** schema or architecture changes require the executive producer's review. Mechanical/scaffold changes auto-merge on green CI.
- CI (`pnpm typecheck && pnpm test && pnpm validate`) must pass. The validation gate is the standard — if the gate is wrong, fix the gate via an issue, don't route around it.

## Testing

- Every schema: valid + invalid fixture tests, round-trip (parse → serialize → parse).
- Generation: golden-seed snapshot tests (same charter+seed ⇒ byte-identical manifest).
- The three acceptance tests in [docs/v1.md](docs/v1.md) are the v1 bar; keep them runnable.

## Don'ts

- Don't add features, abstractions, or error handling beyond what the issue requires. Do the simplest thing that works well.
- Don't design for hypothetical future requirements; don't leave half-finished implementations either.
- Don't put secrets anywhere in the repo — bring-your-own-keys via env (`.env` is gitignored).
- Don't touch `LICENSE`, `NOTICE`, or license headers except via an approved issue.
