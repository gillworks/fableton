// SPDX-License-Identifier: Apache-2.0
//
// Weather → atmosphere. Pure params (weatherVfx) and a single-draw-call
// particle field (WeatherField) live here, not in the R3F layer (ADR-0002).
// The whole precipitation field is ONE Points object — a fixed cap of
// particles, one draw call, however hard it rains — so weather VFX never
// threatens the charter draw-call budget the CI gate holds.
import {
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  type Vector3Tuple,
} from 'three';
import type { WeatherState } from './types.js';

export interface WeatherVfx {
  /** Scene FogExp2 density; 0 = clear air. Weather thickens the haze. */
  fogDensity: number;
  /** What falls, if anything. */
  particleKind: 'none' | 'rain' | 'snow';
  /** Active particle count — capped, and one draw call regardless. */
  particleCount: number;
  /** Multiplies the phase's sun intensity (overcast dims the sun). */
  sunFactor: number;
  /** Multiplies the phase's ambient (fog/snow scatter light, flat shadow). */
  ambientFactor: number;
}

// The field is one Points object; this bounds its buffer, not the budget.
export const MAX_WEATHER_PARTICLES = 1200;

const CLEAR: WeatherVfx = {
  fogDensity: 0,
  particleKind: 'none',
  particleCount: 0,
  sunFactor: 1,
  ambientFactor: 1,
};

/**
 * The render parameters for a weather state. Intensity (0..1, from the
 * charter's weather condition) scales fog thickness, particle density, and
 * how far the scene relights toward overcast. Pure and side-effect free.
 */
export function weatherVfx(weather: WeatherState | null): WeatherVfx {
  if (!weather || weather.kind === 'clear') return CLEAR;
  const i = Math.min(1, Math.max(0, weather.intensity));
  switch (weather.kind) {
    case 'rain':
      return {
        fogDensity: 0.012 * i,
        particleKind: 'rain',
        particleCount: Math.round(MAX_WEATHER_PARTICLES * i),
        sunFactor: 1 - 0.55 * i,
        ambientFactor: 1 - 0.12 * i,
      };
    case 'snow':
      return {
        fogDensity: 0.01 * i,
        particleKind: 'snow',
        particleCount: Math.round(MAX_WEATHER_PARTICLES * 0.8 * i),
        sunFactor: 1 - 0.3 * i,
        ambientFactor: 1 + 0.12 * i,
      };
    case 'fog':
      return {
        fogDensity: 0.02 + 0.06 * i,
        particleKind: 'none',
        particleCount: 0,
        sunFactor: 1 - 0.45 * i,
        ambientFactor: 1 + 0.2 * i,
      };
    default:
      return CLEAR;
  }
}

const FIELD = 70; // horizontal span the field blankets, world units
const TOP = 45; // spawn ceiling

/**
 * A falling-precipitation field: one Points object, `max` particles, that
 * follows the camera and recycles particles as they hit the floor. Rain
 * falls fast and thin; snow drifts slow and wide. The rendering layer calls
 * update() each frame; drawCalls() is 1 by construction.
 */
export class WeatherField {
  readonly points: Points;
  #geometry: BufferGeometry;
  #material: PointsMaterial;
  #positions: Float32Array;
  #speeds: Float32Array;
  #kind: 'none' | 'rain' | 'snow' = 'none';
  #rng: () => number;

  constructor(max = MAX_WEATHER_PARTICLES) {
    // A tiny deterministic PRNG so the scatter is stable across reloads —
    // the client isn't bound by the sim's determinism invariant, but a
    // fixed field reads calmer than a reshuffled one every mount.
    let s = 0x9e3779b9 >>> 0;
    this.#rng = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.#positions = new Float32Array(max * 3);
    this.#speeds = new Float32Array(max);
    for (let i = 0; i < max; i++) this.#respawn(i, this.#rng() * TOP);
    this.#geometry = new BufferGeometry();
    this.#geometry.setAttribute('position', new BufferAttribute(this.#positions, 3));
    this.#geometry.setDrawRange(0, 0);
    this.#material = new PointsMaterial({
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.points = new Points(this.#geometry, this.#material);
    // The field moves with the camera; culling its fixed box hides it.
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  #respawn(i: number, y: number): void {
    const p = this.#positions;
    p[i * 3] = (this.#rng() - 0.5) * FIELD;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = (this.#rng() - 0.5) * FIELD;
    this.#speeds[i] = 0.6 + this.#rng() * 0.8;
  }

  /** The whole field is one Points object — one draw call, always. */
  drawCalls(): number {
    return 1;
  }

  /** Advance and re-style the field for the current weather. */
  update(dt: number, vfx: WeatherVfx, center: Vector3Tuple): void {
    if (vfx.particleKind === 'none' || vfx.particleCount === 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    this.points.position.set(center[0], 0, center[2]);
    const max = this.#positions.length / 3;
    const count = Math.min(max, Math.max(0, Math.floor(vfx.particleCount)));
    this.#geometry.setDrawRange(0, count);

    const rainy = vfx.particleKind === 'rain';
    if (vfx.particleKind !== this.#kind) {
      this.#kind = vfx.particleKind;
      this.#material.size = rainy ? 0.09 : 0.22;
      this.#material.opacity = rainy ? 0.55 : 0.9;
      this.#material.color.set(rainy ? '#9fb4c8' : '#f4f6fb');
    }

    const fall = (rainy ? 18 : 3) * dt;
    const p = this.#positions;
    for (let i = 0; i < count; i++) {
      const b = i * 3;
      const y = p[b + 1]! - fall * this.#speeds[i]!;
      if (y < 0) {
        this.#respawn(i, TOP + this.#rng() * 8);
        continue;
      }
      p[b + 1] = y;
      if (!rainy) p[b] = p[b]! + Math.sin(y * 0.5) * 0.6 * dt; // snow sways
    }
    const attr = this.#geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
