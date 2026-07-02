// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AssetRegistrySchema, type AssetRegistry } from './assets.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(new URL('../../test/fixtures/sample-world/assets.json', import.meta.url), 'utf8'),
  );

const validRegistry = (): AssetRegistry => AssetRegistrySchema.parse(load());

describe('AssetRegistrySchema', () => {
  it('accepts a valid registry and round-trips', () => {
    const registry = validRegistry();
    expect(registry.assets.length).toBeGreaterThan(0);
    expect(AssetRegistrySchema.parse(JSON.parse(JSON.stringify(registry)))).toEqual(registry);
  });

  it('rejects duplicate asset ids', () => {
    const registry = validRegistry();
    expect(() =>
      AssetRegistrySchema.parse({ ...registry, assets: [...registry.assets, registry.assets[0]!] }),
    ).toThrow(/duplicate asset id/);
  });

  it('rejects an entry with no license provenance', () => {
    const registry = validRegistry();
    const { license: _license, ...unlicensed } = registry.assets[0]!;
    expect(() =>
      AssetRegistrySchema.parse({ ...registry, assets: [unlicensed] }),
    ).toThrow(/license/);
  });
});
