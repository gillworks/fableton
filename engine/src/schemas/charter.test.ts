// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { CharterSchema, type Charter } from './charter.js';

const fixture = (name: string): unknown =>
  parseYaml(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'));

const validCharter = (): Charter => CharterSchema.parse(fixture('charter-valid.yaml'));

describe('CharterSchema', () => {
  it('accepts a valid charter', () => {
    const charter = validCharter();
    expect(charter.identity.name).toBe('Cindervault');
    expect(charter.aesthetic.day_phases).toHaveLength(4);
    expect(charter.aesthetic.never).toContainEqual({ rule: 'modern technology', enforced: 'gate' });
  });

  it('round-trips: parse → serialize → parse is identity', () => {
    const charter = validCharter();
    const reparsed = CharterSchema.parse(JSON.parse(JSON.stringify(charter)));
    expect(reparsed).toEqual(charter);
  });

  it('rejects a day cycle that is not exactly 4 phases', () => {
    expect(() => CharterSchema.parse(fixture('charter-invalid-day-phases.yaml'))).toThrow(/day_phases/);
  });

  it('rejects a charter missing a section', () => {
    expect(() => CharterSchema.parse(fixture('charter-invalid-missing-tone.yaml'))).toThrow(/tone/);
  });

  it('rejects an enforcement channel outside gate|prompt', () => {
    expect(() => CharterSchema.parse(fixture('charter-invalid-enforced.yaml'))).toThrow(/enforced/);
  });

  it('rejects unknown keys (typo protection)', () => {
    const doc = validCharter() as Record<string, unknown>;
    expect(() => CharterSchema.parse({ ...doc, tabboos: [] })).toThrow(/tabboos/);
  });

  it('rejects seeds outside uint32 range', () => {
    const charter = validCharter();
    for (const seed of [-1, 2 ** 32, 1.5]) {
      expect(() =>
        CharterSchema.parse({ ...charter, identity: { ...charter.identity, seed } }),
      ).toThrow();
    }
  });

  it('defaults climate to a temperate four-season year when omitted', () => {
    const charter = validCharter(); // the fixture declares no climate
    expect(charter.climate.season_length_days).toBe(28);
    expect(charter.climate.seasons.map((s) => s.name)).toEqual([
      'spring',
      'summer',
      'autumn',
      'winter',
    ]);
    // Every weather condition carries a diegetic label (invariant 4).
    for (const season of charter.climate.seasons) {
      for (const condition of season.weather) expect(condition.label.length).toBeGreaterThan(0);
    }
  });

  it('accepts an authored climate and round-trips it', () => {
    const base = validCharter();
    const authored = CharterSchema.parse({
      ...base,
      climate: {
        season_length_days: 40,
        seasons: [
          {
            name: 'the long ember',
            weather: [
              { kind: 'clear', label: 'forge-bright and dry', weight: 6, intensity: 0 },
              { kind: 'fog', label: 'ash-smoke settling in the streets', weight: 2 },
            ],
          },
        ],
      },
    });
    expect(authored.climate.seasons[0]!.name).toBe('the long ember');
    // intensity defaults to 0.6 when the author omits it.
    expect(authored.climate.seasons[0]!.weather[1]!.intensity).toBe(0.6);
    const reparsed = CharterSchema.parse(JSON.parse(JSON.stringify(authored)));
    expect(reparsed).toEqual(authored);
  });

  it('rejects an unknown weather kind and an empty season table', () => {
    const base = validCharter();
    expect(() =>
      CharterSchema.parse({
        ...base,
        climate: {
          seasons: [{ name: 'drizzle', weather: [{ kind: 'hail', label: 'x', weight: 1 }] }],
        },
      }),
    ).toThrow();
    expect(() =>
      CharterSchema.parse({
        ...base,
        climate: { seasons: [{ name: 'void', weather: [] }] },
      }),
    ).toThrow();
  });

  it('defaults day_length_hours to 6 and accepts a founder-tuned value', () => {
    expect(validCharter().generation.day_length_hours).toBe(6);
    const charter = validCharter();
    const tuned = CharterSchema.parse({
      ...charter,
      generation: { ...charter.generation, day_length_hours: 24 },
    });
    expect(tuned.generation.day_length_hours).toBe(24);
    expect(() =>
      CharterSchema.parse({
        ...charter,
        generation: { ...charter.generation, day_length_hours: 0 },
      }),
    ).toThrow(/day_length_hours/);
  });
});
