// SPDX-License-Identifier: Apache-2.0
//
// The rendering core is plain TS (ADR-0002) — tested headless against
// the real sample world fixtures the gate validates.
import { readFileSync } from 'node:fs';
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshLambertMaterial } from 'three';
import { buildBuilding } from './buildings.js';
import { buildChunkGroup, buildPropInstances, buildTerrain, coinFor, drawCallCount, groundAssetPieces, type AssetPiece } from './chunkMeshes.js';
import { SimState } from './interpolator.js';
import { ChunkStreamer } from './streamer.js';
import { deriveTheme, phaseLighting } from './theme.js';
import type { Chunk, SimSnapshot, ThemeTokens, WorldManifest } from './types.js';

const fixtures = new URL('../../../engine/test/fixtures/sample-world/', import.meta.url);
const loadJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, fixtures), 'utf8')) as T;

const manifest = loadJson<WorldManifest>('manifest.json');
const townSquare = loadJson<Chunk>('chunks/town-square.json');

const fakePieces = (): Map<string, AssetPiece[]> => {
  const piece = (): AssetPiece[] => [
    { geometry: new BoxGeometry(1, 1, 1), material: new MeshLambertMaterial(), local: new Matrix4() },
  ];
  return new Map(
    ['fountain-round', 'stall-red', 'cart', 'lantern', 'windmill', 'tree', 'tree-crooked', 'tree-high-round'].map((id) => [id, piece()]),
  );
};

describe('chunkMeshes', () => {
  it('terrain has grid_size² displaced, palette-colored vertices', () => {
    const terrain = buildTerrain(townSquare);
    const positions = terrain.geometry.attributes['position']!;
    expect(positions.count).toBe(townSquare.terrain.grid_size ** 2);
    expect(terrain.geometry.attributes['color']).toBeDefined();
    const ys = Array.from({ length: positions.count }, (_, i) => positions.getY(i));
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...townSquare.terrain.heights));
  });

  it('props become GPU instances: one InstancedMesh per asset piece, counts match placements', () => {
    const instances = buildPropInstances(townSquare, fakePieces());
    expect(instances.length).toBe(new Set(townSquare.props.map((p) => p.asset)).size);
    const total = instances.reduce((sum, m) => sum + m.count, 0);
    expect(total).toBe(townSquare.props.length);
  });

  it('stays inside the charter draw-call budget', () => {
    expect(drawCallCount(townSquare, fakePieces())).toBeLessThanOrEqual(120);
  });

  it('chunk group sits at its manifest origin', () => {
    const entry = manifest.chunks.find((c) => c.id === 'town-square')!;
    const { group } = buildChunkGroup(townSquare, entry.origin, fakePieces());
    expect([group.position.x, group.position.z]).toEqual(entry.origin);
  });

  it('the diorama coin covers every chunk footprint', () => {
    const coin = coinFor(manifest.chunks.map((c) => c.origin));
    expect(coin.rx).toBeGreaterThan(16);
    expect(coin.center[0]).toBeDefined();
  });
});

describe('groundAssetPieces', () => {
  it('lifts models whose origin is mid-body so they sit on the ground', () => {
    // A "windmill": its geometry spans y -2..2 around the origin.
    const sunken: AssetPiece[] = [
      { geometry: new BoxGeometry(1, 4, 1), material: new MeshLambertMaterial(), local: new Matrix4() },
    ];
    // A "tree": origin already at the base (y 0..2 via local matrix).
    const grounded: AssetPiece[] = [
      { geometry: new BoxGeometry(1, 2, 1), material: new MeshLambertMaterial(), local: new Matrix4().makeTranslation(0, 1, 0) },
    ];
    const map = groundAssetPieces(new Map([['windmill', sunken], ['tree', grounded]]));
    const minY = (p: AssetPiece): number => {
      p.geometry.computeBoundingBox();
      return p.geometry.boundingBox!.clone().applyMatrix4(p.local).min.y;
    };
    expect(minY(map.get('windmill')![0]!)).toBeCloseTo(0);
    expect(minY(map.get('tree')![0]!)).toBeCloseTo(0);
  });
});

