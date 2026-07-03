// SPDX-License-Identifier: Apache-2.0
//
// Validate divine artifacts against the engine schemas — one world, or
// every world in the repo when no argument is given (the pnpm validate
// gate runs the no-arg form; issue #41).
//   pnpm --dir studio exec tsx bin/validate-artifacts.ts [world]
// Absent artifacts are fine (a young world); present-but-invalid fails.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MasterPlanSchema,
  DecreeLogSchema,
  WorldBibleAmendmentSchema,
} from '@fableton/engine';

const worldsRoot = join(import.meta.dirname, '..', '..', 'worlds');
const worlds = process.argv[2]
  ? [process.argv[2]]
  : readdirSync(worldsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
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

for (const world of worlds) {
  const dir = join(worldsRoot, world, 'artifacts');
  if (!existsSync(dir)) {
    console.log(`no artifacts yet for ${world} — valid (a young world)`);
    continue;
  }
  if (existsSync(join(dir, 'master-plan.json')))
    check(`${world}/master-plan.json`, MasterPlanSchema, join(dir, 'master-plan.json'));
  if (existsSync(join(dir, 'decrees.json')))
    check(`${world}/decrees.json`, DecreeLogSchema, join(dir, 'decrees.json'));
  const amendments = join(dir, 'amendments');
  if (existsSync(amendments))
    for (const f of readdirSync(amendments).filter((f) => f.endsWith('.json')))
      check(`${world}/amendments/${f}`, WorldBibleAmendmentSchema, join(amendments, f));
}

process.exit(failures ? 1 : 0);
