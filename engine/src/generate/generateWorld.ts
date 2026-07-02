// SPDX-License-Identifier: Apache-2.0
//
// Deterministic generation: charter + seed → skeleton world (docs/v1.md).
// Same charter + seed ⇒ identical output, every run, every machine: all
// randomness comes from named sub-seed streams of the charter's root seed,
// iteration is over sorted arrays only, and every emitted float is rounded
// to 3 decimals so serialization is byte-stable.
//
// The engine fixes the grammar (grid layout, walk-graph shape, biome
// vocabulary); the charter varies the parameters (seed, scale, caps,
// palette). No world is named here (CLAUDE.md invariant 5).
import type { AssetRegistry } from '../schemas/assets.js';
import type { Charter } from '../schemas/charter.js';
import { ChunkSchema, type Chunk } from '../schemas/chunk.js';
import { WorldManifestSchema, type WorldManifest } from '../schemas/manifest.js';
import { deriveSeed, mulberry32, pick, randInt, type Rng } from './rng.js';

export interface GeneratedWorld {
  manifest: WorldManifest;
  chunks: Chunk[];
}

// Engine-fixed generation grammar.
const CHUNK_SIZE = 16; // world units per chunk side
const GRID_SIZE = 9; // heightmap vertices per side
const BIOMES = ['meadow', 'grove', 'hollow', 'rise'] as const;
const SCALE_CHUNKS: Record<string, number> = {
  hamlet: 3,
  village: 5,
  town: 8,
  city: 12,
};
const DEFAULT_CHUNKS = 5;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

// Charter palettes are evocative names ("warm parchment"), chunk palettes
// are hex. Derive a stable color per name: hash → hue, fixed sat/light
// bands, so the same name is the same color in every world and run.
function colorFor(name: string): string {
  const h = deriveSeed(0, name);
  const hue = h % 360;
  const sat = 30 + ((h >>> 9) % 30);
  const light = 40 + ((h >>> 17) % 25);
  return hslToHex(hue, sat, light);
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface Cell {
  gx: number;
  gz: number;
}

const cellKey = (c: Cell): string => `${c.gx},${c.gz}`;
const DIRS: readonly Cell[] = [
  { gx: 1, gz: 0 },
  { gx: -1, gz: 0 },
  { gx: 0, gz: 1 },
  { gx: 0, gz: -1 },
];

// Random walk over the grid: connected by construction.
function layoutCells(rng: Rng, count: number): Cell[] {
  const cells: Cell[] = [{ gx: 0, gz: 0 }];
  const occupied = new Set([cellKey(cells[0]!)]);
  while (cells.length < count) {
    const from = pick(rng, cells);
    const dir = pick(rng, DIRS);
    const next = { gx: from.gx + dir.gx, gz: from.gz + dir.gz };
    if (!occupied.has(cellKey(next))) {
      occupied.add(cellKey(next));
      cells.push(next);
    }
  }
  // Normalize to non-negative grid coords so ids are stable slugs.
  const minX = Math.min(...cells.map((c) => c.gx));
  const minZ = Math.min(...cells.map((c) => c.gz));
  return cells
    .map((c) => ({ gx: c.gx - minX, gz: c.gz - minZ }))
    .sort((a, b) => a.gx - b.gx || a.gz - b.gz);
}

const chunkId = (c: Cell): string => `chunk-${c.gx}-${c.gz}`;

function generateChunk(
  cell: Cell,
  neighbours: { id: string; dir: Cell }[],
  charter: Charter,
  registry: AssetRegistry,
): Chunk {
  const id = chunkId(cell);
  const rng = mulberry32(deriveSeed(charter.identity.seed, `chunk:${id}`));
  const caps = charter.generation.caps;

  // Terrain: gentle value noise around a per-chunk base elevation.
  const base = rng() * 1.5;
  const heights: number[] = [];
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    heights.push(round3(base + rng() * 0.6));
  }
  const terrainPolys = 2 * (GRID_SIZE - 1) ** 2;

  // Props: fill toward an ambient density, respecting the charter caps.
  const assets = registry.assets;
  const targetProps = randInt(rng, 3, 7);
  const props: Chunk['props'] = [];
  let polys = terrainPolys;
  for (let i = 0; i < targetProps && assets.length > 0; i++) {
    const asset = pick(rng, assets);
    if (polys + asset.poly_count > caps.chunk_poly_budget) break;
    if (1 + props.length + 1 > caps.chunk_drawcall_budget) break;
    polys += asset.poly_count;
    props.push({
      asset: asset.id,
      position: [round3(2 + rng() * (CHUNK_SIZE - 4)), 0, round3(2 + rng() * (CHUNK_SIZE - 4))],
      rotation_y: round3(rng() * Math.PI * 2),
      scale: round3(0.9 + rng() * 0.2),
    });
  }

  // Nav-lite: a heart node, a wander node, and one gate node per
  // neighbour, star-wired to the heart (connected by construction).
  // Gates sit at the shared edge midpoint; both sides generate their own
  // gate + portal, so portals are reciprocal by construction.
  const mid = CHUNK_SIZE / 2;
  const nodes: Chunk['nav']['nodes'] = [
    { id: 'heart', position: [mid, 0, mid] },
    { id: 'wander', position: [round3(3 + rng() * (CHUNK_SIZE - 6)), 0, round3(3 + rng() * (CHUNK_SIZE - 6))] },
  ];
  const edges: Chunk['nav']['edges'] = [['heart', 'wander']];
  const portals: Chunk['nav']['portals'] = [];
  for (const n of neighbours) {
    const gate = `gate-${n.id}`;
    nodes.push({
      id: gate,
      position: [mid + n.dir.gx * (mid - 1), 0, mid + n.dir.gz * (mid - 1)],
    });
    edges.push(['heart', gate]);
    portals.push({ node: gate, to_chunk: n.id });
  }

  return ChunkSchema.parse({
    schema_version: 1,
    id,
    terrain: { biome: pick(rng, BIOMES), grid_size: GRID_SIZE, heights },
    palette: charter.aesthetic.palette.map(colorFor),
    props,
    nav: { nodes, edges, portals },
    npcs: [],
    lore: [],
  });
}

