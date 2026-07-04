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
import { ConstructionSiteSchema } from '../schemas/construction.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
import { RumorsDocSchema } from '../schemas/rumors.js';
import { startTickAt } from '../sim/clock.js';
import { startSimServer } from '../sim/server.js';
import { WorldSim } from '../sim/worldSim.js';
import { githubWishIntakeFromEnv } from './wishIntake.js';
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

// Wall time lives here in the server layer: a founded world resumes the
// day/phase it should be on, so deploys never reset the town to day 1.
const startTick = manifest.founded_at ? startTickAt(Date.parse(manifest.founded_at), Date.now()) : 0;
const sim = new WorldSim({ charter, manifest, chunks, npcs, ...(rumors && { rumors }), sites, startTick });
const { day, phase } = sim.clock();
console.log(
  manifest.founded_at
    ? `resuming "${charter.identity.name}" at day ${day}, ${phase} (founded ${manifest.founded_at})`
    : `"${charter.identity.name}" has no founded_at — starting at day 1`,
);
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

// The viewer wish source of the feedback funnel (issue #79). Bring-your-
// own-keys: with no FABLETON_WISH_TOKEN the intake is null and the wish
// endpoint reports that wishes are closed — the v1 stack needs no keys.
const wishIntake = githubWishIntakeFromEnv();
if (wishIntake) {
  console.log(`wish intake enabled → issues in ${process.env['FABLETON_WISH_REPO'] ?? process.env['FABLETON_REPO_URL']}`);
} else if (process.env['FABLETON_WISH_TOKEN']) {
  // Token is present but no usable repo parsed — don't blame the token.
  console.log(
    'wish intake disabled — FABLETON_WISH_TOKEN is set but no usable repo; ' +
      'set FABLETON_WISH_REPO (or FABLETON_REPO_URL) to an owner/repo slug',
  );
} else {
  console.log('wish intake disabled (no FABLETON_WISH_TOKEN)');
}

const simServer = await startSimServer(sim, { port: Number(values['sim-port'] ?? 8090) });
const api = await startWorldApi(
  { sim, charter, manifest, chunks, npcs, registry, ...(rumors && { rumors }) },
  { port: Number(values['api-port'] ?? 8091), wishIntake },
);
console.log(
  `"${charter.identity.name}" live — sim ws://localhost:${simServer.port} · api http://localhost:${api.port}/api/world`,
);
