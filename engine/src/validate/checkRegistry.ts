// SPDX-License-Identifier: Apache-2.0
//
// Registry half of `pnpm validate` (issue #5): the canonical asset
// registry parses, every asset path resolves to a real file, and the
// generator's output built from this registry passes the world gate —
// so every prop id the generator can emit resolves in the registry.
// Usage: tsx src/validate/checkRegistry.ts --charter <charter.yaml> --registry <registry.json>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { generateWorld } from '../generate/generateWorld.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { validateWorld, type Violation } from './validateWorld.js';

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    registry: { type: 'string' },
  },
});
if (!values.charter || !values.registry) {
  console.error('usage: checkRegistry.ts --charter <charter.yaml> --registry <registry.json>');
  process.exit(2);
}
const registryPath = values.registry;
// Registry paths are repo-root-relative; the registry sits in <root>/assets/.
const repoRoot = join(dirname(registryPath), '..');

const violations: Violation[] = [];
const registryResult = AssetRegistrySchema.safeParse(
  JSON.parse(readFileSync(registryPath, 'utf8')),
);
if (!registryResult.success) {
  violations.push({
    file: registryPath,
    rule: 'schema-valid',
    message: registryResult.error.message,
  });
} else {
  for (const asset of registryResult.data.assets) {
    if (!existsSync(join(repoRoot, asset.path))) {
      violations.push({
        file: registryPath,
        rule: 'asset-refs-resolve',
        message: `asset "${asset.id}" points at "${asset.path}", which does not exist`,
      });
    }
  }

  const charter = parseCharter(readFileSync(values.charter, 'utf8'));
  const { manifest, chunks } = generateWorld(charter, registryResult.data);
  violations.push(
    ...validateWorld(charter, {
      manifest: { file: 'generated/manifest.json', doc: JSON.parse(JSON.stringify(manifest)) },
      registry: { file: registryPath, doc: JSON.parse(JSON.stringify(registryResult.data)) },
      chunks: chunks.map((c) => ({
        file: `generated/chunks/${c.id}.json`,
        doc: JSON.parse(JSON.stringify(c)),
      })),
      npcs: [],
    }),
  );

  if (violations.length === 0) {
    console.log(
      `✓ registry valid — ${registryResult.data.assets.length} assets resolve; generated world (${chunks.length} chunks) passes the gate`,
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
