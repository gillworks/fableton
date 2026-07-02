// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChunkSchema, type Chunk } from './chunk.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/sample-world/chunks/town-square.json', import.meta.url),
      'utf8',
    ),
  );

const validChunk = (): Chunk => ChunkSchema.parse(load());

describe('ChunkSchema', () => {
  it('accepts a valid chunk and fills placement defaults', () => {
    const chunk = validChunk();
    expect(chunk.id).toBe('town-square');
    expect(chunk.props[0]).toMatchObject({ asset: 'fountain-round', rotation_y: 0, scale: 1 });
  });

  it('round-trips: parse → serialize → parse is identity', () => {
    const chunk = validChunk();
    expect(ChunkSchema.parse(JSON.parse(JSON.stringify(chunk)))).toEqual(chunk);
  });

  it('rejects a heightmap that does not match grid_size²', () => {
    const chunk = validChunk();
    expect(() =>
      ChunkSchema.parse({ ...chunk, terrain: { ...chunk.terrain, heights: [0, 0, 0] } }),
    ).toThrow(/grid_size/);
  });

  it('rejects nav edges to unknown nodes and self-loops', () => {
    const chunk = validChunk();
    expect(() =>
      ChunkSchema.parse({
        ...chunk,
        nav: { ...chunk.nav, edges: [...chunk.nav.edges, ['square-center', 'nowhere']] },
      }),
    ).toThrow(/unknown nav node/);
    expect(() =>
      ChunkSchema.parse({
        ...chunk,
        nav: { ...chunk.nav, edges: [['square-center', 'square-center']] },
      }),
    ).toThrow(/itself/);
  });

  it('rejects portals from unknown nodes and duplicate node ids', () => {
    const chunk = validChunk();
    expect(() =>
      ChunkSchema.parse({
        ...chunk,
        nav: { ...chunk.nav, portals: [{ node: 'nowhere', to_chunk: 'orchard-row' }] },
      }),
    ).toThrow(/unknown nav node/);
    expect(() =>
      ChunkSchema.parse({
        ...chunk,
        nav: { ...chunk.nav, nodes: [...chunk.nav.nodes, chunk.nav.nodes[0]!] },
      }),
    ).toThrow(/duplicate nav node/);
  });

  it('rejects non-slug ids and malformed palette colors', () => {
    const chunk = validChunk();
    expect(() => ChunkSchema.parse({ ...chunk, id: 'Town Square!' })).toThrow(/slug/);
    expect(() => ChunkSchema.parse({ ...chunk, palette: ['papayawhip'] })).toThrow(/hex/);
  });
});
