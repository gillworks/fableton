// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { ChunkSchema, type Chunk } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema, type Npc } from '../schemas/npc.js';
import { RumorsDocSchema, type RumorsDoc } from '../schemas/rumors.js';
import { DELTA_ENVELOPE_BUDGET, DELTA_PER_NPC_BUDGET, WorldSim, type SimEvent } from './worldSim.js';

const root = new URL('../../test/fixtures/sample-world/', import.meta.url);
const loadJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const charter = parseCharter(
  readFileSync(new URL('../../../charters/_template/charter.yaml', import.meta.url), 'utf8'),
);
const manifest = WorldManifestSchema.parse(loadJson('manifest.json'));
const chunks: Chunk[] = manifest.chunks.map((e) => ChunkSchema.parse(loadJson(e.path)));
const npcs: Npc[] = readdirSync(new URL('npcs/', root))
  .sort()
  .map((f) => NpcSchema.parse(loadJson(`npcs/${f}`)));

const makeSim = (ticksPerPhase = 600): WorldSim =>
  new WorldSim({ charter, manifest, chunks, npcs, ticksPerPhase });

describe('WorldSim', () => {
  it('boots the sample world: every NPC present with a diegetic activity', () => {
    const snapshot = makeSim().snapshot();
    expect(snapshot.phase).toBe('first light');
    expect(snapshot.npcs.map((n) => n.id)).toEqual([
      'greta-the-baker',
      'reynard-the-retired',
      'tam-the-lamplighter',
    ]);
    for (const npc of snapshot.npcs) expect(npc.activity.length).toBeGreaterThan(0);
  });

  it('NPCs follow their trees: Greta walks to the oven, then kneads', () => {
    const sim = makeSim();
    sim.tick();
    const walking = sim.snapshot().npcs.find((n) => n.id === 'greta-the-baker')!;
    expect(walking.activity).toBe('walking to the oven');
    const startPos = walking.pos.join(',');

    for (let i = 0; i < 12; i++) sim.tick();
    const kneading = sim.snapshot().npcs.find((n) => n.id === 'greta-the-baker')!;
    expect(kneading.activity).toBe('kneading dough');
    expect(kneading.pos.join(',')).not.toBe(startPos); // she moved to get there
    // She arrives at her personal spot beside the bakery-door nav node.
    const [dx, dz] = [kneading.pos[0] - 4, kneading.pos[2] - 4];
    expect(Math.hypot(dx, dz)).toBeLessThan(1);
  });

  it('activity labels change with the clock phase', () => {
    const sim = makeSim(10); // short phases so the day turns fast
    const activities: SimEvent[] = [];
    sim.onEvent((e) => activities.push(e));
    for (let i = 0; i < 11; i++) sim.tick();
    expect(sim.clock().phase).toBe('high sun');
    const greta = sim.snapshot().npcs.find((n) => n.id === 'greta-the-baker')!;
    expect(greta.activity).toBe('selling loaves at the door');
    expect(activities.some((e) => e.type === 'phase' && e.phase === 'high sun')).toBe(true);
    // Reynard starts on the orchard-path node, so his saunter completes
    // instantly and high sun finds him at the next leaf.
    expect(
      activities.some(
        (e) =>
          e.type === 'activity' &&
          e.npc === 'reynard-the-retired' &&
          e.activity === 'counting apples he did not steal',
      ),
    ).toBe(true);
  });

  it('an NPC with no entry for the phase narrates the lull with the tree label', () => {
    const oneEntry: Npc = {
      ...npcs[0]!,
      id: 'part-timer',
      relationships: [],
      behavior: {
        type: 'schedule',
        label: 'keeping to themselves',
        entries: [
          { phase: 'hush', child: { type: 'idle', label: 'sleeping', duration_s: 60 } },
        ],
      },
    };
    const chunksWithNpc = chunks.map((c) =>
      c.id === 'town-square' ? { ...c, npcs: [...c.npcs, 'part-timer'] } : c,
    );
    const sim = new WorldSim({ charter, manifest, chunks: chunksWithNpc, npcs: [oneEntry], ticksPerPhase: 600 });
    sim.tick();
    expect(sim.snapshot().npcs[0]!.activity).toBe('keeping to themselves');
  });

  it('wander drifts between seeded-random points with varied pauses', () => {
    const drifter: Npc = {
      ...npcs[0]!,
      id: 'drifter',
      relationships: [],
      behavior: {
        type: 'schedule',
        label: 'at loose ends',
        entries: charter.aesthetic.day_phases.map((phase) => ({
          phase,
          child: { type: 'wander' as const, label: 'drifting about the square', radius: 5, min_pause_s: 1, max_pause_s: 4 },
        })),
      },
    };
    const chunksWith = chunks.map((c) =>
      c.id === 'town-square' ? { ...c, npcs: [...c.npcs, 'drifter'] } : c,
    );
    const make = (): WorldSim =>
      new WorldSim({ charter, manifest, chunks: chunksWith, npcs: [drifter], ticksPerPhase: 600 });
    const sim = make();
    const positions = new Set<string>();
    let moving = 0;
    let paused = 0;
    let last = '';
    for (let i = 0; i < 400; i++) {
      sim.tick();
      const pos = sim.snapshot().npcs[0]!.pos.join(',');
      if (pos === last) paused++;
      else moving++;
      last = pos;
      positions.add(pos.split(',').map((v) => Math.round(Number(v))).join(','));
    }
    expect(moving).toBeGreaterThan(50); // it walks
    expect(paused).toBeGreaterThan(10); // it lingers
    expect(positions.size).toBeGreaterThan(4); // it goes places
    expect(sim.snapshot().npcs[0]!.activity).toBe('drifting about the square');
    // And identically on a second run — seeded, not wall-clock random.
    const again = make();
    for (let i = 0; i < 400; i++) again.tick();
    expect(again.snapshot()).toEqual(sim.snapshot());
  });

  it('is deterministic: two sims produce identical delta streams and snapshots', () => {
    const a = makeSim(50);
    const b = makeSim(50);
    const deltasA = [];
    const deltasB = [];
    for (let i = 0; i < 300; i++) {
      deltasA.push(a.tick());
      deltasB.push(b.tick());
    }
    expect(JSON.stringify(deltasA)).toEqual(JSON.stringify(deltasB));
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('holds the documented per-tick byte budget', () => {
    const sim = makeSim(50);
    for (let i = 0; i < 300; i++) {
      const delta = sim.tick();
      const bytes = Buffer.byteLength(JSON.stringify(delta), 'utf8');
      const budget = DELTA_ENVELOPE_BUDGET + DELTA_PER_NPC_BUDGET * delta.npcs.length;
      expect(bytes, `tick ${delta.tick}: ${bytes}B > ${budget}B`).toBeLessThanOrEqual(budget);
      expect(bytes).toBeLessThanOrEqual(DELTA_ENVELOPE_BUDGET + DELTA_PER_NPC_BUDGET * npcs.length);
    }
  });

  it('deltas are sparse: holding NPCs send nothing, movers resend no activity', () => {
    const sim = makeSim();
    sim.tick(); // everyone announces their first activity
    const second = sim.tick();
    // Greta and Tam are mid-walk: position changes, activity does not.
    const greta = second.npcs.find((n) => n.id === 'greta-the-baker')!;
    expect(greta.pos).toBeDefined();
    expect(greta.activity).toBeUndefined();
    // Reynard is napping (idle): after his first announcement, silence.
    expect(second.npcs.find((n) => n.id === 'reynard-the-retired')).toBeUndefined();
  });

  it('resumes from startTick: a redeploy lands on the derived day and phase', () => {
    const ticksPerPhase = 10; // 40-tick days
    const resumed = new WorldSim({ charter, manifest, chunks, npcs, ticksPerPhase, startTick: 92 });
    expect(resumed.clock().day).toBe(3);
    expect(resumed.clock().phase).toBe(charter.aesthetic.day_phases[1]);
    // The resumed sim keeps ticking from there — no reset to day 1.
    resumed.tick();
    expect(resumed.snapshot().tick).toBe(93);
  });

  it('derives its pace from the charter day length when no override is given', () => {
    const sim = new WorldSim({ charter, manifest, chunks, npcs });
    const expectedDayTicks = charter.generation.day_length_hours * 3600 * 2; // TICK_HZ
    expect(sim.pace().ticks_per_day).toBe(expectedDayTicks);
    expect(sim.pace().seconds_per_day).toBe(charter.generation.day_length_hours * 3600);
  });

  // A town-wide radius + certain chance so the mechanic fires regardless of
  // where the day's trees happen to put people — the unit tests in
  // gossipRuntime.test.ts cover realistic proximity and the seeded roll.
  const gossipDoc: RumorsDoc = RumorsDocSchema.parse({
    schema_version: 1,
    spread_radius: 1000,
    spread_chance: 1,
    rumors: [{ id: 'the-cold-oven', text: 'the oven knocked back', origin: 'greta-the-baker', notable: true }],
  });

  it('threads rumors through the sim: residents hear the origin, chronicle-notable', () => {
    const sim = new WorldSim({ charter, manifest, chunks, npcs, rumors: gossipDoc, ticksPerPhase: 600 });
    const events: SimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    sim.tick(); // co-located with greta at town-wide radius → everyone overhears

    const heardByTam = sim.heard('tam-the-lamplighter');
    expect(heardByTam).toEqual([{ rumor: 'the-cold-oven', from: 'greta-the-baker', tick: 1 }]);
    // The origin never "hears" its own rumor.
    expect(sim.heard('greta-the-baker')).toEqual([]);
    // Notable spread surfaced as a sim event for the chronicle.
    expect(
      events.some((e) => e.type === 'rumor' && e.from === 'greta-the-baker' && e.to === 'tam-the-lamplighter'),
    ).toBe(true);
  });

  it('gossip is deterministic: two sims spread identically', () => {
    const run = (): { heard: unknown; rumors: SimEvent[] } => {
      const sim = new WorldSim({ charter, manifest, chunks, npcs, rumors: gossipDoc, ticksPerPhase: 50 });
      const rumors: SimEvent[] = [];
      sim.onEvent((e) => e.type === 'rumor' && rumors.push(e));
      for (let i = 0; i < 20; i++) sim.tick();
      return { heard: npcs.map((n) => sim.heard(n.id)), rumors };
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });
});
