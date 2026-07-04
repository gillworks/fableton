// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import type { Charter } from '../schemas/charter.js';
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

  it('gathers residents for a charter town event, and records the occurrence', () => {
    // A festival every other day (days 1, 3, 5…), all day.
    const festive = {
      ...charter,
      calendar: {
        events: [{ name: 'Lantern Festival', cadence: { every_days: 2, offset_days: 0 }, phases: [] }],
      },
    };
    // A townsperson who minds the shop until the festival, then streams to the
    // square to light a lantern — the on_event branch is their event context.
    const reveler: Npc = {
      ...npcs[0]!,
      id: 'reveler',
      relationships: [],
      behavior: {
        type: 'on_event',
        label: 'a quiet evening in',
        event: 'Lantern Festival',
        child: {
          type: 'sequence',
          label: 'to the lanterns',
          children: [
            { type: 'move', label: 'streaming toward the lanterns', to: 'lamp-corner' },
            { type: 'interact', label: 'lighting a lantern', with: 'lantern', duration_s: 30 },
          ],
        },
        otherwise: { type: 'idle', label: 'minding the shop', duration_s: 60 },
      },
    };
    const chunksWith = chunks.map((c) =>
      c.id === 'town-square' ? { ...c, npcs: [...c.npcs, 'reveler'] } : c,
    );
    // 10 ticks/phase ⇒ 40-tick days. startTick 79 is one tick shy of day 3.
    const make = (startTick: number): WorldSim =>
      new WorldSim({ charter: festive, manifest, chunks: chunksWith, npcs: [reveler], ticksPerPhase: 10, startTick });

    // Ordinary day (day 2): no event, so the reveler keeps to the shop.
    const ordinary = make(40);
    ordinary.tick();
    expect(ordinary.clock().day).toBe(2);
    expect(ordinary.snapshot().npcs[0]!.activity).toBe('minding the shop');

    // Cross into day 3: the festival comes into effect.
    const eve = make(79);
    const events: SimEvent[] = [];
    eve.onEvent((e) => events.push(e));
    const restingPos = eve.snapshot().npcs[0]!.pos.join(',');
    eve.tick();
    expect(eve.clock().day).toBe(3);
    // The occurrence is announced once, as the event begins (chronicle reads this).
    expect(events).toContainEqual({ type: 'event', tick: 80, event: 'Lantern Festival' });
    expect(eve.snapshot().npcs[0]!.activity).toBe('streaming toward the lanterns');
    for (let i = 0; i < 20; i++) eve.tick();
    const gathered = eve.snapshot().npcs[0]!;
    expect(gathered.pos.join(',')).not.toBe(restingPos); // they left the shop to gather
    expect(['streaming toward the lanterns', 'lighting a lantern']).toContain(gathered.activity);

    // Deterministic: the same founding and clock replay identically.
    const a2 = make(79);
    const b2 = make(79);
    for (let i = 0; i < 40; i++) {
      a2.tick();
      b2.tick();
    }
    expect(a2.snapshot()).toEqual(b2.snapshot());
    expect(a2.event()).toBe(b2.event());
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

  it('carries the day\'s weather in the snapshot with a diegetic label', () => {
    const snapshot = makeSim().snapshot();
    expect(snapshot.weather.season.length).toBeGreaterThan(0);
    expect(snapshot.weather.label.length).toBeGreaterThan(0);
    expect(['clear', 'rain', 'fog', 'snow']).toContain(snapshot.weather.kind);
  });

  it('a weather node branches on the day\'s weather with a diegetic label', () => {
    // Force rain so the branch is deterministic, no matter the seed's draw.
    const rainy: Charter = {
      ...charter,
      climate: {
        season_length_days: 999,
        seasons: [{ name: 'monsoon', weather: [{ kind: 'rain', label: 'rain', weight: 1, intensity: 0.8 }] }],
      },
    };
    const keeper: Npc = {
      ...npcs[0]!,
      id: 'awning-keeper',
      relationships: [],
      behavior: {
        type: 'schedule',
        label: 'minding the shopfront',
        entries: charter.aesthetic.day_phases.map((phase) => ({
          phase,
          child: {
            type: 'weather' as const,
            label: 'reading the sky',
            entries: [
              {
                kind: 'rain' as const,
                child: { type: 'idle' as const, label: 'waiting out the rain under the awning', duration_s: 60 },
              },
            ],
            fallback: { type: 'idle' as const, label: 'sweeping the step', duration_s: 60 },
          },
        })),
      },
    };
    const chunksWith = chunks.map((c) =>
      c.id === 'town-square' ? { ...c, npcs: [...c.npcs, 'awning-keeper'] } : c,
    );
    const rainSim = new WorldSim({ charter: rainy, manifest, chunks: chunksWith, npcs: [keeper], ticksPerPhase: 600 });
    rainSim.tick();
    expect(rainSim.weather().kind).toBe('rain');
    expect(rainSim.snapshot().npcs[0]!.activity).toBe('waiting out the rain under the awning');

    // A clear charter takes the fallback branch instead.
    const clear: Charter = {
      ...charter,
      climate: {
        season_length_days: 999,
        seasons: [{ name: 'the dry', weather: [{ kind: 'clear', label: 'clear', weight: 1, intensity: 0 }] }],
      },
    };
    const clearSim = new WorldSim({ charter: clear, manifest, chunks: chunksWith, npcs: [keeper], ticksPerPhase: 600 });
    clearSim.tick();
    expect(clearSim.snapshot().npcs[0]!.activity).toBe('sweeping the step');
  });

  it('weather turns on the day boundary: it rides the delta and fires an event', () => {
    // Two one-day seasons with distinct weather, so day 2 is guaranteed to
    // differ from day 1 — no reliance on the weighted draw.
    const turning: Charter = {
      ...charter,
      climate: {
        season_length_days: 1,
        seasons: [
          { name: 'wet', weather: [{ kind: 'rain', label: 'the first rain', weight: 1, intensity: 0.6 }] },
          { name: 'white', weather: [{ kind: 'snow', label: 'the first snow', weight: 1, intensity: 0.7 }] },
        ],
      },
    };
    const ticksPerPhase = 2; // an 8-tick day (4 phases)
    const sim = new WorldSim({ charter: turning, manifest, chunks, npcs, ticksPerPhase });
    const events: SimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    expect(sim.weather()).toMatchObject({ kind: 'rain', label: 'the first rain' });
    let dayTwoDelta;
    for (let i = 0; i < 8; i++) dayTwoDelta = sim.tick(); // tick 8 lands on day 2
    expect(sim.clock().day).toBe(2);
    expect(sim.weather()).toMatchObject({ kind: 'snow', label: 'the first snow' });
    expect(dayTwoDelta!.weather).toMatchObject({ kind: 'snow', label: 'the first snow' });
    expect(events.some((e) => e.type === 'weather' && e.weather.kind === 'snow')).toBe(true);
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
