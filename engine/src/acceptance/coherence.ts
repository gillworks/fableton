// SPDX-License-Identifier: Apache-2.0
//
// The Law of Ties as a hard bar (Decree 1), executable: every populated
// region in a committed world must be tethered — a resident tied to a
// living neighbour here or in another region. Usage:
//   tsx src/acceptance/coherence.ts <charter.yaml> <world-dir>
// Exits 0 when no region is orphaned; exits 1 naming each orphaned region.
// The per-world gate (`pnpm validate`) reports the same finding as an
// advisory warning; the acceptance harness runs this to make it enforced.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCharter } from '../charter/parse.js';
import { findOrphanedRegions, type WorldDocs } from '../validate/validateWorld.js';

const [charterPath, worldDir] = process.argv.slice(2);
if (!charterPath || !worldDir) {
  console.error('usage: coherence.ts <charter.yaml> <world-dir>');
  process.exit(2);
}

// The charter is parsed to fail fast on a broken world, and to name it.
const charter = parseCharter(readFileSync(charterPath, 'utf8'));

const readJson = (file: string): { file: string; doc: unknown } => ({
  file,
  doc: JSON.parse(readFileSync(file, 'utf8')),
});
const manifest = readJson(join(worldDir, 'manifest.json'));
const chunkPaths =
  (manifest.doc as { chunks?: { path?: unknown }[] }).chunks
    ?.map((c) => c.path)
    .filter((p): p is string => typeof p === 'string') ?? [];
const npcsDir = join(worldDir, 'npcs');
// Tethering reads only chunks and NPCs; the optional site/rumor docs the
// full gate loads are irrelevant here, so this WorldDocs omits them.
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
};

const orphaned = findOrphanedRegions(world);
if (orphaned.length === 0) {
  const populated = world.chunks.filter(
    (c) => ((c.doc as { npcs?: unknown[] }).npcs?.length ?? 0) > 0,
  ).length;
  console.log(
    `✓ Law of Ties holds in "${charter.identity.name}": all ${populated} populated region(s) tethered`,
  );
  process.exit(0);
}
console.error(`✗ "${charter.identity.name}" has ${orphaned.length} orphaned region(s):`);
for (const r of orphaned) {
  console.error(`  [${r.chunkId}] resident(s) ${r.residents.map((x) => `"${x}"`).join(', ')}`);
}
console.error('  Each needs a local tie or a hook to the town arc (Decree 1, the Law of Ties).');
process.exit(1);
