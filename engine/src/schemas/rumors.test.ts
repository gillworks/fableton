// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RumorsDocSchema, type RumorsDoc } from './rumors.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(new URL('../../test/fixtures/sample-world/rumors.json', import.meta.url), 'utf8'),
  );

const valid = (): RumorsDoc => RumorsDocSchema.parse(load());
// A loosely-typed copy for building malformed inputs by spread/mutation.
const raw = (): Record<string, unknown> => load() as Record<string, unknown>;

describe('RumorsDocSchema', () => {
  it('accepts a valid rumors doc and round-trips (parse → serialize → parse)', () => {
    const doc = valid();
    expect(doc.rumors).toHaveLength(2);
    expect(doc.rumors[0]!.origin).toBe('greta-the-baker');
    expect(doc.rumors[0]!.notable).toBe(true);
    expect(RumorsDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('applies the documented defaults: radius, chance, and quiet-by-default', () => {
    const doc = RumorsDocSchema.parse({
      schema_version: 1,
      rumors: [{ id: 'a-whisper', text: 'someone left a light on in the mill', origin: 'greta-the-baker' }],
    });
    expect(doc.spread_radius).toBe(2.5);
    expect(doc.spread_chance).toBe(0.35);
    expect(doc.rumors[0]!.notable).toBe(false);
  });

  it('rejects a wrong schema_version', () => {
    expect(() => RumorsDocSchema.parse({ ...raw(), schema_version: 2 })).toThrow();
  });

  it('rejects duplicate rumor ids', () => {
    const doc = load() as RumorsDoc;
    doc.rumors[1]!.id = doc.rumors[0]!.id;
    expect(() => RumorsDocSchema.parse(doc)).toThrow(/duplicate rumor id/);
  });

  it('rejects an empty-string rumor text (a rumor that says nothing)', () => {
    const doc = load() as RumorsDoc;
    doc.rumors[0]!.text = '';
    expect(() => RumorsDocSchema.parse(doc)).toThrow();
  });

  it('rejects a non-slug id and an out-of-range spread_chance', () => {
    expect(() =>
      RumorsDocSchema.parse({ schema_version: 1, rumors: [{ id: 'Not A Slug', text: 'x', origin: 'greta-the-baker' }] }),
    ).toThrow();
    expect(() => RumorsDocSchema.parse({ ...raw(), spread_chance: 1.5 })).toThrow();
  });

  it('rejects unknown keys (strict document)', () => {
    expect(() => RumorsDocSchema.parse({ ...raw(), gossip_speed: 9 })).toThrow();
  });
});
