// SPDX-License-Identifier: Apache-2.0
//
// Live-URL counterpart to `pnpm validate`'s asset checks (issue #131):
// the build-time gate (engine/src/validate/checkRegistry.ts) proves the
// asset tree is correct on disk; this proves the *deployed* site serves
// it. It derives the canonical client-referenced asset set from the repo
// — fonts.css + every face it declares + registry.json + every GLB path
// — and HEADs each against a base URL, asserting 200. No guessing: the
// list is whatever the client actually fetches.
//
// Usage: node deploy/verify-assets.mjs [baseUrl]
//   baseUrl defaults to $FABLETON_BASE_URL or https://fableton.world
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = (process.argv[2] ?? process.env.FABLETON_BASE_URL ?? 'https://fableton.world').replace(/\/$/, '');

// The canonical set of paths the client requests, derived from the repo.
const paths = new Set(['/assets/fonts/fonts.css', '/assets/registry.json']);

const css = readFileSync(join(repoRoot, 'assets/fonts/fonts.css'), 'utf8');
for (const m of css.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) {
  if (m[1].startsWith('/assets/')) paths.add(m[1]);
}

const registry = JSON.parse(readFileSync(join(repoRoot, 'assets/registry.json'), 'utf8'));
for (const asset of registry.assets) paths.add('/' + asset.path.replace(/^\//, ''));

const sorted = [...paths].sort();
console.log(`Verifying ${sorted.length} client-referenced asset paths against ${baseUrl}\n`);

let failures = 0;
for (const p of sorted) {
  let code = 0;
  try {
    const res = await fetch(baseUrl + p, { method: 'HEAD', redirect: 'manual' });
    code = res.status;
  } catch (err) {
    console.log(`  ERR  ${p}  (${err.message})`);
    failures++;
    continue;
  }
  const ok = code === 200;
  if (!ok) failures++;
  console.log(`  ${ok ? '200 ' : String(code).padEnd(4)} ${p}`);
}

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures}/${sorted.length} asset path(s) did not return 200 on ${baseUrl}`);
  process.exit(1);
}
console.log(`✓ all ${sorted.length} client-referenced assets resolve 200 on ${baseUrl}`);
