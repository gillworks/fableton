// SPDX-License-Identifier: Apache-2.0
//
// Client-side interpolation between sim deltas (docs/architecture.md:
// slow ticks + interpolation). Pure TS, no three, no React — testable
// with plain numbers.
import type { SimMessage, WeatherState } from './types.js';

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
  #activityListeners: ((npc: string, activity: string) => void)[] = [];
  #phaseListeners: ((phase: string) => void)[] = [];
  #weatherListeners: ((weather: WeatherState) => void)[] = [];

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
