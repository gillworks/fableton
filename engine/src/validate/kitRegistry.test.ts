// SPDX-License-Identifier: Apache-2.0
//
// Acceptance (issue #5): every prop id the generator emits resolves in
// the canonical registry, every registry path resolves to a vendored
// file, and every entry carries license provenance.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { generateWorld } from '../generate/generateWorld.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import { validateWorld } from './validateWorld.js';

const repoRoot = new URL('../../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, repoRoot), 'utf8');

const registry = AssetRegistrySchema.parse(JSON.parse(read('assets/registry.json')));
const fableton = parseCharter(read('charters/_template/charter.yaml'));
const cindervault = parseCharter(read('engine/test/fixtures/charter-valid.yaml'));

describe('canonical asset registry', () => {
  it('parses and every path resolves to a vendored file', () => {
    expect(registry.assets.length).toBeGreaterThan(0);
    for (const asset of registry.assets) {
      expect(existsSync(new URL(asset.path, repoRoot)), `${asset.id} → ${asset.path}`).toBe(true);
    }
  });

  it('records license provenance on every entry', () => {
    for (const asset of registry.assets) {
      expect(asset.license.id).toBe('CC0-1.0');
      expect(asset.license.source).toContain('kenney.nl');
      expect(asset.license.attribution).toBeTruthy();
    }
  });

  it('poly counts are real mesh sizes, not placeholders', () => {
    for (const asset of registry.assets) {
      expect(asset.poly_count).toBeGreaterThanOrEqual(50);
      expect(asset.poly_count).toBeLessThan(5000);
    }
  });

  it('every prop id the generator emits resolves in the registry (both charters)', () => {
    const ids = new Set(registry.assets.map((a) => a.id));
    for (const charter of [fableton, cindervault]) {
      const { manifest, chunks } = generateWorld(charter, registry);
      const emitted = chunks.flatMap((c) => c.props.map((p) => p.asset));
      expect(emitted.length).toBeGreaterThan(0);
      for (const id of emitted) expect(ids).toContain(id);
      // And the whole generated world passes the gate with this registry.
      const violations = validateWorld(charter, {
        manifest: { file: 'manifest.json', doc: JSON.parse(JSON.stringify(manifest)) },
        registry: { file: 'assets/registry.json', doc: JSON.parse(JSON.stringify(registry)) },
        chunks: chunks.map((c) => ({
          file: `chunks/${c.id}.json`,
          doc: JSON.parse(JSON.stringify(c)),
        })),
        npcs: [],
      });
      expect(violations).toEqual([]);
    }
  });
});