/**
 * charter + seed → skeleton world: terrain, layout, prop placements,
 * navmesh-lite, manifest. Prop meshes come from the supplied (licensed)
 * asset registry. Output is schema-validated before it leaves.
 */
export function generateWorld(charter: Charter, registry: AssetRegistry): GeneratedWorld {
  const caps = charter.generation.caps;
  const scaleChunks = SCALE_CHUNKS[charter.generation.scale] ?? DEFAULT_CHUNKS;
  const count = Math.min(scaleChunks, caps.max_regions);

  const layoutRng = mulberry32(deriveSeed(charter.identity.seed, 'layout'));
  const cells = layoutCells(layoutRng, count);
  const byKey = new Map(cells.map((c) => [cellKey(c), c]));

  const neighboursOf = (cell: Cell): { id: string; dir: Cell }[] =>
    DIRS.flatMap((dir) => {
      const other = byKey.get(cellKey({ gx: cell.gx + dir.gx, gz: cell.gz + dir.gz }));
      return other ? [{ id: chunkId(other), dir }] : [];
    });

  const chunks = cells.map((cell) => generateChunk(cell, neighboursOf(cell), charter, registry));

  const manifest = WorldManifestSchema.parse({
    schema_version: 1,
    world: charter.identity.name,
    seed: charter.identity.seed,
    chunks: cells.map((cell) => ({
      id: chunkId(cell),
      path: `chunks/${chunkId(cell)}.json`,
      origin: [cell.gx * CHUNK_SIZE, cell.gz * CHUNK_SIZE],
      adjacent: neighboursOf(cell)
        .map((n) => n.id)
        .sort(),
    })),
  });

  return { manifest, chunks };
}
