// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import type { Charter } from '../schemas/charter.js';
import { ChunkSchema, type Chunk } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema, type Npc } from '../schemas/npc.js';
import { ConstructionSiteSchema, type ConstructionSite } from '../schemas/construction.js';
import { RumorsDocSchema, type RumorsDoc } from '../schemas/rumors.js';
import { ExpansionPlanSchema, type ExpansionPlan } from '../schemas/expansion.js';
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
    // NOTE: the sample world authors no construction sites, so this asserts the
    // NPC/activity/weather wire only. A stage transition rides an extra
    // `construction: [{id,stage,stageIndex}]` (~50-90 B) *outside* the per-NPC
    // budget — transitions are rare and the envelope has slack, but that path
    // is intentionally not measured here. If a construction-bearing world is
    // ever added to this suite, fold that allowance into the budget.
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

  // Greta's tree walks her to the oven at (4,0,4); a site placed there with
  // her role as its builder means her authored schedule brings her onto the
  // job — the interpreter spends the work units while she stands on it. The
  // unit tests in constructionRuntime.test.ts cover presence, role matching,
  // and the seeded effort directly.
  const bakerySite: ConstructionSite = ConstructionSiteSchema.parse({
    schema_version: 1,
    id: 'bakery-extension',
    chunk: 'town-square',
    position: [4, 0, 4],
    footprint: { width: 4, depth: 4 },
    builder_roles: ['witch-gone-respectable'], // Greta's identity.kind
    stages: [
      { name: 'marked plot', asset: 'stakes', work_units: 2 },
      { name: 'foundation', asset: 'foundation-mesh', work_units: 3 },
      { name: 'frame', asset: 'frame-mesh', work_units: 5 },
    ],
    completion: { props: [{ asset: 'bakery', position: [4, 0, 4] }] },
  });

  it('builders raise a site through its stages: chronicle events + compact deltas', () => {
    const sim = new WorldSim({ charter, manifest, chunks, npcs, sites: [bakerySite], ticksPerPhase: 600 });
    const events: SimEvent[] = [];
    sim.onEvent((e) => e.type === 'construction' && events.push(e));
    // Snapshot before any tick: the site sits at its first authored stage.
    expect(sim.snapshot().construction).toEqual([
      { id: 'bakery-extension', chunk: 'town-square', stage: 'marked plot', stageIndex: 0, stageCount: 3, progress: 0, required: 2, workers: [], complete: false },
    ]);

    const constructionDeltas: number[] = [];
    for (let i = 0; i < 40; i++) {
      const delta = sim.tick();
      if (delta.construction) {
        constructionDeltas.push(delta.tick);
        // Budget coverage for the construction wire path (the standalone
        // budget test runs a site-less world, so it never sees this). A
        // transition entry rides *outside* the per-active-NPC budget — a lone
        // builder holding on the site contributes nothing to delta.npcs, yet
        // the ~55B entry still ships — so it is bounded by the whole-town
        // budget, which is what actually caps worst-case wire size.
        const bytes = Buffer.byteLength(JSON.stringify(delta), 'utf8');
        expect(bytes, `construction tick ${delta.tick}: ${bytes}B`).toBeLessThanOrEqual(
          DELTA_ENVELOPE_BUDGET + DELTA_PER_NPC_BUDGET * npcs.length,
        );
      }
    }

    // She climbs the ladder in order and finishes; the chronicle sees each
    // rung as a diegetic line, ending on completion.
    expect(events.map((e) => e.type === 'construction' && e.stage)).toEqual(['foundation', 'frame', 'frame']);
    expect(events.map((e) => e.type === 'construction' && e.text)).toEqual([
      'the bakery extension — foundation',
      'the bakery extension — frame',
      'the bakery extension is complete',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'construction', done: true, stageIndex: 3 });
    // Deltas carry construction only on the ticks a stage actually turns —
    // one entry per transition, not every accruing tick.
    expect(constructionDeltas.length).toBe(events.length);
    expect(sim.construction()[0]).toMatchObject({ complete: true, stageIndex: 3, workers: [] });
  });

  it('collapses multiple stage crossings in one tick to a single delta entry per site', () => {
    // Three one-unit stages: a builder rolling 2 effort in a tick clears two
    // rungs at once. The chronicle must still narrate every crossing, but the
    // wire carries one last-writer entry per site (the client is last-writer-
    // wins, so intermediate same-id entries would be pure redundancy).
    const fastSite = ConstructionSiteSchema.parse({
      ...bakerySite,
      id: 'quick-shed',
      stages: [
        { name: 'a', asset: 'stakes', work_units: 1 },
        { name: 'b', asset: 'foundation-mesh', work_units: 1 },
        { name: 'c', asset: 'frame-mesh', work_units: 1 },
      ],
    });
    const sim = new WorldSim({ charter, manifest, chunks, npcs, sites: [fastSite], ticksPerPhase: 600 });
    const eventsByTick = new Map<number, string[]>();
    sim.onEvent((e) => {
      if (e.type === 'construction') eventsByTick.set(e.tick, [...(eventsByTick.get(e.tick) ?? []), e.stage]);
    });
    for (let i = 0; i < 60; i++) {
      const delta = sim.tick();
      if (!delta.construction) continue;
      // Invariant: at most one entry per site id on any tick, no matter how
      // many stages turned — the collapse guard.
      const ids = delta.construction.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      // On a tick where >1 stage crossed, the lone entry is the *final* stage.
      const crossings = eventsByTick.get(delta.tick) ?? [];
      if (crossings.length > 1) {
        const entry = delta.construction.find((c) => c.id === 'quick-shed')!;
        expect(entry.stage).toBe(crossings[crossings.length - 1]);
      }
    }
    // The double-crossing tick actually happened (else this test proves nothing).
    expect([...eventsByTick.values()].some((s) => s.length > 1)).toBe(true);
    expect(sim.construction()[0]).toMatchObject({ complete: true, stageIndex: 3 });
  });

  it('construction is deterministic: two sims produce identical site state and deltas', () => {
    const run = (): { deltas: string; state: unknown } => {
      const sim = new WorldSim({ charter, manifest, chunks, npcs, sites: [bakerySite], ticksPerPhase: 50 });
      const deltas = [];
      for (let i = 0; i < 60; i++) deltas.push(sim.tick());
      return { deltas: JSON.stringify(deltas.map((d) => d.construction ?? null)), state: sim.construction() };
    };
    const a = run();
    const b = run();
    expect(a.deltas).toEqual(b.deltas);
    expect(JSON.stringify(a.state)).toEqual(JSON.stringify(b.state));
  });

  it('a site whose builder role matches no resident never progresses', () => {
    const orphan = ConstructionSiteSchema.parse({ ...bakerySite, id: 'ghost-hall', builder_roles: ['stonemason'] });
    const sim = new WorldSim({ charter, manifest, chunks, npcs, sites: [orphan], ticksPerPhase: 600 });
    const events: SimEvent[] = [];
    sim.onEvent((e) => e.type === 'construction' && events.push(e));
    for (let i = 0; i < 100; i++) sim.tick();
    expect(events).toEqual([]);
    expect(sim.construction()[0]).toMatchObject({ stageIndex: 0, progress: 0, complete: false, workers: [] });
  });

  // A two-building starter plan: the town-well opens on day one (no unmet
  // prerequisite), the market-hall waits on the well finishing — and the
  // builder mechanic that completes it lands later, so it stays queued here.
  const starterPlan: ExpansionPlan = ExpansionPlanSchema.parse(loadJson('../expansion/valid-starter-plan.json'));

  it('opens a planned site on day one and announces the groundbreaking', () => {
    const sim = new WorldSim({ charter, manifest, chunks, npcs, expansionPlan: starterPlan, ticksPerPhase: 600 });
    expect(sim.openSites()).toEqual([]); // nothing broken before the first tick
    const events: SimEvent[] = [];
    sim.onEvent((e) => e.type === 'expansion' && events.push(e));
    sim.tick();
    expect(events).toEqual([{ type: 'expansion', tick: 1, site: 'town-well', stage: 'marked plot' }]);
    expect(sim.openSites()).toEqual(['town-well']);
    // The market-hall waits on the well completing, which no mechanic reports yet.
    for (let i = 0; i < 100; i++) sim.tick();
    expect(sim.openSites()).toEqual(['town-well']);
  });

  it('a resumed world does not re-break ground already opened', () => {
    const resumed = new WorldSim({
      charter, manifest, chunks, npcs, expansionPlan: starterPlan, ticksPerPhase: 10, startTick: 100,
    });
    expect(resumed.openSites()).toEqual(['town-well']); // seeded from the resume day
    const events: SimEvent[] = [];
    resumed.onEvent((e) => e.type === 'expansion' && events.push(e));
    resumed.tick();
    expect(events).toEqual([]); // nothing re-announced
  });

  it('expansion is deterministic: two sims open sites identically', () => {
    const run = (): SimEvent[] => {
      const sim = new WorldSim({ charter, manifest, chunks, npcs, expansionPlan: starterPlan, ticksPerPhase: 50 });
      const events: SimEvent[] = [];
      sim.onEvent((e) => e.type === 'expansion' && events.push(e));
      for (let i = 0; i < 200; i++) sim.tick();
      return events;
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });

  // The closing of the loop (issue #96 wiring): a construction completion must
  // satisfy an expansion site_complete prerequisite. The first site sits on
  // Greta's oven with her role as builder, so her authored schedule raises it
  // (the construction suite proves this exact site finishes). The second site
  // is gated ONLY on the first completing — no day gate — so it can open no
  // sooner than the tick after construction reports the finish.
  const gatedPlan: ExpansionPlan = ExpansionPlanSchema.parse({
    schema_version: 1,
    id: 'gated-plan',
    queue: [
      {
        site: ConstructionSiteSchema.parse({ ...bakerySite, id: 'first-forge' }),
        prerequisites: [{ type: 'day', min_day: 1 }],
      },
      {
        site: ConstructionSiteSchema.parse({ ...bakerySite, id: 'second-hall', position: [12, 0, 4] }),
        prerequisites: [{ type: 'site_complete', site: 'first-forge' }],
      },
    ],
  });

  it('resolves a site_complete prerequisite from a real construction completion (issue #96)', () => {
    const forge = ConstructionSiteSchema.parse({ ...bakerySite, id: 'first-forge' });
    const run = (): { completedTick: number | null; hallOpenedTick: number | null; open: string[] } => {
      const sim = new WorldSim({
        charter, manifest, chunks, npcs, sites: [forge], expansionPlan: gatedPlan, ticksPerPhase: 600,
      });
      let completedTick: number | null = null;
      sim.onEvent((e) => {
        if (e.type === 'construction' && e.done && e.site === 'first-forge') completedTick = e.tick;
      });
      let hallOpenedTick: number | null = null;
      for (let i = 0; i < 60; i++) {
        const delta = sim.tick();
        // The hall stays queued until the forge finishes; record the exact tick
        // its ground first breaks (read straight from the sim's open set).
        if (hallOpenedTick === null && sim.openSites().includes('second-hall')) hallOpenedTick = delta.tick;
      }
      return { completedTick, hallOpenedTick, open: sim.openSites() };
    };

    const r = run();
    // Construction did finish the forge, and the hall opened exactly one tick
    // later — expansion runs before construction each tick, so the completion
    // is visible on the next day-granular step, never the same tick.
    expect(r.completedTick).not.toBeNull();
    expect(r.hallOpenedTick).toBe(r.completedTick! + 1);
    expect(r.open).toEqual(['first-forge', 'second-hall']);

    // Golden seed: the same charter + seed replays byte-identically.
    expect(JSON.stringify(run())).toEqual(JSON.stringify(r));
  });

  it('feeds an expansion-opened site into construction so builders raise it (issue #107)', () => {
    // One day-one entry and NO pre-placed `sites`: the ONLY path the
    // bakery-extension can reach the construction runtime is the reverse wire —
    // expansion opens it, WorldSim hands the opened def to construction, and
    // Greta (whose role matches and whose authored tree walks her onto the
    // plot) raises it stage by stage. This closes the flagship loop: a
    // plan-opened site is a workable site, not merely an announced one.
    const plan: ExpansionPlan = ExpansionPlanSchema.parse({
      schema_version: 1,
      id: 'reverse-wire-plan',
      queue: [{ site: bakerySite, prerequisites: [{ type: 'day', min_day: 1 }] }],
    });
    const run = (): { events: SimEvent[]; openedTick: number | null; state: unknown } => {
      const sim = new WorldSim({ charter, manifest, chunks, npcs, expansionPlan: plan, ticksPerPhase: 600 });
      // Nothing is under construction until the plan opens it — the site is not
      // pre-seeded, so this proves the opening itself makes it constructible.
      expect(sim.construction()).toEqual([]);
      const events: SimEvent[] = [];
      sim.onEvent((e) => (e.type === 'expansion' || e.type === 'construction') && events.push(e));
      let openedTick: number | null = null;
      for (let i = 0; i < 40; i++) {
        const delta = sim.tick();
        if (openedTick === null && sim.construction().some((s) => s.id === 'bakery-extension')) {
          openedTick = delta.tick;
        }
      }
      return { events, openedTick, state: sim.construction() };
    };

    const r = run();
    // Ground breaks on tick 1 (day-one prerequisite) and the site becomes a
    // live construction site that very tick.
    expect(r.openedTick).toBe(1);
    expect(r.events[0]).toEqual({ type: 'expansion', tick: 1, site: 'bakery-extension', stage: 'marked plot' });
    // Greta then raised it through every authored stage to completion — the
    // same ladder the pre-seeded-site test proves, reached purely via the plan.
    expect(
      r.events.filter((e) => e.type === 'construction').map((e) => (e.type === 'construction' ? e.text : '')),
    ).toEqual(['the bakery extension — foundation', 'the bakery extension — frame', 'the bakery extension is complete']);
    expect((r.state as { id: string; complete: boolean; stageIndex: number }[])[0]).toMatchObject({
      id: 'bakery-extension',
      complete: true,
      stageIndex: 3,
    });

    // Golden seed: the same charter + seed replays byte-identically.
    expect(JSON.stringify(run())).toEqual(JSON.stringify(r));
  });
});
