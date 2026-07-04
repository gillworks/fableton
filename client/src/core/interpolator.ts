// SPDX-License-Identifier: Apache-2.0
//
// Client-side interpolation between sim deltas (docs/architecture.md:
// slow ticks + interpolation). Pure TS, no three, no React — testable
// with plain numbers.
import type { ConstructionSiteState, SimMessage, WeatherState } from './types.js';

interface Track {
  from: [number, number, number];
  to: [number, number, number];
  arrivedAt: number;
  ry: number;
  activity: string;
  chunk: string;
}

export class SimState {
  #tracks = new Map<string, Track>();
  #intervalMs: number;
  #lastArrival = 0;
  clock = { tick: 0, phase: '', timeOfDay: 0 };
  weather: WeatherState | null = null;
  // Live construction sites keyed by id — the snapshot seeds them, deltas
  // climb their stages. Progress/workers here are last-known (the delta omits
  // them); the inspect panel polls /api/construction for fresh values.
  #sites = new Map<string, ConstructionSiteState>();
  #activityListeners: ((npc: string, activity: string) => void)[] = [];
  #phaseListeners: ((phase: string) => void)[] = [];
  #weatherListeners: ((weather: WeatherState) => void)[] = [];
  #siteListeners: ((sites: ConstructionSiteState[]) => void)[] = [];

  constructor(expectedIntervalMs = 500) {
    this.#intervalMs = expectedIntervalMs;
  }

  // Late subscribers get the current state replayed — the snapshot may
  // land before the render layer mounts.
  onActivity(cb: (npc: string, activity: string) => void): void {
    this.#activityListeners.push(cb);
    for (const [id, track] of this.#tracks) cb(id, track.activity);
  }
  onPhase(cb: (phase: string) => void): void {
    this.#phaseListeners.push(cb);
    if (this.clock.phase) cb(this.clock.phase);
  }
  onWeather(cb: (weather: WeatherState) => void): void {
    this.#weatherListeners.push(cb);
    if (this.weather) cb(this.weather);
  }
  // The scene subscribes to swap a site's mesh when its stage changes; the
  // current sites replay so a late mount still renders what's already up.
  onSites(cb: (sites: ConstructionSiteState[]) => void): void {
    this.#siteListeners.push(cb);
    if (this.#sites.size > 0) cb(this.sites());
  }
  #emitSites(): void {
    const sites = this.sites();
    for (const cb of this.#siteListeners) cb(sites);
  }

  /** Every tracked construction site, sorted by id for stable rendering. */
  sites(): ConstructionSiteState[] {
    return [...this.#sites.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  siteOf(id: string): ConstructionSiteState | undefined {
    return this.#sites.get(id);
  }

  npcIds(): string[] {
    return [...this.#tracks.keys()];
  }
  /** Whether a resident is currently tracked (has streamed in yet). */
  has(id: string): boolean {
    return this.#tracks.has(id);
  }
  activityOf(id: string): string {
    return this.#tracks.get(id)?.activity ?? '';
  }
  chunkOf(id: string): string {
    return this.#tracks.get(id)?.chunk ?? '';
  }
  headingOf(id: string): number {
    return this.#tracks.get(id)?.ry ?? 0;
  }

  /** Smoothed position at render time. */
  positionOf(id: string, nowMs: number): [number, number, number] {
    const track = this.#tracks.get(id);
    if (!track) return [0, 0, 0];
    const alpha = Math.min(1, Math.max(0, (nowMs - track.arrivedAt) / this.#intervalMs));
    return [
      track.from[0] + (track.to[0] - track.from[0]) * alpha,
      track.from[1] + (track.to[1] - track.from[1]) * alpha,
      track.from[2] + (track.to[2] - track.from[2]) * alpha,
    ];
  }

  apply(message: SimMessage, nowMs: number): void {
    // Adapt the lerp window to the observed broadcast cadence.
    if (this.#lastArrival > 0 && message.type === 'delta') {
      const gap = nowMs - this.#lastArrival;
      if (gap > 50 && gap < 5000) this.#intervalMs = this.#intervalMs * 0.7 + gap * 0.3;
    }
    this.#lastArrival = nowMs;

    if (message.type === 'snapshot') {
      this.clock = { tick: message.tick, phase: message.phase, timeOfDay: message.timeOfDay };
      if (message.weather) {
        this.weather = message.weather;
        for (const cb of this.#weatherListeners) cb(message.weather);
      }
      this.#tracks.clear();
      for (const npc of message.npcs) {
        this.#tracks.set(npc.id, {
          from: [...npc.pos],
          to: [...npc.pos],
          arrivedAt: nowMs,
          ry: npc.ry,
          activity: npc.activity,
          chunk: npc.chunk,
        });
        for (const cb of this.#activityListeners) cb(npc.id, npc.activity);
      }
      this.#sites.clear();
      for (const site of message.construction ?? []) this.#sites.set(site.id, { ...site });
      this.#emitSites();
      for (const cb of this.#phaseListeners) cb(message.phase);
      return;
    }

    this.clock.tick = message.tick;
    if (message.phase) {
      this.clock.phase = message.phase;
      for (const cb of this.#phaseListeners) cb(message.phase);
    }
    if (message.weather) {
      this.weather = message.weather;
      for (const cb of this.#weatherListeners) cb(message.weather);
    }
    for (const change of message.npcs) {
      const track = this.#tracks.get(change.id);
      if (!track) continue;
      if (change.pos) {
        track.from = this.positionOf(change.id, nowMs);
        track.to = [...change.pos];
        track.arrivedAt = nowMs;
      }
      if (change.ry !== undefined) track.ry = change.ry;
      if (change.activity !== undefined && change.activity !== track.activity) {
        track.activity = change.activity;
        for (const cb of this.#activityListeners) cb(change.id, change.activity);
      }
    }
    // A site climbed a stage (or finished): swap its mesh. The delta omits
    // progress/workers, so a new stage restarts the accrual bar at zero until
    // the inspect panel's next poll fills in the live figures.
    if (message.construction && message.construction.length > 0) {
      for (const change of message.construction) {
        const site = this.#sites.get(change.id);
        if (!site) continue;
        site.stage = change.stage;
        site.stageIndex = change.stageIndex;
        site.complete = change.done ?? change.stageIndex >= site.stageCount;
        site.progress = 0;
        if (site.complete) {
          site.required = 0;
          site.workers = [];
        }
      }
      this.#emitSites();
    }
  }
}

/** Wire SimState to the live socket; returns a disposer. */
export function connectSim(state: SimState, url: string): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  const open = (): void => {
    socket = new WebSocket(url);
    socket.onmessage = (event) => state.apply(JSON.parse(event.data as string), performance.now());
    socket.onclose = () => {
      if (!closed) setTimeout(open, 1000); // the world outlives a dropped socket
    };
  };
  open();
  return () => {
    closed = true;
    socket?.close();
  };
}
