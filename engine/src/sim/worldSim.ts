// SPDX-License-Identifier: Apache-2.0
//
// The authoritative simulation core: pure and deterministic — state is a
// function of (world data, charter, tick count) only. I/O lives in
// server.ts. Deltas are compact by construction: only changed NPCs, only
// changed fields.
//
// Per-tick byte budget (held by tests): a serialized delta is at most
// 64 bytes of envelope + 120 bytes per NPC that changed this tick.
// For the sample world (3 NPCs) that is ≤ 424 bytes/tick, well inside a
// 1–5 Hz broadcast to thousands of clients.
import type { Charter } from '../schemas/charter.js';
import type { Chunk } from '../schemas/chunk.js';
import type { WorldManifest } from '../schemas/manifest.js';
import type { Npc } from '../schemas/npc.js';
import { EMPTY_RUMORS, type RumorsDoc } from '../schemas/rumors.js';
import type { ExpansionPlan } from '../schemas/expansion.js';
import { activeEvent } from './calendar.js';
import { TICK_HZ, clockAt, ticksPerPhaseFor, type ClockState } from './clock.js';
import { ExpansionRuntime } from './expansionRuntime.js';
import { GossipRuntime, type Heard } from './gossipRuntime.js';
import { NpcRuntime, type NpcState } from './npcRuntime.js';
import { weatherAt, type WeatherState } from './weather.js';

export const DELTA_ENVELOPE_BUDGET = 64;
export const DELTA_PER_NPC_BUDGET = 120;

export interface Snapshot {
  type: 'snapshot';
  tick: number;
  phase: string;
  timeOfDay: number;
  weather: WeatherState;
  npcs: NpcState[];
}

export interface NpcDelta {
  id: string;
  pos?: [number, number, number];
  ry?: number;
  activity?: string;
}

export interface Delta {
  type: 'delta';
  tick: number;
  phase?: string;
  /** Present only on the tick the weather turns (a new world day). */
  weather?: WeatherState;
  npcs: NpcDelta[];
}

export type SimEvent =
  | { type: 'phase'; tick: number; phase: string }
  | { type: 'weather'; tick: number; weather: WeatherState }
  | { type: 'event'; tick: number; event: string }
  | { type: 'activity'; tick: number; npc: string; activity: string }
  // A notable rumor jumped from one resident to another this tick — the
  // chronicle's "who told Greta?" line. Quiet rumors still spread (the
  // inspect panel shows them) but don't emit, keeping the chronicle sparse.
  | { type: 'rumor'; tick: number; from: string; to: string; rumor: string; text: string }
  // Ground broke on a planned building: its prerequisites came true and the
  // expansion runtime opened the site (issue #95). `stage` is the site's first
  // stage name, read verbatim by the chronicle ("marked plot on the town-well").
  | { type: 'expansion'; tick: number; site: string; stage: string };

export interface WorldSimOptions {
  charter: Charter;
  manifest: WorldManifest;
  chunks: Chunk[];
  npcs: Npc[];
  /** Rumors this world seeds (world-DATA). Absent means a quiet town. */
  rumors?: RumorsDoc;
  /**
   * The town's expansion plan (world-DATA, issue #95): an ordered queue of
   * buildings the sim opens as prerequisites come true. Absent means a town
   * that grows no further than it was born.
   */
  expansionPlan?: ExpansionPlan;
  /** Overrides the charter-derived pace (tests shrink it). */
  ticksPerPhase?: number;
  /**
   * Tick to resume from — the server layer derives it from the manifest's
   * founded_at and the wall clock (issue #57), so a redeployed world picks
   * up on the same day and phase. Default 0 (a freshly founded world).
   */
  startTick?: number;
}

