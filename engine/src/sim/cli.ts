// SPDX-License-Identifier: Apache-2.0
//
// Run the authoritative sim on a world, headless.
// Usage: tsx src/sim/cli.ts --charter <charter.yaml> --world <dir> [--port 8090]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
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

const sim = new WorldSim({ charter, manifest, chunks, npcs });
// The decision log's v1 surface: every notable sim event, legible.
sim.onEvent((event) => {
  if (event.type === 'phase') console.log(`[tick ${event.tick}] the world turns: ${event.phase}`);
  else console.log(`[tick ${event.tick}] ${event.npc} — ${event.activity}`);
});

const server = await startSimServer(sim, { port: Number(values.port ?? 8090) });
console.log(
  `world-sim: "${charter.identity.name}" live on ws://localhost:${server.port} — ${npcs.length} NPCs, ${TICK_HZ} Hz, phase "${sim.clock().phase}"`,
);
