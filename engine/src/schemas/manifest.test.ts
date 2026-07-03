// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WorldManifestSchema, type WorldManifest } from './manifest.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/sample-world/manifest.json', import.meta.url),
      'utf8',
    ),
  );

const validManifest = (): WorldManifest => WorldManifestSchema.parse(load());

describe('WorldManifestSchema', () => {
  it('accepts a valid manifest and round-trips', () => {
    const manifest = validManifest();
    expect(manifest.chunks).toHaveLength(3);
    expect(WorldManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('rejects asymmetric adjacency', () => {
    const manifest = validManifest();
    const chunks = manifest.chunks.map((c) =>
      c.id === 'orchard-row' ? { ...c, adjacent: [] } : c,
    );
    expect(() => WorldManifestSchema.parse({ ...manifest, chunks })).toThrow(/not symmetric/);
  });

  it('rejects adjacency to unknown chunks and to self', () => {
    const manifest = validManifest();
    const withUnknown = manifest.chunks.map((c) =>
      c.id === 'mill-lane' ? { ...c, adjacent: [...c.adjacent, 'atlantis'] } : c,
    );
    expect(() => WorldManifestSchema.parse({ ...manifest, chunks: withUnknown })).toThrow(
      /unknown chunk/,
    );
    const withSelf = manifest.chunks.map((c) =>
      c.id === 'mill-lane' ? { ...c, adjacent: [...c.adjacent, 'mill-lane'] } : c,
    );
    expect(() => WorldManifestSchema.parse({ ...manifest, chunks: withSelf })).toThrow(/itself/);
  });

  it('rejects duplicate chunk ids', () => {
    const manifest = validManifest();
    expect(() =>
      WorldManifestSchema.parse({ ...manifest, chunks: [...manifest.chunks, manifest.chunks[0]!] }),
    ).toThrow(/duplicate chunk id/);
  });

  it('carries founded_at when present and round-trips it', () => {
    const stamped = WorldManifestSchema.parse(
      Object.assign({}, load(), { founded_at: '2026-07-03T02:00:53Z' }),
    );
    expect(stamped.founded_at).toBe('2026-07-03T02:00:53Z');
    expect(WorldManifestSchema.parse(JSON.parse(JSON.stringify(stamped)))).toEqual(stamped);
    // Pre-#57 manifests (no stamp) still parse, just without a clock anchor.
    expect(validManifest().founded_at).toBeUndefined();
  });

  it('rejects a founded_at that is not an ISO datetime', () => {
    expect(() =>
      WorldManifestSchema.parse(Object.assign({}, load(), { founded_at: 'yesterday' })),
    ).toThrow(/founded_at/);
  });
});