describe('buildings', () => {
  const spec = {
    position: [8, 0.4, 8] as [number, number, number],
    rotation_y: 0.1,
    width: 3,
    depth: 2.5,
    height: 2,
    wall_color: '#e8dcc0',
    roof_color: '#a04a38',
    windows: 2,
    chimney: true,
  };

  it('assembles the mockup anatomy: walls, double-slab roof, door, windows, chimney', () => {
    const built = buildBuilding(spec);
    expect(built.group.children.length).toBe(4 + 2 * 2 + 1); // walls+2 slabs+door + windows*2 sides + chimney
    expect(built.windowMaterials).toHaveLength(4);
    expect(built.group.position.y).toBeCloseTo(0.4);
  });

  it('windows start dark; glow is driven externally by phase', () => {
    const built = buildBuilding(spec);
    for (const m of built.windowMaterials) expect(m.emissiveIntensity).toBe(0);
  });

  it('draw-call estimate prices buildings like the validator', () => {
    const withBuildings = { ...townSquare, buildings: [spec, spec] };
    expect(drawCallCount(withBuildings, fakePieces())).toBe(drawCallCount(townSquare, fakePieces()) + 12);
  });
});

describe('ChunkStreamer', () => {
  const fetcher = (path: string): Promise<Chunk> => Promise.resolve(loadJson<Chunk>(path));

  it('loads nearest chunks first', () => {
    const streamer = new ChunkStreamer(manifest, fetcher);
    // Camera over mill-lane (origin -16,0).
    const order = streamer.priority(new Vector3(-10, 10, 8)).map((c) => c.id);
    expect(order[0]).toBe('mill-lane');
    expect(order.at(-1)).toBe('orchard-row');
  });

  it('streams everything and reports frustum visibility', async () => {
    const streamer = new ChunkStreamer(manifest, fetcher);
    for (let i = 0; i < 5; i++) {
      streamer.update(new Vector3(8, 10, 8));
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(streamer.loaded.size).toBe(3);

    const camera = new PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(8, 6, 40);
    camera.lookAt(8, 0, 8);
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const visible = streamer.visible(frustum);
    expect(visible.has('town-square')).toBe(true);

    // Face away: nothing survives the cull.
    camera.lookAt(8, 0, 500);
    camera.updateMatrixWorld();
    const away = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(streamer.visible(away).size).toBe(0);
  });
});

describe('SimState interpolation', () => {
  const snapshot: SimSnapshot = {
    type: 'snapshot',
    tick: 0,
    phase: 'first light',
    timeOfDay: 0,
    npcs: [
      { id: 'greta', chunk: 'town-square', pos: [0, 0, 0], ry: 0, activity: 'waking up' },
    ],
  };

  it('lerps between delta positions over the broadcast interval', () => {
    const sim = new SimState(500);
    sim.apply(snapshot, 1000);
    // Delta arrives on the expected 500 ms cadence, so the window stays 500 ms.
    sim.apply({ type: 'delta', tick: 1, npcs: [{ id: 'greta', pos: [10, 0, 0] }] }, 1500);
    expect(sim.positionOf('greta', 1750)[0]).toBeCloseTo(5, 1); // halfway through the window
    expect(sim.positionOf('greta', 2100)[0]).toBe(10); // clamped at target
  });

  it('fires activity and phase listeners on change only', () => {
    const sim = new SimState(500);
    const events: string[] = [];
    sim.onActivity((npc, activity) => events.push(`${npc}:${activity}`));
    sim.onPhase((phase) => events.push(`phase:${phase}`));
    sim.apply(snapshot, 0);
    sim.apply({ type: 'delta', tick: 1, npcs: [{ id: 'greta', pos: [1, 0, 0] }] }, 500);
    sim.apply({ type: 'delta', tick: 2, phase: 'high sun', npcs: [{ id: 'greta', activity: 'selling' }] }, 1000);
    expect(events).toEqual(['greta:waking up', 'phase:first light', 'phase:high sun', 'greta:selling']);
  });
});

describe('theme', () => {
  const tokens: ThemeTokens = {
    theme: 'warm storybook',
    palette: ['warm parchment', 'moss', 'honey', 'dusk blue'],
    accent: 'amber',
    typography: { display: 'Alegreya', mono: 'IBM Plex Mono' },
  };

  it('derives stable hex from charter names via the canonical mapping', () => {
    const theme = deriveTheme(tokens);
    expect(theme.paletteHex).toHaveLength(4);
    for (const hex of [...theme.paletteHex, theme.accentHex]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(deriveTheme(tokens).paletteHex).toEqual(theme.paletteHex); // stable
  });

  it('four phases relight distinctly: noon brightest, night dimmest', () => {
    const theme = deriveTheme(tokens);
    const phases = [0, 1, 2, 3].map((i) => phaseLighting(i, theme));
    const intensities = phases.map((p) => p.sunIntensity);
    expect(Math.max(...intensities)).toBe(phases[1]!.sunIntensity);
    expect(Math.min(...intensities)).toBe(phases[3]!.sunIntensity);
    expect(new Set(phases.map((p) => p.gradientTop)).size).toBe(4);
    for (const p of phases) expect(p.gradientTop).toMatch(/^#[0-9a-f]{6}$/);
  });
});
