// SPDX-License-Identifier: Apache-2.0
//
// Run the authoritative sim on a world, headless.
// Usage: tsx src/sim/cli.ts --charter <charter.yaml> --world <dir> [--port 8090]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { ConstructionSiteSchema } from '../schemas/construction.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { ExpansionPlanSchema } from '../schemas/expansion.js';
import { NpcSchema } from '../schemas/npc.js';
import { RumorsDocSchema } from '../schemas/rumors.js';
import { TICK_HZ } from './clock.js';
import { startSimServer } from './server.js';
import { WorldSim } from './worldSim.js';

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    world: { type: 'string' },
    port: { type: 'string' },
  },
});
if (!values.charter || !values.world) {
  console.error('usage: cli.ts --charter <charter.yaml> --world <dir> [--port 8090]');
  process.exit(2);
}
const worldDir = values.world;
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(worldDir, rel), 'utf8'));

const charter = parseCharter(readFileSync(values.charter, 'utf8'));
const manifest = WorldManifestSchema.parse(readJson('manifest.json'));
const chunks = manifest.chunks.map((entry) => ChunkSchema.parse(readJson(entry.path)));
const npcsDir = join(worldDir, 'npcs');
const npcs = existsSync(npcsDir)
  ? readdirSync(npcsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => NpcSchema.parse(readJson(join('npcs', f))))
  : [];
const rumors = existsSync(join(worldDir, 'rumors.json'))
  ? RumorsDocSchema.parse(readJson('rumors.json'))
  : undefined;
const constructionDir = join(worldDir, 'construction');
const sites = existsSync(constructionDir)
  ? readdirSync(constructionDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => ConstructionSiteSchema.parse(readJson(join('construction', f))))
  : [];
const expansionPlan = existsSync(join(worldDir, 'expansion-plan.json'))
  ? ExpansionPlanSchema.parse(readJson('expansion-plan.json'))
  : undefined;

const sim = new WorldSim({
  charter,
  manifest,
  chunks,
  npcs,
  ...(rumors && { rumors }),
  sites,
  ...(expansionPlan && { expansionPlan }),
});
// The decision log's v1 surface: every notable sim event, legible.
sim.onEvent((event) => {
  if (event.type === 'phase') console.log(`[tick ${event.tick}] the world turns: ${event.phase}`);
  else if (event.type === 'weather')
    console.log(`[tick ${event.tick}] the weather turns: ${event.weather.label}`);
  else if (event.type === 'rumor')
    console.log(`[tick ${event.tick}] rumor — ${event.from} → ${event.to}: ${event.text}`);
  else if (event.type === 'event') console.log(`[tick ${event.tick}] the ${event.event} begins`);
  else if (event.type === 'construction')
    console.log(`[tick ${event.tick}] construction — ${event.text}`);
  else if (event.type === 'expansion')
    console.log(`[tick ${event.tick}] ground breaks: ${event.site} — ${event.stage}`);
  else console.log(`[tick ${event.tick}] ${event.npc} — ${event.activity}`);
});

const server = await startSimServer(sim, { port: Number(values.port ?? 8090) });
console.log(
  `world-sim: "${charter.identity.name}" live on ws://localhost:${server.port} — ${npcs.length} NPCs, ${TICK_HZ} Hz, phase "${sim.clock().phase}"`,
);
