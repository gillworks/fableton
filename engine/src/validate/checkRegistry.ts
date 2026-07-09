// SPDX-License-Identifier: Apache-2.0
//
// Registry half of `pnpm validate` (issue #5): the canonical asset
// registry parses, every asset path resolves to a real file, and the
// generator's output built from this registry passes the world gate —
// so every prop id the generator can emit resolves in the registry.
//
// Fonts are the other client-referenced asset set (issue #131): the
// client links assets/fonts/fonts.css and the browser fetches the
// woff2 faces it declares. Those paths live outside registry.json, so
// this also checks fonts.css exists and every url(/assets/…) in it
// resolves to a real vendored file — the deploy contract the client
// depends on. Both halves are network-free (they check the built asset
// tree on disk); deploy/verify-assets.mjs is the live-URL counterpart.
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
let registrySummary = '';
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

  registrySummary = `registry valid — ${registryResult.data.assets.length} assets resolve; generated world (${chunks.length} chunks) passes the gate`;
}

// Fonts: the client links assets/fonts/fonts.css and the browser fetches
// the faces it declares. Those paths are not in the registry, so check
// the stylesheet exists and every url(/assets/…) it declares resolves.
const fontsCssRel = 'assets/fonts/fonts.css';
const fontsCssPath = join(repoRoot, fontsCssRel);
let fontFacesChecked = 0;
if (!existsSync(fontsCssPath)) {
  violations.push({
    file: fontsCssRel,
    rule: 'asset-refs-resolve',
    message: `the client links "/${fontsCssRel}" but it does not exist`,
  });
} else {
  const css = readFileSync(fontsCssPath, 'utf8');
  for (const match of css.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) {
    const ref = match[1]!;
    // Only local /assets/* refs are the deploy contract; skip remote urls.
    if (!ref.startsWith('/assets/')) continue;
    fontFacesChecked++;
    const rel = ref.replace(/^\//, '');
    if (!existsSync(join(repoRoot, rel))) {
      violations.push({
        file: fontsCssRel,
        rule: 'asset-refs-resolve',
        message: `fonts.css declares "${ref}", which does not exist`,
      });
    }
  }
}

if (violations.length === 0) {
  const fontsSummary = `fonts.css valid — ${fontFacesChecked} face(s) resolve`;
  console.log(`✓ ${registrySummary}\n✓ ${fontsSummary}`);
}

// The generated world carries no NPC docs, so region-tethering never fires
// here; still, keep advisory warnings out of the registry check's exit code.
const errors = violations.filter((v) => (v.severity ?? 'error') === 'error');
for (const v of errors) {
  console.error(`✗ [${v.rule}] ${v.file}\n  ${v.message.split('\n').join('\n  ')}`);
}
if (errors.length > 0) {
  console.error(`\n${errors.length} violation(s) — the gate holds.`);
  process.exit(1);
}