export class WorldSim {
  #tick = 0;
  #charter: Charter;
  #phases: readonly string[];
  #ticksPerPhase: number;
  #runtimes: NpcRuntime[];
  #gossip: GossipRuntime;
  #listeners: ((event: SimEvent) => void)[] = [];
  #lastSent = new Map<string, { pos: string; ry: number; activity: string }>();
  #lastPhase: string;
  #weather: WeatherState;
  #calendar: Charter['calendar'];
  #lastEvent: string | null;
  #expansion: ExpansionRuntime | undefined;
  // Sites the sim has seen finished. Empty until the builder mechanic that
  // spends work_units lands (a later issue); expansion prerequisites of type
  // site_complete read from here, so they simply wait until then.
  #completedSites = new Set<string>();

  constructor(options: WorldSimOptions) {
    this.#charter = options.charter;
    this.#phases = options.charter.aesthetic.day_phases;
    this.#calendar = options.charter.calendar;
    this.#ticksPerPhase =
      options.ticksPerPhase ??
      ticksPerPhaseFor(options.charter.generation.day_length_hours, this.#phases.length);
    this.#tick = options.startTick ?? 0;
    const originOf = new Map(options.manifest.chunks.map((c) => [c.id, c.origin]));
    // Sorted so runtime order (and therefore delta order) is stable.
    this.#runtimes = [...options.npcs]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((npc) => {
        const chunk = options.chunks.find((c) => c.npcs.includes(npc.id));
        if (!chunk) throw new Error(`npc "${npc.id}" is not placed in any chunk`);
        return new NpcRuntime(npc, chunk, originOf.get(chunk.id)!, options.charter.identity.seed);
      });
    this.#gossip = new GossipRuntime(
      options.rumors ?? EMPTY_RUMORS,
      this.#runtimes.map((r) => r.state.id),
      options.charter.identity.seed,
    );
    this.#lastPhase = this.clock().phase;
    this.#weather = weatherAt(this.#charter, this.clock().day);
    // Seed from the resume tick so a redeploy mid-festival doesn't re-announce
    // an event already underway (issue #57).
    this.#lastEvent = activeEvent(this.#calendar, this.clock())?.name ?? null;
    // Same for the expansion plan. On a RESUME (startTick > 0) seed the sites
    // whose prerequisites came true on an earlier run so a redeploy doesn't
    // re-break ground; a freshly founded world (tick 0) leaves them to open on
    // its own ticks, so the chronicle records the first day's groundbreaking.
    if (options.expansionPlan) {
      this.#expansion = new ExpansionRuntime(options.expansionPlan);
      if (this.#tick > 0) this.#expansion.seed(this.clock().day, this.#completedSites);
    }
  }

  clock(): ClockState {
    return clockAt(this.#tick, this.#phases, this.#ticksPerPhase);
  }

  /** The current weather — a pure function of the charter and world day. */
  weather(): WeatherState {
    return this.#weather;
  }

  /** The town event in effect right now, or null on an ordinary day. Drives
   *  the HUD's "Today: <event>" line and behavior-tree event context. */
  event(): string | null {
    return activeEvent(this.#calendar, this.clock())?.name ?? null;
  }

  /** Planned sites whose ground has broken (open for construction), in plan
   *  order. Empty for a town with no expansion plan. */
  openSites(): string[] {
    return this.#expansion?.openSites() ?? [];
  }

  /** How fast world time moves: one full day in sim ticks and real seconds. */
  pace(): { ticks_per_day: number; seconds_per_day: number } {
    const ticks = this.#ticksPerPhase * this.#phases.length;
    return { ticks_per_day: ticks, seconds_per_day: ticks / TICK_HZ };
  }

  onEvent(listener: (event: SimEvent) => void): void {
    this.#listeners.push(listener);
  }

  #emit(event: SimEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  snapshot(): Snapshot {
    const clock = this.clock();
    return {
      type: 'snapshot',
      tick: clock.tick,
      phase: clock.phase,
      timeOfDay: clock.timeOfDay,
      weather: this.#weather,
      npcs: this.#runtimes.map((r) => ({ ...r.state, pos: [...r.state.pos] as [number, number, number] })),
    };
  }

  /**
   * Hot-swap an NPC's behavior tree (the L1 seam — world-api calls this).
   * Takes effect on the next tick, no restart. Returns false if unknown.
   */
  updateBehavior(npcId: string, behavior: import('../schemas/behavior.js').BehaviorNode): boolean {
    const runtime = this.#runtimes.find((r) => r.state.id === npcId);
    if (!runtime) return false;
    runtime.replaceTree(behavior);
    return true;
  }

  /** Advance one tick; returns the compact delta to broadcast. */
  tick(): Delta {
    this.#tick += 1;
    const clock = this.clock();
    const delta: Delta = { type: 'delta', tick: clock.tick, npcs: [] };
    if (clock.phase !== this.#lastPhase) {
      this.#lastPhase = clock.phase;
      delta.phase = clock.phase;
      this.#emit({ type: 'phase', tick: clock.tick, phase: clock.phase });
    }
    // Weather turns on day boundaries. Recompute every tick (a cheap
    // weighted draw) and broadcast only when it actually changes — like
    // phase, it rides the delta and fires an event.
    const weather = weatherAt(this.#charter, clock.day);
    const prev = this.#weather;
    if (
      weather.kind !== prev.kind ||
      weather.label !== prev.label ||
      weather.season !== prev.season ||
      weather.intensity !== prev.intensity
    ) {
      this.#weather = weather;
      delta.weather = weather;
      this.#emit({ type: 'weather', tick: clock.tick, weather });
    }
    // The town event in effect this tick: behavior context for the runtimes,
    // and a chronicle occurrence when a new one comes into effect.
    const eventName = activeEvent(this.#calendar, clock)?.name ?? null;
    if (eventName !== this.#lastEvent) {
      this.#lastEvent = eventName;
      if (eventName !== null) this.#emit({ type: 'event', tick: clock.tick, event: eventName });
    }
    // The town grows: open any planned site whose prerequisites came true this
    // tick (a new day reached, or a dependency finished). Pure and day-granular
    // — the runtime opens each site once and rides no RNG.
    if (this.#expansion) {
      for (const opened of this.#expansion.step(clock.day, this.#completedSites)) {
        this.#emit({ type: 'expansion', tick: clock.tick, site: opened.site, stage: opened.stage });
      }
    }
    for (const runtime of this.#runtimes) {
      const state = runtime.step({ phase: clock.phase, event: eventName, weather: this.#weather.kind });
      const posKey = state.pos.join(',');
      const last = this.#lastSent.get(state.id);
      const entry: NpcDelta = { id: state.id };
      if (!last || last.pos !== posKey) entry.pos = [...state.pos] as [number, number, number];
      if (!last || last.ry !== state.ry) entry.ry = state.ry;
      if (!last || last.activity !== state.activity) {
        entry.activity = state.activity;
        this.#emit({ type: 'activity', tick: clock.tick, npc: state.id, activity: state.activity });
      }
      if (entry.pos || entry.ry !== undefined || entry.activity !== undefined) {
        delta.npcs.push(entry);
        this.#lastSent.set(state.id, { pos: posKey, ry: state.ry, activity: state.activity });
      }
    }
    // Rumors ride on top of the movement the trees produced: where residents
    // ended up this tick decides who overhears whom. Notable jumps reach the
    // chronicle; the delta itself stays position-only (byte budget unchanged).
    const positions = new Map(this.#runtimes.map((r) => [r.state.id, r.state.pos] as const));
    for (const spread of this.#gossip.step(clock.tick, positions)) {
      if (spread.notable) {
        this.#emit({
          type: 'rumor',
          tick: clock.tick,
          from: spread.from,
          to: spread.to,
          rumor: spread.rumor,
          text: spread.text,
        });
      }
    }
    return delta;
  }

  /** What a resident has heard, and from whom — the inspect panel's source. */
  heard(npcId: string): Heard[] {
    return this.#gossip.heardBy(npcId);
  }
}
