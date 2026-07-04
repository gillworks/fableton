// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
import { RumorsDocSchema } from '../schemas/rumors.js';
import { WorldSim } from '../sim/worldSim.js';
import { startWorldApi, type WorldApi } from './worldApi.js';

const root = new URL('../../test/fixtures/sample-world/', import.meta.url);
const loadJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const charter = parseCharter(
  readFileSync(new URL('../../../charters/_template/charter.yaml', import.meta.url), 'utf8'),
);
const manifest = WorldManifestSchema.parse(loadJson('manifest.json'));
const chunks = manifest.chunks.map((e) => ChunkSchema.parse(loadJson(e.path)));
const npcs = readdirSync(new URL('npcs/', root))
  .sort()
  .map((f) => NpcSchema.parse(loadJson(`npcs/${f}`)));
const registry = AssetRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../assets/registry.json', import.meta.url), 'utf8')),
);

let sim: WorldSim;
let api: WorldApi;
let base: string;

beforeAll(async () => {
  sim = new WorldSim({ charter, manifest, chunks, npcs });
  api = await startWorldApi({ sim, charter, manifest, chunks, npcs, registry }, { port: 0 });
  base = `http://localhost:${api.port}`;
});
afterAll(async () =>
  api.close());

describe('world-api', () => {
  it('GET /api/world returns world metadata with the live clock', async () => {
    const res = await fetch(`${base}/api/world`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.world).toBe('Fableton');
    expect(body.phases).toHaveLength(4);
    expect(body.npcs).toBe(3);
    expect(body.clock.phase).toBe('first light');
  });

  it('GET /api/npcs lists, GET /api/npcs/:id returns lore, unknown 404s', async () => {
    const list = await (await fetch(`${base}/api/npcs`)).json();
    expect(list.map((n: { id: string }) => n.id)).toContain('greta-the-baker');

    const greta = await (await fetch(`${base}/api/npcs/greta-the-baker`)).json();
    expect(greta.identity.name).toBe('Greta');
    expect(greta.identity.story).toContain('gingerbread');
    expect(greta.relationships.length).toBeGreaterThan(0);

    const missing = await fetch(`${base}/api/npcs/nobody-here`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toContain('nobody-here');
  });

  it('GET /api/chronicle records sim events diegetically', async () => {
    sim.tick();
    const { entries } = await (await fetch(`${base}/api/chronicle`)).json();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e: { entry: string }) => e.entry.includes('walking to the oven'))).toBe(true);
  });

  it('POST behavior update changes NPC behavior live — no restart', async () => {
    const res = await fetch(`${base}/api/npcs/tam-the-lamplighter/behavior`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'schedule',
        label: 'a lamplighter reconsidered',
        entries: [
          {
            phase: 'first light',
            child: { type: 'idle', label: 'staring meaningfully at the unlit lamp', duration_s: 300 },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    sim.tick(); // next tick, the new mind is live
    const tam = sim.snapshot().npcs.find((n) => n.id === 'tam-the-lamplighter')!;
    expect(tam.activity).toBe('staring meaningfully at the unlit lamp');
  });

  it('rejects an unlabeled node with a legible schema error', async () => {
    const res = await fetch(`${base}/api/npcs/greta-the-baker/behavior`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'schedule',
        label: 'a day',
        entries: [{ phase: 'first light', child: { type: 'idle', duration_s: 10 } }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('NPC schema');
    expect(body.detail).toContain('label');
    // And the live sim was untouched.
    sim.tick();
    const greta = sim.snapshot().npcs.find((n) => n.id === 'greta-the-baker')!;
    expect(greta.activity).not.toBe('a day');
  });

  it('rejects a tree whose refs do not resolve, via the world gate', async () => {
    const res = await fetch(`${base}/api/npcs/greta-the-baker/behavior`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'schedule',
        label: 'wanderlust',
        entries: [
          { phase: 'first light', child: { type: 'move', label: 'leaving town', to: 'the-horizon' } },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('world gate');
    expect(JSON.stringify(body.detail)).toContain('the-horizon');
  });

  it('admin config: defaults, update, and validation', async () => {
    const defaults = await (await fetch(`${base}/api/admin/config`)).json();
    expect(defaults).toEqual({ audit_sample_percent: 10, escalation_cap: 5 });

    const put = await fetch(`${base}/api/admin/config`, {
      method: 'PUT',
      body: JSON.stringify({ audit_sample_percent: 100, escalation_cap: 2 }),
    });
    expect(put.status).toBe(200);
    expect(await (await fetch(`${base}/api/admin/config`)).json()).toEqual({
      audit_sample_percent: 100,
      escalation_cap: 2,
    });

    const bad = await fetch(`${base}/api/admin/config`, {
      method: 'PUT',
      body: JSON.stringify({ audit_sample_percent: 250, escalation_cap: -1 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('world-api gossip (issue #81)', () => {
  let gossipApi: WorldApi;
  let gossipBase: string;

  const rumors = RumorsDocSchema.parse({
    schema_version: 1,
    spread_radius: 1000, // town-wide so co-location is guaranteed this run
    spread_chance: 1,
    rumors: [{ id: 'the-cold-oven', text: 'the oven knocked back', origin: 'greta-the-baker', notable: true }],
  });

  beforeAll(async () => {
    const gossipSim = new WorldSim({ charter, manifest, chunks, npcs, rumors, ticksPerPhase: 600 });
    gossipApi = await startWorldApi(
      { sim: gossipSim, charter, manifest, chunks, npcs, registry, rumors },
      { port: 0 },
    );
    gossipBase = `http://localhost:${gossipApi.port}`;
    gossipSim.tick(); // everyone overhears greta
  });
  afterAll(async () => gossipApi.close());

  it('GET /api/npcs/:id reports what a resident has heard and from whom', async () => {
    const tam = await (await fetch(`${gossipBase}/api/npcs/tam-the-lamplighter`)).json();
    expect(tam.heard).toEqual([
      { text: 'the oven knocked back', from: 'greta-the-baker', tick: 1 },
    ]);
    // The origin doesn't hear its own rumor.
    const greta = await (await fetch(`${gossipBase}/api/npcs/greta-the-baker`)).json();
    expect(greta.heard).toEqual([]);
  });

  it('records notable spread in the chronicle, resolving ids to names and text', async () => {
    const { entries } = await (await fetch(`${gossipBase}/api/chronicle`)).json();
    expect(
      entries.some((e: { entry: string }) => e.entry === 'Tam heard from Greta: “the oven knocked back”'),
    ).toBe(true);
  });
});
