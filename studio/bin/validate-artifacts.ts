// SPDX-License-Identifier: Apache-2.0
//
// Validate a world's divine artifacts against the engine schemas.
//   pnpm --dir studio exec tsx bin/validate-artifacts.ts <world>
// Absent artifacts are fine (a young world); present-but-invalid fails.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MasterPlanSchema,
  DecreeLogSchema,
  WorldBibleAmendmentSchema,
} from '@fableton/engine';

const world = process.argv[2];
if (!world) {
  console.error('usage: validate-artifacts.ts <world>');
  process.exit(2);
}

const dir = join(import.meta.dirname, '..', '..', 'worlds', world, 'artifacts');
let failures = 0;

function check(name: string, schema: { parse: (v: unknown) => unknown }, path: string) {
  try {
    schema.parse(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (!existsSync(dir)) {
  console.log(`no artifacts yet for ${world} — valid (a young world)`);
  process.exit(0);
}

if (existsSync(join(dir, 'master-plan.json')))
  check('master-plan.json', MasterPlanSchema, join(dir, 'master-plan.json'));
if (existsSync(join(dir, 'decrees.json')))
  check('decrees.json', DecreeLogSchema, join(dir, 'decrees.json'));
const amendments = join(dir, 'amendments');
if (existsSync(amendments))
  for (const f of readdirSync(amendments).filter((f) => f.endsWith('.json')))
    check(`amendments/${f}`, WorldBibleAmendmentSchema, join(amendments, f));

process.exit(failures ? 1 : 0);
