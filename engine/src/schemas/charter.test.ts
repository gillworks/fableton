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

  it('parses the town-events calendar, defaulting cadence offset and phases', () => {
    const charter = validCharter();
    expect(charter.calendar.events.map((e) => e.name)).toEqual(['Coal Market', 'Emberwake']);
    const market = charter.calendar.events[0]!;
    expect(market.cadence).toEqual({ every_days: 3, offset_days: 0 }); // offset defaults to 0
    expect(market.phases).toEqual(['forge-day']);
    const emberwake = charter.calendar.events[1]!;
    expect(emberwake.cadence).toEqual({ every_days: 7, offset_days: 2 });
    expect(emberwake.phases).toEqual([]); // omitted phases mean all day
  });

  it('defaults calendar to an empty event list when omitted', () => {
    const doc = validCharter() as Record<string, unknown>;
    delete doc['calendar'];
    expect(CharterSchema.parse(doc).calendar).toEqual({ events: [] });
  });

  it('rejects a calendar cadence that never recurs', () => {
    const charter = validCharter();
    expect(() =>
      CharterSchema.parse({
        ...charter,
        calendar: { events: [{ name: 'Never Day', cadence: { every_days: 0 } }] },
      }),
    ).toThrow(/every_days/);
  });

  it('rejects unknown keys on a calendar event (typo protection)', () => {
    const charter = validCharter();
    expect(() =>
      CharterSchema.parse({
        ...charter,
        calendar: { events: [{ name: 'Typo Fest', cadence: { every_days: 2 }, phase: ['x'] }] },
      }),
    ).toThrow(/phase/);
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
