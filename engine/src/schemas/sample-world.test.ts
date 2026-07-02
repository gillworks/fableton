// SPDX-License-Identifier: Apache-2.0
//
// Acceptance (issue #2): a hand-written sample world (3 chunks, 3 NPCs)
// validates, and its cross-file references are coherent. Full ref
// resolution is the CI gate's job; these assertions keep the sample
// honest as it grows.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AssetRegistrySchema } from './assets.js';
import { ChunkSchema, type Chunk } from './chunk.js';
import { WorldManifestSchema } from './manifest.js';
import { NpcSchema, type Npc } from './npc.js';

const root = new URL('../../test/fixtures/sample-world/', import.meta.url);
const loadJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const manifest = WorldManifestSchema.parse(loadJson('manifest.json'));
const registry = AssetRegistrySchema.parse(loadJson('assets.json'));
const chunks: Chunk[] = manifest.chunks.map((entry) => ChunkSchema.parse(loadJson(entry.path)));
const npcs: Npc[] = readdirSync(new URL('npcs/', root))
  .sort()
  .map((file) => NpcSchema.parse(loadJson(`npcs/${file}`)));

describe('sample world', () => {
  it('has the promised shape: 3 chunks, 3 NPCs', () => {
    expect(chunks).toHaveLength(3);
    expect(npcs).toHaveLength(3);
  });

  it('chunk files match their manifest entries', () => {
    manifest.chunks.forEach((entry, i) => {
      expect(chunks[i]!.id).toBe(entry.id);
    });
  });

  it('every placed prop exists in the asset registry', () => {
    const assetIds = new Set(registry.assets.map((a) => a.id));
    for (const chunk of chunks) {
      for (const prop of chunk.props) {
        expect(assetIds, `chunk ${chunk.id} places unknown asset ${prop.asset}`).toContain(
          prop.asset,
        );
      }
    }
  });

  it('every chunk npc ref names an NPC file, and every NPC is placed somewhere', () => {
    const npcIds = new Set(npcs.map((n) => n.id));
    const placed = new Set(chunks.flatMap((c) => c.npcs));
    for (const id of placed) expect(npcIds).toContain(id);
    for (const npc of npcs) expect(placed).toContain(npc.id);
  });

  it('every portal targets a chunk the manifest marks adjacent', () => {
    const adjacency = new Map(manifest.chunks.map((c) => [c.id, new Set(c.adjacent)]));
    for (const chunk of chunks) {
      for (const portal of chunk.nav.portals) {
        expect(
          adjacency.get(chunk.id),
          `chunk ${chunk.id} has a portal to non-adjacent ${portal.to_chunk}`,
        ).toContain(portal.to_chunk);
      }
    }
  });

  it('NPC relationships point at NPCs that exist', () => {
    const npcIds = new Set(npcs.map((n) => n.id));
    for (const npc of npcs) {
      for (const rel of npc.relationships) {
        expect(npcIds, `${npc.id} relates to unknown npc ${rel.to}`).toContain(rel.to);
      }
    }
  });
});
