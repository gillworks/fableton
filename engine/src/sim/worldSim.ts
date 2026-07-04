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
import type { ConstructionSite } from '../schemas/construction.js';
import { activeEvent } from './calendar.js';
import { TICK_HZ, clockAt, ticksPerPhaseFor, type ClockState } from './clock.js';
import { ConstructionRuntime, type ConstructionSiteState } from './constructionRuntime.js';
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
  /** Live construction sites: stage, progress, and current workers. */
  construction: ConstructionSiteState[];
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
  /** Present only on ticks a site changes stage or completes — compact by
   *  construction, so per-tick work accrual never rides the wire. */
  construction?: ConstructionDelta[];
}

export interface ConstructionDelta {
  /** Site id. */
  id: string;
  /** Diegetic name of the stage now shown. */
  stage: string;
  /** New stage index; equals the stage count when the site is complete. */
  stageIndex: number;
  /** Present and true only on the tick the site finishes. */
  done?: boolean;
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
  // A construction site climbed a stage (or finished) this tick — the
  // chronicle's "the bakery's frame went up" line. `text` is the diegetic
  // line; `done` marks the tick the building stands.
  | { type: 'construction'; tick: number; site: string; stage: string; stageIndex: number; done: boolean; text: string };

export interface WorldSimOptions {
  charter: Charter;
  manifest: WorldManifest;
  chunks: Chunk[];
  npcs: Npc[];
  /** Rumors this world seeds (world-DATA). Absent means a quiet town. */
  rumors?: RumorsDoc;
  /** Construction sites this world seeds (world-DATA). Absent means nothing
   *  is being built. */
  sites?: ConstructionSite[];
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
  #construction: ConstructionRuntime;
  #listeners: ((event: SimEvent) => void)[] = [];
  #lastSent = new Map<string, { pos: string; ry: number; activity: string }>();
  #lastPhase: string;
  #weather: WeatherState;
  #calendar: Charter['calendar'];
  #lastEvent: string | null;

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
    this.#construction = new ConstructionRuntime(
      options.sites ?? [],
      originOf,
      new Map(options.npcs.map((n) => [n.id, n.identity.kind])),
      options.charter.identity.seed,
    );
    this.#lastPhase = this.clock().phase;
    this.#weather = weatherAt(this.#charter, this.clock().day);
    // Seed from the resume tick so a redeploy mid-festival doesn't re-announce
    // an event already underway (issue #57).
    this.#lastEvent = activeEvent(this.#calendar, this.clock())?.name ?? null;
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
      construction: this.#construction.state(),
    };
  }

  /** Every construction site's live stage, progress, and current workers —
   *  the inspect panel's source, exposed read-only by world-api. */
  construction(): ConstructionSiteState[] {
    return this.#construction.state();
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
    // Construction reads the same positions the trees just produced: a site
    // advances only while eligible builders stand on it. Stage transitions
    // ride the delta (compact — only on the tick they happen) and reach the
    // chronicle.
    for (const t of this.#construction.step(clock.tick, positions)) {
      (delta.construction ??= []).push({
        id: t.site,
        stage: t.stage,
        stageIndex: t.stageIndex,
        ...(t.done && { done: true }),
      });
      this.#emit({
        type: 'construction',
        tick: clock.tick,
        site: t.site,
        stage: t.stage,
        stageIndex: t.stageIndex,
        done: t.done,
        text: t.text,
      });
    }
    return delta;
  }

  /** What a resident has heard, and from whom — the inspect panel's source. */
  heard(npcId: string): Heard[] {
    return this.#gossip.heardBy(npcId);
  }
}
