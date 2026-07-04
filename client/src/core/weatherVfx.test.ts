// SPDX-License-Identifier: Apache-2.0
import { Points } from 'three';
import { describe, expect, it } from 'vitest';
import type { WeatherState } from './types.js';
import { MAX_WEATHER_PARTICLES, WeatherField, weatherVfx } from './weatherVfx.js';

const weather = (kind: WeatherState['kind'], intensity: number): WeatherState => ({
  season: 'test',
  kind,
  label: `${kind} test`,
  intensity,
});

describe('weatherVfx', () => {
  it('clear (or no weather) means clear air: no fog, no particles, no relight', () => {
    for (const w of [null, weather('clear', 0)]) {
      expect(weatherVfx(w)).toEqual({
        fogDensity: 0,
        particleKind: 'none',
        particleCount: 0,
        sunFactor: 1,
        ambientFactor: 1,
      });
    }
  });

  it('rain and snow fall; fog thickens the air without particles', () => {
    const rain = weatherVfx(weather('rain', 1));
    expect(rain.particleKind).toBe('rain');
    expect(rain.particleCount).toBeGreaterThan(0);
    expect(rain.sunFactor).toBeLessThan(1); // overcast dims the sun

    const snow = weatherVfx(weather('snow', 1));
    expect(snow.particleKind).toBe('snow');
    expect(snow.particleCount).toBeGreaterThan(0);

    const fog = weatherVfx(weather('fog', 1));
    expect(fog.particleKind).toBe('none');
    expect(fog.particleCount).toBe(0);
    expect(fog.fogDensity).toBeGreaterThan(rain.fogDensity);
  });

  it('intensity scales the particle count and never exceeds the cap', () => {
    expect(weatherVfx(weather('rain', 0.5)).particleCount).toBeLessThan(
      weatherVfx(weather('rain', 1)).particleCount,
    );
    for (const i of [0.1, 0.5, 1, 2]) {
      expect(weatherVfx(weather('rain', i)).particleCount).toBeLessThanOrEqual(MAX_WEATHER_PARTICLES);
      expect(weatherVfx(weather('snow', i)).particleCount).toBeLessThanOrEqual(MAX_WEATHER_PARTICLES);
    }
  });
});

describe('WeatherField', () => {
  it('is a single Points object — one draw call, whatever the weather', () => {
    const field = new WeatherField();
    expect(field.points).toBeInstanceOf(Points);
    expect(field.drawCalls()).toBe(1);
    field.dispose();
  });

  it('shows only when something is falling, and never draws more than the cap', () => {
    const field = new WeatherField();
    field.update(0.016, weatherVfx(weather('clear', 0)), [0, 0, 0]);
    expect(field.points.visible).toBe(false);

    field.update(0.016, weatherVfx(weather('rain', 1)), [3, 0, 5]);
    expect(field.points.visible).toBe(true);
    const range = field.points.geometry.drawRange;
    expect(range.count).toBeLessThanOrEqual(MAX_WEATHER_PARTICLES);
    expect(range.count).toBeGreaterThan(0);
    // The field tracks the viewer so precipitation always surrounds them.
    expect([field.points.position.x, field.points.position.z]).toEqual([3, 5]);
    field.dispose();
  });

  it('particles fall over time and recycle at the top', () => {
    const field = new WeatherField();
    const vfx = weatherVfx(weather('rain', 1));
    field.update(0.016, vfx, [0, 0, 0]);
    const before = (field.points.geometry.getAttribute('position').array as Float32Array).slice(0, 3);
    for (let i = 0; i < 30; i++) field.update(0.016, vfx, [0, 0, 0]);
    const after = field.points.geometry.getAttribute('position').array as Float32Array;
    // The first particle's height changed — the field is animating.
    expect(after[1]).not.toBe(before[1]);
    field.dispose();
  });
});
