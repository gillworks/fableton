// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { CharterSchema, type Charter } from '../schemas/charter.js';
import { weatherAt } from './weather.js';

const baseCharter = (): Charter =>
  CharterSchema.parse(
    parseYaml(readFileSync(new URL('../../test/fixtures/charter-valid.yaml', import.meta.url), 'utf8')),
  );

// A charter whose climate is a single deterministic condition — lets a test
// assert exact weather without reasoning about the weighted draw.
const withClimate = (charter: Charter, climate: Charter['climate']): Charter => ({
  ...charter,
  climate,
});

describe('weatherAt', () => {
  it('is deterministic: same charter + day ⇒ identical weather, every call', () => {
    const charter = baseCharter();
    for (const day of [1, 2, 37, 500]) {
      expect(weatherAt(charter, day)).toEqual(weatherAt(charter, day));
    }
    // A fresh parse of the same charter (a "second machine") agrees.
    expect(weatherAt(baseCharter(), 42)).toEqual(weatherAt(charter, 42));
  });

  it('cycles seasons in charter order every season_length_days', () => {
    const charter = baseCharter(); // temperate default: 28-day seasons, 4 seasons
    expect(weatherAt(charter, 1).season).toBe('spring');
    expect(weatherAt(charter, 28).season).toBe('spring');
    expect(weatherAt(charter, 29).season).toBe('summer');
    expect(weatherAt(charter, 57).season).toBe('autumn');
    expect(weatherAt(charter, 85).season).toBe('winter');
    // Wraps back around after a full year.
    expect(weatherAt(charter, 113).season).toBe('spring');
  });

  it('honours a single-condition climate exactly', () => {
    const charter = withClimate(baseCharter(), {
      season_length_days: 10,
      seasons: [
        { name: 'the long grey', weather: [{ kind: 'fog', label: 'an endless fog', weight: 1, intensity: 0.9 }] },
      ],
    });
    for (const day of [1, 5, 999]) {
      expect(weatherAt(charter, day)).toEqual({
        season: 'the long grey',
        kind: 'fog',
        label: 'an endless fog',
        intensity: 0.9,
      });
    }
  });

  it('climate is DATA: different charters produce visibly different weather', () => {
    const days = Array.from({ length: 200 }, (_, i) => i + 1);
    const arid = withClimate(baseCharter(), {
      season_length_days: 30,
      seasons: [
        {
          name: 'the dry',
          weather: [
            { kind: 'clear', label: 'blistering clear sky', weight: 9, intensity: 0 },
            { kind: 'fog', label: 'a rare dawn haze', weight: 1, intensity: 0.3 },
          ],
        },
      ],
    });
    const frozen = withClimate(baseCharter(), {
      season_length_days: 30,
      seasons: [
        {
          name: 'the white',
          weather: [
            { kind: 'snow', label: 'ceaseless snow', weight: 8, intensity: 0.8 },
            { kind: 'clear', label: 'a brittle clear day', weight: 2, intensity: 0 },
          ],
        },
      ],
    });
    const kinds = (c: Charter): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const d of days) counts[weatherAt(c, d).kind] = (counts[weatherAt(c, d).kind] ?? 0) + 1;
      return counts;
    };
    const aridKinds = kinds(arid);
    const frozenKinds = kinds(frozen);
    // The arid world is mostly clear and never snows; the frozen world is
    // mostly snow and never fogs. Two charters, two visibly different skies.
    expect(aridKinds['snow']).toBeUndefined();
    expect(aridKinds['clear']!).toBeGreaterThan(aridKinds['fog'] ?? 0);
    expect(frozenKinds['fog']).toBeUndefined();
    expect(frozenKinds['snow']!).toBeGreaterThan(frozenKinds['clear'] ?? 0);
  });

  it('clamps non-positive days to day 1 (a freshly founded world)', () => {
    const charter = baseCharter();
    expect(weatherAt(charter, 0)).toEqual(weatherAt(charter, 1));
    expect(weatherAt(charter, -5)).toEqual(weatherAt(charter, 1));
  });
});
