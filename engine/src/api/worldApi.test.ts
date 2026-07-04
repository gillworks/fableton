// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
import { WorldSim } from '../sim/worldSim.js';
import { startWorldApi, type WorldApi } from './worldApi.js';
import type { WishIntake } from './wishIntake.js';

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

  it('POST /api/wishes is closed (503) when no intake is configured', async () => {
    // The shared `api` above was started without a wishIntake.
    const res = await fetch(`${base}/api/wishes`, {
      method: 'POST',
      body: JSON.stringify({ wish: 'build a lighthouse' }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('wishing well');
  });
});

describe('world-api wish intake (issue #79)', () => {
  const filed: string[] = [];
  let clock = 0;
  const intake: WishIntake = {
    file: async (wish) => {
      filed.push(wish);
      return { url: `https://github.com/gillworks/fableton/issues/${filed.length}`, number: filed.length };
    },
  };
  let wishApi: WorldApi;
  let wishBase: string;

  beforeAll(async () => {
    const wishSim = new WorldSim({ charter, manifest, chunks, npcs });
    wishApi = await startWorldApi(
      { sim: wishSim, charter, manifest, chunks, npcs, registry },
      { port: 0, wishIntake: intake, now: () => clock },
    );
    wishBase = `http://localhost:${wishApi.port}`;
  });
  afterAll(async () => wishApi.close());

  it('files a valid wish as a labeled issue and returns where it landed', async () => {
    const res = await fetch(`${wishBase}/api/wishes`, {
      method: 'POST',
      body: JSON.stringify({ wish: 'build a lighthouse on the point' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.number).toBe(1);
    expect(body.url).toContain('/issues/1');
    expect(filed).toContain('build a lighthouse on the point');
  });

  it('rejects a too-short wish (400) without filing anything', async () => {
    const before = filed.length;
    const res = await fetch(`${wishBase}/api/wishes`, { method: 'POST', body: JSON.stringify({ wish: 'x' }) });
    expect(res.status).toBe(400);
    expect(filed.length).toBe(before);
  });

  it('rejects a too-long wish (400)', async () => {
    const res = await fetch(`${wishBase}/api/wishes`, {
      method: 'POST',
      body: JSON.stringify({ wish: 'a'.repeat(281) }),
    });
    expect(res.status).toBe(400);
  });

  it('rate-limits repeated wishes from one client, then recovers after the window', async () => {
    const post = (): Promise<Response> =>
      fetch(`${wishBase}/api/wishes`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ wish: 'plant an orchard by the mill' }),
      });
    // The valid+rejected tests above used no XFF (a different bucket), so
    // this client starts fresh: 3 land, the 4th is turned away.
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
    // Advance past the 10-minute window — the well fills again.
    clock += 11 * 60_000;
    expect((await post()).status).toBe(201);
  });

  it('counts the trusted rightmost XFF hop, not the spoofable leftmost', async () => {
    // Move well past any earlier window so this client starts fresh.
    clock += 60 * 60_000;
    // caddy appends the real peer (198.51.100.7) to whatever the client
    // sent; rotating the leftmost value must NOT mint a fresh bucket, or the
    // rate limit is trivially bypassed.
    const post = (spoofed: string): Promise<Response> =>
      fetch(`${wishBase}/api/wishes`, {
        method: 'POST',
        headers: { 'x-forwarded-for': `${spoofed}, 198.51.100.7` },
        body: JSON.stringify({ wish: 'raise a festival in the square' }),
      });
    expect((await post('1.1.1.1')).status).toBe(201);
    expect((await post('2.2.2.2')).status).toBe(201);
    expect((await post('3.3.3.3')).status).toBe(201);
    expect((await post('4.4.4.4')).status).toBe(429);
  });
});
