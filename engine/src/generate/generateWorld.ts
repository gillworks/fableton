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
import { colorFor, hslToHex } from '../color.js';
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

// World-space value noise on a shared integer lattice: adjacent chunks
// sample identical heights along shared edges, so the terrain is seamless
// by construction. Deterministic — the lattice hashes the charter seed.
function makeHeightField(seed: number): (wx: number, wz: number) => number {
  const lattice = (ix: number, iz: number): number =>
    mulberry32(deriveSeed(seed, `h:${ix}:${iz}`))();
  const fade = (t: number): number => t * t * (3 - 2 * t);
  const octave = (wx: number, wz: number, cell: number): number => {
    const gx = Math.floor(wx / cell);
    const gz = Math.floor(wz / cell);
    const fx = fade(wx / cell - gx);
    const fz = fade(wz / cell - gz);
    const a = lattice(gx, gz);
    const b = lattice(gx + 1, gz);
    const c = lattice(gx, gz + 1);
    const d = lattice(gx + 1, gz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  return (wx, wz) => octave(wx, wz, 40) * 1.1 + octave(wx, wz, 9) * 0.45;
}

// Lighten/darken a hex deterministically (no float drift: integer HSL ops).
function shadeHex(hex: string, dl: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let sat = 0;
  if (d > 0) {
    sat = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h * 60) % 360 + 360) % 360;
  }
  return hslToHex(h, Math.round(sat * 100), Math.min(94, Math.max(6, Math.round(l * 100) + dl)));
}

// Exact height on the rendered mesh: bilinear over the chunk's height
// grid, so props and nav nodes sit on the surface the client draws.
function heightOnMesh(heights: number[], lx: number, lz: number): number {
  const cell = CHUNK_SIZE / (GRID_SIZE - 1);
  const cx = Math.min(GRID_SIZE - 2, Math.max(0, Math.floor(lx / cell)));
  const cz = Math.min(GRID_SIZE - 2, Math.max(0, Math.floor(lz / cell)));
  const fx = lx / cell - cx;
  const fz = lz / cell - cz;
  const at = (x: number, z: number): number => heights[z * GRID_SIZE + x]!;
  const a = at(cx, cz);
  const b = at(cx + 1, cz);
  const c = at(cx, cz + 1);
  const d = at(cx + 1, cz + 1);
  return round3(a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz);
}

function generateChunk(
  cell: Cell,
  neighbours: { id: string; dir: Cell }[],
  charter: Charter,
  registry: AssetRegistry,
  heightField: (wx: number, wz: number) => number,
): Chunk {
  const id = chunkId(cell);
  const rng = mulberry32(deriveSeed(charter.identity.seed, `chunk:${id}`));
  const caps = charter.generation.caps;
  const [ox, oz] = [cell.gx * CHUNK_SIZE, cell.gz * CHUNK_SIZE];

  // Terrain: the world-space height field sampled at vertex coordinates,
  // row-major (z rows, x fastest — the client's PlaneGeometry order).
  const heights: number[] = [];
  const step = CHUNK_SIZE / (GRID_SIZE - 1);
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      heights.push(round3(heightField(ox + x * step, oz + z * step)));
    }
  }
  const terrainPolys = 2 * (GRID_SIZE - 1) ** 2;
  const grounded = (lx: number, lz: number): [number, number, number] => [
    round3(lx),
    heightOnMesh(heights, lx, lz),
    round3(lz),
  ];

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
      position: grounded(2 + rng() * (CHUNK_SIZE - 4), 2 + rng() * (CHUNK_SIZE - 4)),
      rotation_y: round3(rng() * Math.PI * 2),
      scale: round3(0.9 + rng() * 0.2),
    });
  }

  // Buildings: parametric world-data (docs/design.md silhouettes). Roofs
  // rotate through shades derived from the charter palette; walls stay
  // in a warm neutral band tinted by the first palette entry. Windows
  // glow by phase on the client; corner-most houses get chimneys.
  const paletteHex = charter.aesthetic.palette.map(colorFor);
  const buildingCount = randInt(rng, 2, 4);
  const buildings: Chunk['buildings'] = [];
  for (let i = 0; i < buildingCount; i++) {
    // Priced like the validator: ~200 tris and 6 draw calls per building.
    if (polys + 200 > caps.chunk_poly_budget) break;
    if (1 + props.length + (buildings.length + 1) * 6 > caps.chunk_drawcall_budget) break;
    polys += 200;
    const width = round3(2.2 + rng() * 2.2);
    const depth = round3(2 + rng() * 1.8);
    const lx = 2.5 + rng() * (CHUNK_SIZE - 5);
    const lz = 2.5 + rng() * (CHUNK_SIZE - 5);
    const roofBase = paletteHex[(i + 1) % paletteHex.length]!;
    buildings.push({
      position: [round3(lx), heightOnMesh(heights, lx, lz), round3(lz)],
      rotation_y: round3((randInt(rng, 0, 3) * Math.PI) / 2 + (rng() - 0.5) * 0.12),
      width,
      depth,
      height: round3(1.7 + rng() * 1.1),
      wall_color: shadeHex(paletteHex[0]!, 24 + randInt(rng, 0, 12)),
      roof_color: shadeHex(roofBase, -6 + randInt(rng, 0, 12)),
      windows: randInt(rng, 1, 3),
      chimney: rng() < 0.45,
    });
  }

  // Nav-lite: a heart node, a wander node, and one gate node per
  // neighbour, star-wired to the heart (connected by construction).
  // Gates sit at the shared edge midpoint; both sides generate their own
  // gate + portal, so portals are reciprocal by construction.
  const mid = CHUNK_SIZE / 2;
  const nodes: Chunk['nav']['nodes'] = [
    { id: 'heart', position: grounded(mid, mid) },
    { id: 'wander', position: grounded(3 + rng() * (CHUNK_SIZE - 6), 3 + rng() * (CHUNK_SIZE - 6)) },
  ];
  const edges: Chunk['nav']['edges'] = [['heart', 'wander']];
  const portals: Chunk['nav']['portals'] = [];
  for (const n of neighbours) {
    const gate = `gate-${n.id}`;
    nodes.push({
      id: gate,
      position: grounded(mid + n.dir.gx * (mid - 1), mid + n.dir.gz * (mid - 1)),
    });
    edges.push(['heart', gate]);
    portals.push({ node: gate, to_chunk: n.id });
  }

  return ChunkSchema.parse({
    schema_version: 1,
    id,
    terrain: { biome: pick(rng, BIOMES), grid_size: GRID_SIZE, heights },
    palette: paletteHex,
    props,
    buildings,
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

  const heightField = makeHeightField(charter.identity.seed);
  const chunks = cells.map((cell) =>
    generateChunk(cell, neighboursOf(cell), charter, registry, heightField),
  );

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
