// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import type { Charter } from '../schemas/charter.js';
import { validateWorld } from '../validate/validateWorld.js';
import { generateWorld, growRegion } from './generateWorld.js';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const charter: Charter = parseCharter(read('../../../charters/_template/charter.yaml'));
const registry = AssetRegistrySchema.parse(
  JSON.parse(read('../../test/fixtures/sample-world/assets.json')),
);

const CHUNK_SIZE = 16;
const GRID = 9;

/** An empty cell orthogonally adjacent to the founded map. */
function frontierCell(manifest: { chunks: { origin: [number, number] }[] }): { gx: number; gz: number } {
  const occupied = new Set(manifest.chunks.map((c) => `${c.origin[0] / CHUNK_SIZE},${c.origin[1] / CHUNK_SIZE}`));
  for (const c of manifest.chunks) {
    const [gx, gz] = [c.origin[0] / CHUNK_SIZE, c.origin[1] / CHUNK_SIZE];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!occupied.has(`${gx + dx},${gz + dz}`)) return { gx: gx + dx, gz: gz + dz };
    }
  }
  throw new Error('no frontier?');
}

describe('growRegion (issue #120)', () => {
  const world = generateWorld(charter, registry);
  const cell = frontierCell(world.manifest);

  it('grows one connected, gate-passing region, deterministically', () => {
    const grown = growRegion(charter, registry, world, cell);
    expect(grown.chunk.id).toBe(`chunk-${cell.gx}-${cell.gz}`);
    expect(grown.manifest.chunks).toHaveLength(world.manifest.chunks.length + 1);
    // the whole grown world passes the same gate the CLI runs
    const finalChunks = [
      ...world.chunks.map((c) => grown.patchedNeighbours.find((p) => p.id === c.id) ?? c),
      grown.chunk,
    ];
    const violations = validateWorld(charter, {
      manifest: { file: 'manifest.json', doc: grown.manifest },
      registry: { file: 'assets.json', doc: registry },
      chunks: finalChunks.map((c) => ({ file: `chunks/${c.id}.json`, doc: c })),
      npcs: [],
      constructionSites: [],
    });
    expect(violations).toEqual([]);
    // deterministic: growing the same cell twice is byte-identical
    expect(JSON.stringify(growRegion(charter, registry, world, cell))).toBe(
      JSON.stringify(grown),
    );
  });

  it('terrain seams match: the shared edge heights equal the neighbour edge heights', () => {
    const grown = growRegion(charter, registry, world, cell);
    const neighbour = grown.patchedNeighbours[0]!;
    const entry = world.manifest.chunks.find((c) => c.id === neighbour.id)!;
    const [ngx, ngz] = [entry.origin[0] / CHUNK_SIZE, entry.origin[1] / CHUNK_SIZE];
    const heights = (c: { terrain: { heights: number[] } }, x: number, z: number): number =>
      c.terrain.heights[z * GRID + x]!;
    for (let i = 0; i < GRID; i++) {
      // sample the touching edge in both frames
      const [dx, dz] = [ngx - cell.gx, ngz - cell.gz];
      const mine =
        dx === 1 ? heights(grown.chunk, GRID - 1, i)
        : dx === -1 ? heights(grown.chunk, 0, i)
        : dz === 1 ? heights(grown.chunk, i, GRID - 1)
        : heights(grown.chunk, i, 0);
      const theirs =
        dx === 1 ? heights(neighbour, 0, i)
        : dx === -1 ? heights(neighbour, GRID - 1, i)
        : dz === 1 ? heights(neighbour, i, 0)
        : heights(neighbour, i, GRID - 1);
      expect(mine).toBeCloseTo(theirs, 3);
    }
  });

  it('wires reciprocal gates and portals into every touched neighbour', () => {
    const grown = growRegion(charter, registry, world, cell);
    const id = grown.chunk.id;
    for (const neighbour of grown.patchedNeighbours) {
      expect(neighbour.nav.nodes.some((n) => n.id === `gate-${id}`)).toBe(true);
      expect(neighbour.nav.portals.some((p) => p.to_chunk === id)).toBe(true);
      expect(grown.chunk.nav.portals.some((p) => p.to_chunk === neighbour.id)).toBe(true);
      // manifest adjacency is symmetric (the schema also enforces this)
      const mine = grown.manifest.chunks.find((c) => c.id === id)!;
      const theirs = grown.manifest.chunks.find((c) => c.id === neighbour.id)!;
      expect(mine.adjacent).toContain(neighbour.id);
      expect(theirs.adjacent).toContain(id);
    }
  });

  it('refuses an occupied cell, a detached cell, and growth past the charter cap', () => {
    const occupiedCell = {
      gx: world.manifest.chunks[0]!.origin[0] / CHUNK_SIZE,
      gz: world.manifest.chunks[0]!.origin[1] / CHUNK_SIZE,
    };
    expect(() => growRegion(charter, registry, world, occupiedCell)).toThrow(/already/);
    expect(() => growRegion(charter, registry, world, { gx: 999, gz: 999 })).toThrow(/connected/);
    const capped: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, max_regions: world.manifest.chunks.length },
      },
    };
    expect(() => growRegion(capped, registry, world, cell)).toThrow(/caps this world/);
  });
});
