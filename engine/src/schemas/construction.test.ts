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

  it('rising stages (issue #117): rise renders the completion buildings mid-build', () => {
    const doc = validSite() as unknown as Record<string, unknown>;
    const stages = [
      { name: 'marked plot', asset: 'lantern', work_units: 4 },
      { name: 'walls waist-high', rise: 0.4, work_units: 20 },
      { name: 'walls to the eaves', rise: 0.95, work_units: 20 },
    ];
    const site = ConstructionSiteSchema.parse({ ...doc, stages });
    expect(site.stages[1]).toMatchObject({ rise: 0.4 });
    expect(site.stages[1]!.asset).toBeUndefined();
    // round-trips
    expect(ConstructionSiteSchema.parse(JSON.parse(JSON.stringify(site)))).toEqual(site);
  });

  it('rejects a stage with both asset and rise, or neither', () => {
    const doc = validSite() as unknown as Record<string, unknown>;
    for (const stage of [
      { name: 'confused', asset: 'lantern', rise: 0.5, work_units: 4 },
      { name: 'invisible', work_units: 4 },
    ]) {
      expect(() => ConstructionSiteSchema.parse({ ...doc, stages: [stage] })).toThrow(
        /exactly one of/,
      );
    }
  });

  it('rejects rise outside (0, 1] ', () => {
    const doc = validSite() as unknown as Record<string, unknown>;
    for (const rise of [0, -0.2, 1.4]) {
      expect(() =>
        ConstructionSiteSchema.parse({ ...doc, stages: [{ name: 'x', rise, work_units: 1 }] }),
      ).toThrow();
    }
  });

  it('rejects a rise stage when the completion has no buildings to raise', () => {
    const doc = validSite() as unknown as Record<string, unknown>;
    const completion = { buildings: [], props: (doc['completion'] as { props: unknown[] }).props ?? [] };
    expect(() =>
      ConstructionSiteSchema.parse({
        ...doc,
        completion: { ...completion, props: [{ asset: 'tree', position: [1, 0, 1], rotation_y: 0, scale: 1 }] },
        stages: [{ name: 'rising from nothing', rise: 0.5, work_units: 2 }],
      }),
    ).toThrow(/no buildings to raise/);
  });

  it('rejects a non-slug id', () => {
    expect(() => ConstructionSiteSchema.parse({ ...validSite(), id: 'Bakery Extension' })).toThrow();
  });
});
