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
  },
});
if (!values.charter || !values.world) {
  console.error('usage: cli.ts --charter <charter.yaml> --world <world-dir>');
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
  const npcsDir = join(worldDir, 'npcs');
  const rumorsPath = join(worldDir, 'rumors.json');
  const world: WorldDocs = {
    manifest,
    registry: readJson(join(worldDir, 'assets.json')),
    chunks: chunkPaths.map((p) => readJson(join(worldDir, p))),
    npcs: existsSync(npcsDir)
      ? readdirSync(npcsDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => readJson(join(npcsDir, f)))
      : [],
    // Optional (issue #81): validate rumors when the world seeds any.
    ...(existsSync(rumorsPath) && { rumors: readJson(rumorsPath) }),
  };
  violations.push(...validateWorld(charter, world));

  if (violations.length === 0) {
    console.log(
      `✓ world valid — ${world.chunks.length} chunks, ${world.npcs.length} NPCs, charter "${charter.identity.name}"`,
    );
  }
}

for (const v of violations) {
  console.error(`✗ [${v.rule}] ${v.file}\n  ${v.message.split('\n').join('\n  ')}`);
}
if (violations.length > 0) {
  console.error(`\n${violations.length} violation(s) — the gate holds.`);
  process.exit(1);
}
