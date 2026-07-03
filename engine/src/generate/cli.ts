// SPDX-License-Identifier: Apache-2.0
//
// Found a world on disk: charter in, world dir out (manifest, chunks,
// the asset registry, an empty npcs/ — skeleton worlds get their
// residents from agents, later).
// Usage: tsx src/generate/cli.ts --charter <charter.yaml> --out <dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { generateWorld } from './generateWorld.js';

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    out: { type: 'string' },
    // ISO UTC founding timestamp stamped into the manifest — the caller
    // (entrypoint, rebuild script) owns the wall-clock read, so generation
    // itself stays deterministic.
    'founded-at': { type: 'string' },
  },
});
if (!values.charter || !values.out) {
  console.error('usage: cli.ts --charter <charter.yaml> --out <dir> [--founded-at <iso-utc>]');
  process.exit(2);
}

const outDir = values.out;
const charter = parseCharter(readFileSync(values.charter, 'utf8'));
const registry = AssetRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../assets/registry.json', import.meta.url), 'utf8')),
);
const foundedAt = values['founded-at'];
const { manifest, chunks } = generateWorld(charter, registry, foundedAt ? { foundedAt } : {});

mkdirSync(join(outDir, 'chunks'), { recursive: true });
mkdirSync(join(outDir, 'npcs'), { recursive: true });
const write = (rel: string, doc: unknown): void =>
  writeFileSync(join(outDir, rel), JSON.stringify(doc, null, 2) + '\n');
write('manifest.json', manifest);
write('assets.json', registry);
for (const chunk of chunks) write(join('chunks', `${chunk.id}.json`), chunk);

console.log(
  `✓ "${manifest.world}" founded — ${chunks.length} chunks (seed ${manifest.seed}) → ${outDir}`,
);
