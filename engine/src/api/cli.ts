// SPDX-License-Identifier: Apache-2.0
//
// Serve a world: the authoritative sim (WebSocket) + world-api (REST) in
// one process, sharing the same WorldSim so behavior-tree updates are
// live. Usage:
//   tsx src/api/cli.ts --charter <charter.yaml> --world <dir> [--sim-port 8090] [--api-port 8091]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
import { startSimServer } from '../sim/server.js';
import { WorldSim } from '../sim/worldSim.js';
import { startWorldApi } from './worldApi.js';

const { values } = parseArgs({
  options: {
    charter: { type: 'string' },
    world: { type: 'string' },
    'sim-port': { type: 'string' },
    'api-port': { type: 'string' },
  },
});
if (!values.charter || !values.world) {
  console.error('usage: cli.ts --charter <charter.yaml> --world <dir> [--sim-port 8090] [--api-port 8091]');
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
const registry = AssetRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../assets/registry.json', import.meta.url), 'utf8')),
);

const sim = new WorldSim({ charter, manifest, chunks, npcs });
sim.onEvent((event) => {
  if (event.type === 'phase') console.log(`[tick ${event.tick}] the world turns: ${event.phase}`);
  else console.log(`[tick ${event.tick}] ${event.npc} — ${event.activity}`);
});

const simServer = await startSimServer(sim, { port: Number(values['sim-port'] ?? 8090) });
const api = await startWorldApi(
  { sim, charter, manifest, chunks, npcs, registry },
  { port: Number(values['api-port'] ?? 8091) },
);
console.log(
  `"${charter.identity.name}" live — sim ws://localhost:${simServer.port} · api http://localhost:${api.port}/api/world`,
);
