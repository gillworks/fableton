// SPDX-License-Identifier: Apache-2.0
//
// The gate as a command: `pnpm validate` (docs/v1.md DoD test 3).
// Usage: tsx src/validate/cli.ts --charter <charter.yaml> --world <dir>
// The world dir holds manifest.json, assets.json, chunk files at the
// manifest's paths, and npcs/*.json.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { validateWorld, type Violation, type WorldDocs } from './validateWorld.js';

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    world: { type: 'string' },
    // Promote advisory warnings (e.g. region-tethering) to hard failures.
    strict: { type: 'boolean', default: false },
  },
});
if (!values.charter || !values.world) {
  console.error('usage: cli.ts --charter <charter.yaml> --world <world-dir> [--strict]');
  process.exit(2);
}
const charterPath = values.charter;
const worldDir = values.world;

const violations: Violation[] = [];
const readJson = (file: string): { file: string; doc: unknown } => ({
  file,
  doc: JSON.parse(readFileSync(file, 'utf8')),
});

let charter;
try {
  charter = parseCharter(readFileSync(charterPath, 'utf8'));
} catch (error) {
  violations.push({
    file: charterPath,
    rule: 'schema-valid',
    message: error instanceof Error ? error.message : String(error),
  });
}

if (charter) {
  const manifest = readJson(join(worldDir, 'manifest.json'));
  const chunkPaths =
    (manifest.doc as { chunks?: { path?: unknown }[] }).chunks
      ?.map((c) => c.path)
      .filter((p): p is string => typeof p === 'string') ?? [];
  const readDirJson = (dir: string): { file: string; doc: unknown }[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => readJson(join(dir, f)))
      : [];
  const rumorsPath = join(worldDir, 'rumors.json');
  const expansionPath = join(worldDir, 'expansion-plan.json');
  const world: WorldDocs = {
    manifest,
    registry: readJson(join(worldDir, 'assets.json')),
    chunks: chunkPaths.map((p) => readJson(join(worldDir, p))),
    npcs: readDirJson(join(worldDir, 'npcs')),
    // Construction sites are optional world-data (issue #91); worlds without
    // a `construction/` dir simply carry none.
    constructionSites: readDirJson(join(worldDir, 'construction')),
    // Optional (issue #81): validate rumors when the world seeds any.
    ...(existsSync(rumorsPath) && { rumors: readJson(rumorsPath) }),
    // Optional (issue #95): validate the expansion plan's pre-placed sites.
    ...(existsSync(expansionPath) && { expansionPlan: readJson(expansionPath) }),
  };
  violations.push(...validateWorld(charter, world));

  if (violations.length === 0) {
    const sites = world.constructionSites?.length ?? 0;
    // Reached only when the plan validated cleanly, so its queue is well-formed.
    const planned = (world.expansionPlan?.doc as { queue?: unknown[] } | undefined)?.queue?.length ?? 0;
    console.log(
      `✓ world valid — ${world.chunks.length} chunks, ${world.npcs.length} NPCs${sites > 0 ? `, ${sites} construction site(s)` : ''}${planned > 0 ? `, ${planned} planned site(s)` : ''}, charter "${charter.identity.name}"`,
    );
  }
}

// Warnings are advisory unless --strict promotes them; errors always fail.
const isError = (v: Violation): boolean => (v.severity ?? 'error') === 'error';
const fatal = violations.filter((v) => isError(v) || values.strict);
const advisory = violations.filter((v) => !isError(v) && !values.strict);

for (const v of fatal) {
  console.error(`✗ [${v.rule}] ${v.file}\n  ${v.message.split('\n').join('\n  ')}`);
}
for (const v of advisory) {
  console.error(`⚠ [${v.rule}] ${v.file}\n  ${v.message.split('\n').join('\n  ')}`);
}
if (advisory.length > 0) {
  console.error(`\n${advisory.length} warning(s) — advisory; re-run with --strict to enforce.`);
}
if (fatal.length > 0) {
  console.error(`\n${fatal.length} violation(s) — the gate holds.`);
  process.exit(1);
}
