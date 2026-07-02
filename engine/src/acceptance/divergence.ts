// SPDX-License-Identifier: Apache-2.0
//
// DoD test 2 (docs/v1.md), executable: same engine + different charter ⇒
// a visibly, structurally different world. Usage:
//   tsx src/acceptance/divergence.ts <charterA.yaml> <charterB.yaml>
// Exits 0 when both charters generate valid worlds that differ
// structurally; exits 1 with the reason otherwise.
import { readFileSync } from 'node:fs';
import { parseCharter } from '../charter/parse.js';
import { generateWorld, type GeneratedWorld } from '../generate/generateWorld.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { validateWorld } from '../validate/validateWorld.js';

const [pathA, pathB] = process.argv.slice(2);
if (!pathA || !pathB) {
  console.error('usage: divergence.ts <charterA.yaml> <charterB.yaml>');
  process.exit(2);
}

const registry = AssetRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../assets/registry.json', import.meta.url), 'utf8')),
);

const build = (path: string): { name: string; world: GeneratedWorld } => {
  const charter = parseCharter(readFileSync(path, 'utf8'));
  const world = generateWorld(charter, registry);
  const violations = validateWorld(charter, {
    manifest: { file: 'manifest.json', doc: JSON.parse(JSON.stringify(world.manifest)) },
    registry: { file: 'assets.json', doc: JSON.parse(JSON.stringify(registry)) },
    chunks: world.chunks.map((c) => ({
      file: `chunks/${c.id}.json`,
      doc: JSON.parse(JSON.stringify(c)),
    })),
    npcs: [],
  });
  if (violations.length > 0) {
    console.error(`✗ ${path} generates an invalid world:`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
    process.exit(1);
  }
  return { name: charter.identity.name, world };
};

const a = build(pathA);
const b = build(pathB);

// Structure = the layout graph; dressing = biomes and palette.
const layout = ({ world }: typeof a): string =>
  JSON.stringify(world.manifest.chunks.map((c) => [c.id, c.origin, c.adjacent]));
const dressing = ({ world }: typeof a): string =>
  JSON.stringify(world.chunks.map((c) => [c.terrain.biome, c.palette]));

const differences: string[] = [];
if (layout(a) !== layout(b)) differences.push('layout graph (chunk ids, origins, adjacency)');
if (dressing(a) !== dressing(b)) differences.push('dressing (biomes, palettes)');

if (differences.length === 0) {
  console.error(
    `✗ "${a.name}" and "${b.name}" generated structurally identical worlds — divergence bar not met`,
  );
  process.exit(1);
}
console.log(
  `✓ divergence holds: "${a.name}" (${a.world.chunks.length} chunks) vs "${b.name}" (${b.world.chunks.length} chunks) differ in ${differences.join(' and ')}`,
);
