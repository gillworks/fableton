// SPDX-License-Identifier: Apache-2.0
//
// Grow a founded world by one region (issue #120):
//   tsx src/generate/growCli.ts --charter <charter.yaml> --world <dir> --cell <gx>,<gz>
// With no --cell it lists the frontier (empty cells touching the map).
// Atomic: generate + patch in memory, run the FULL world gate, and only
// write when the grown world passes — a bad tile never reaches disk. The
// raw tile ships with no residents; dressing it is the steward's lane.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { ChunkSchema, type Chunk } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { validateWorld, type WorldDocs } from '../validate/validateWorld.js';
import { growRegion } from './generateWorld.js';

const CHUNK_SIZE = 16;

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    world: { type: 'string' },
    cell: { type: 'string' },
  },
});
if (!values.charter || !values.world) {
  console.error('usage: growCli.ts --charter <charter.yaml> --world <dir> [--cell <gx>,<gz>]');
  process.exit(2);
}

const worldDir = values.world;
const charter = parseCharter(readFileSync(values.charter, 'utf8'));
const registry = AssetRegistrySchema.parse(
  JSON.parse(readFileSync(join(worldDir, 'assets.json'), 'utf8')),
);
const manifest = WorldManifestSchema.parse(
  JSON.parse(readFileSync(join(worldDir, 'manifest.json'), 'utf8')),
);
const chunks: Chunk[] = manifest.chunks.map((entry) =>
  ChunkSchema.parse(JSON.parse(readFileSync(join(worldDir, entry.path), 'utf8'))),
);

if (!values.cell) {
  // The frontier: every empty cell orthogonally touching the map.
  const occupied = new Set(manifest.chunks.map((c) => `${c.origin[0] / CHUNK_SIZE},${c.origin[1] / CHUNK_SIZE}`));
  const frontier = new Set<string>();
  for (const c of manifest.chunks) {
    const [gx, gz] = [c.origin[0] / CHUNK_SIZE, c.origin[1] / CHUNK_SIZE];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${gx + dx},${gz + dz}`;
      if (!occupied.has(key)) frontier.add(key);
    }
  }
  console.log(`"${charter.identity.name}" — ${manifest.chunks.length}/${charter.generation.caps.max_regions} regions; the frontier:`);
  for (const key of [...frontier].sort()) console.log(`  --cell ${key}`);
  process.exit(0);
}

const match = /^(-?\d+),(-?\d+)$/.exec(values.cell.trim());
if (!match) {
  console.error(`--cell wants "<gx>,<gz>", got "${values.cell}"`);
  process.exit(2);
}
const cell = { gx: Number(match[1]), gz: Number(match[2]) };

const grown = growRegion(charter, registry, { manifest, chunks }, cell);

// The gate, before anything touches disk: the grown world as it would be.
const patchedIds = new Set(grown.patchedNeighbours.map((c) => c.id));
const finalChunks = [
  ...chunks.map((c) => grown.patchedNeighbours.find((p) => p.id === c.id) ?? c),
  grown.chunk,
];
const wrap = (file: string, doc: unknown): { file: string; doc: unknown } => ({ file, doc });
const readDirJson = (dir: string): { file: string; doc: unknown }[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => wrap(join(dir, f), JSON.parse(readFileSync(join(dir, f), 'utf8'))))
    : [];
const rumorsPath = join(worldDir, 'rumors.json');
const expansionPath = join(worldDir, 'expansion-plan.json');
const world: WorldDocs = {
  manifest: wrap('manifest.json', grown.manifest),
  registry: wrap('assets.json', registry),
  chunks: finalChunks.map((c) => wrap(`chunks/${c.id}.json`, c)),
  npcs: readDirJson(join(worldDir, 'npcs')),
  constructionSites: readDirJson(join(worldDir, 'construction')),
  ...(existsSync(rumorsPath) && { rumors: wrap('rumors.json', JSON.parse(readFileSync(rumorsPath, 'utf8'))) }),
  ...(existsSync(expansionPath) && { expansionPlan: wrap('expansion-plan.json', JSON.parse(readFileSync(expansionPath, 'utf8'))) }),
};
const violations = validateWorld(charter, world);
if (violations.length > 0) {
  for (const v of violations) console.error(`✗ [${v.rule}] ${v.file}: ${v.message}`);
  console.error('the grown world fails the gate — nothing written');
  process.exit(1);
}

const write = (rel: string, doc: unknown): void =>
  writeFileSync(join(worldDir, rel), JSON.stringify(doc, null, 2) + '\n');
write('manifest.json', grown.manifest);
write(join('chunks', `${grown.chunk.id}.json`), grown.chunk);
for (const neighbour of grown.patchedNeighbours) write(join('chunks', `${neighbour.id}.json`), neighbour);

console.log(
  `✓ "${charter.identity.name}" grew — ${grown.chunk.id} joins the map ` +
    `(${grown.manifest.chunks.length}/${charter.generation.caps.max_regions} regions; ` +
    `gates wired into ${[...patchedIds].sort().join(', ')})`,
);
console.log('the raw tile has no residents — dress it and PR it (steward lane)');
