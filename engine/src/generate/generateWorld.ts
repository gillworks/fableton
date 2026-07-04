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
  hamlet: 4,
  village: 8,
  town: 16,
  city: 24,
};
const DEFAULT_CHUNKS = 8;

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

  // Buildings: parametric world-data (docs/design.md silhouettes),
  // placed with clearance — never intersecting each other, the props,
  // the nav nodes, or the straight lines NPCs walk between them.
  // Deterministic rejection sampling: same seed, same town.
  const paletteHex = charter.aesthetic.palette.map(colorFor);
  const navSegments: [number, number, number, number][] = edges.map(([a, b]) => {
    const pa = nodes.find((n) => n.id === a)!.position;
    const pb = nodes.find((n) => n.id === b)!.position;
    return [pa[0], pa[2], pb[0], pb[2]];
  });
  const segmentDistance = (px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]): number => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  const buildingCount = randInt(rng, 2, 4);
  const buildings: Chunk['buildings'] = [];
  for (let i = 0; i < buildingCount; i++) {
    // Priced like the validator: ~200 tris and 6 draw calls per building.
    if (polys + 200 > caps.chunk_poly_budget) break;
    if (1 + props.length + (buildings.length + 1) * 6 > caps.chunk_drawcall_budget) break;
    const width = round3(2.2 + rng() * 2.2);
    const depth = round3(2 + rng() * 1.8);
    const radius = Math.hypot(width, depth) / 2;
    let placed: [number, number] | null = null;
    for (let attempt = 0; attempt < 14 && !placed; attempt++) {
      const lx = 2.5 + rng() * (CHUNK_SIZE - 5);
      const lz = 2.5 + rng() * (CHUNK_SIZE - 5);
      const clearOfBuildings = buildings.every(
        (b) => Math.hypot(b.position[0] - lx, b.position[2] - lz) > radius + Math.hypot(b.width, b.depth) / 2 + 0.5,
      );
      const clearOfProps = props.every((p) => Math.hypot(p.position[0] - lx, p.position[2] - lz) > radius + 0.9);
      // NPCs stand up to ~0.9 from a node and walk node-to-node lines.
      const clearOfWalks = navSegments.every((s) => segmentDistance(lx, lz, s) > radius + 1.1);
      if (clearOfBuildings && clearOfProps && clearOfWalks) placed = [lx, lz];
    }
    if (!placed) continue; // a crowded chunk keeps its open ground
    polys += 200;
    const roofBase = paletteHex[(buildings.length + 1) % paletteHex.length]!;
    buildings.push({
      position: [round3(placed[0]), heightOnMesh(heights, placed[0], placed[1]), round3(placed[1])],
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
export function generateWorld(
  charter: Charter,
  registry: AssetRegistry,
  options: { foundedAt?: string } = {},
): GeneratedWorld {
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
    // The founding timestamp is an INPUT, never read from the clock here —
    // charter + seed (+ foundedAt) stays byte-identical across runs.
    ...(options.foundedAt !== undefined && { founded_at: options.foundedAt }),
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

/**
 * Grow the world by ONE region (issue #120): generate the chunk at `cell`
 * exactly as the founding would have — same world-space noise (terrain
 * seams match the neighbours automatically), same per-chunk derived seed —
 * then wire it in: manifest entry, neighbours' adjacency, and each
 * neighbour's reciprocal gate node + portal, star-wired to its heart, as
 * if the chunk had always been there. Deterministic given (charter, world
 * state, cell); throws rather than producing a detached, occupied, or
 * over-cap world. Callers gate + write; this only computes.
 */
export interface GrownRegion {
  manifest: WorldManifest;
  /** The freshly generated chunk (residents come later — steward's lane). */
  chunk: Chunk;
  /** Neighbour chunks with the reciprocal gate/portal patched in. */
  patchedNeighbours: Chunk[];
}

export function growRegion(
  charter: Charter,
  registry: AssetRegistry,
  world: { manifest: WorldManifest; chunks: Chunk[] },
  cell: { gx: number; gz: number },
): GrownRegion {
  const caps = charter.generation.caps;
  if (world.manifest.chunks.length + 1 > caps.max_regions) {
    throw new Error(
      `the charter caps this world at ${caps.max_regions} regions (currently ${world.manifest.chunks.length})`,
    );
  }
  const cellOf = (origin: [number, number]): Cell => ({
    gx: origin[0] / CHUNK_SIZE,
    gz: origin[1] / CHUNK_SIZE,
  });
  const occupied = new Map(world.manifest.chunks.map((c) => [cellKey(cellOf(c.origin)), c.id]));
  const id = chunkId(cell);
  if (occupied.has(cellKey(cell))) {
    throw new Error(`cell (${cell.gx}, ${cell.gz}) is already ${occupied.get(cellKey(cell))}`);
  }
  const neighbours = DIRS.flatMap((dir) => {
    const other = occupied.get(cellKey({ gx: cell.gx + dir.gx, gz: cell.gz + dir.gz }));
    return other ? [{ id: other, dir }] : [];
  });
  if (neighbours.length === 0) {
    throw new Error(`cell (${cell.gx}, ${cell.gz}) touches no existing chunk — the world stays connected`);
  }

  const heightField = makeHeightField(charter.identity.seed);
  const chunk = generateChunk(cell, neighbours, charter, registry, heightField);

  // Reciprocal side: each neighbour gains the gate + portal the founding
  // would have given it. Pure geometry — no RNG is consumed, so the
  // neighbour's existing generated content is untouched.
  const mid = CHUNK_SIZE / 2;
  const neighbourIds = new Set(neighbours.map((n) => n.id));
  const patchedNeighbours = world.chunks
    .filter((c) => neighbourIds.has(c.id))
    .map((c) => {
      const dir = neighbours.find((n) => n.id === c.id)!.dir; // new cell → neighbour
      const gate = `gate-${id}`;
      if (c.nav.nodes.some((n) => n.id === gate)) return c; // already wired (re-run)
      const lx = mid + -dir.gx * (mid - 1);
      const lz = mid + -dir.gz * (mid - 1);
      return ChunkSchema.parse({
        ...c,
        nav: {
          nodes: [...c.nav.nodes, { id: gate, position: [round3(lx), heightOnMesh(c.terrain.heights, lx, lz), round3(lz)] }],
          edges: [...c.nav.edges, ['heart', gate]],
          portals: [...c.nav.portals, { node: gate, to_chunk: id }],
        },
      });
    });

  const manifest = WorldManifestSchema.parse({
    ...world.manifest,
    chunks: [
      ...world.manifest.chunks.map((entry) =>
        neighbourIds.has(entry.id)
          ? { ...entry, adjacent: [...entry.adjacent, id].sort() }
          : entry,
      ),
      {
        id,
        path: `chunks/${id}.json`,
        origin: [cell.gx * CHUNK_SIZE, cell.gz * CHUNK_SIZE],
        adjacent: neighbours.map((n) => n.id).sort(),
      },
    ],
  });

  return { manifest, chunk, patchedNeighbours };
}
