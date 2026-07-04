// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConstructionSiteSchema, type ConstructionSite } from './construction.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/construction/valid-bakery-extension.json', import.meta.url),
      'utf8',
    ),
  );

const validSite = (): ConstructionSite => ConstructionSiteSchema.parse(load());

describe('ConstructionSiteSchema', () => {
  it('accepts a valid site and round-trips (parse → serialize → parse)', () => {
    const site = validSite();
    expect(site.id).toBe('bakery-extension');
    expect(site.stages.map((s) => s.name)).toEqual([
      'marked plot',
      'foundation',
      'timber frame',
      'raising day',
    ]);
    expect(site.completion.buildings).toHaveLength(1);
    expect(ConstructionSiteSchema.parse(JSON.parse(JSON.stringify(site)))).toEqual(site);
  });

  it('defaults rotation_y and the completion prop list', () => {
    const raw = load() as Record<string, unknown>;
    delete raw['rotation_y'];
    delete (raw['completion'] as Record<string, unknown>)['props'];
    const site = ConstructionSiteSchema.parse(raw);
    expect(site.rotation_y).toBe(0);
    expect(site.completion.props).toEqual([]);
  });

  it('rejects an unknown schema_version', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), schema_version: 99 })).toThrow();
  });

  it('rejects a site with no stages (must climb at least one)', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), stages: [] })).toThrow();
  });

  it('rejects a non-positive or non-integer work_units', () => {
    const site = validSite();
    expect(() =>
      ConstructionSiteSchema.parse({
        ...site,
        stages: [{ name: 'marked plot', asset: 'lantern', work_units: 0 }],
      }),
    ).toThrow();
    expect(() =>
      ConstructionSiteSchema.parse({
        ...site,
        stages: [{ name: 'marked plot', asset: 'lantern', work_units: 2.5 }],
      }),
    ).toThrow();
  });

  it('rejects duplicate stage names — the ladder must read unambiguously', () => {
    const site = validSite();
    expect(() =>
      ConstructionSiteSchema.parse({
        ...site,
        stages: [
          { name: 'foundation', asset: 'lantern', work_units: 4 },
          { name: 'Foundation', asset: 'cart', work_units: 8 },
        ],
      }),
    ).toThrow(/duplicate stage name/);
  });

  it('rejects a site with no builder roles', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), builder_roles: [] })).toThrow();
  });

  it('rejects an empty completion payload — a finished site must become something', () => {
    expect(() =>
      ConstructionSiteSchema.parse({
        ...validSite(),
        completion: { buildings: [], props: [] },
      }),
    ).toThrow(/completion payload is empty/);
  });

  it('rejects an unknown extra key (strict object)', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), height_m: 12 })).toThrow();
  });

  it('rejects a non-slug id', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), id: 'Bakery Extension' })).toThrow();
  });
});
