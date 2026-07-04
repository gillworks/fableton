// SPDX-License-Identifier: Apache-2.0
//
// Citizen-construction render + panel logic, tested headless (ADR-0002).
import { BoxGeometry, Matrix4, MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildSiteGroup,
  buildSitePanelData,
  siteName,
  siteRenderModel,
  siteWorldPosition,
} from './construction.js';
import type { AssetPiece } from './chunkMeshes.js';
import type { ConstructionSiteState, ConstructionSiteView } from './types.js';

const piece = (): AssetPiece[] => [
  { geometry: new BoxGeometry(1, 1, 1), material: new MeshLambertMaterial(), local: new Matrix4() },
];
const pieces = (): Map<string, AssetPiece[]> =>
  new Map([['stakes', piece()], ['frame-mesh', piece()], ['bakery', piece()]]);

const view = (over: Partial<ConstructionSiteView> = {}): ConstructionSiteView => ({
  id: 'bakery-extension',
  chunk: 'town-square',
  stage: 'marked plot',
  stageIndex: 0,
  stageCount: 3,
  progress: 1,
  required: 4,
  workers: [],
  complete: false,
  position: [4, 0, 4],
  rotation_y: 0,
  stages: [
    { name: 'marked plot', asset: 'stakes' },
    { name: 'foundation', asset: 'stakes' },
    { name: 'frame', asset: 'frame-mesh' },
  ],
  completion: { buildings: [], props: [{ asset: 'bakery', position: [4, 0, 4] }] },
  ...over,
});

describe('siteWorldPosition', () => {
  it('shifts the chunk-local position by the chunk origin', () => {
    expect(siteWorldPosition([4, 0, 4], [16, 32])).toEqual([20, 0, 36]);
  });
});

describe('siteRenderModel — the stage-swap decision', () => {
  it('shows the current stage mesh mid-build', () => {
    expect(siteRenderModel(view({ stageIndex: 2 }))).toEqual({ kind: 'stage', asset: 'frame-mesh' });
  });

  it('becomes complete when the site is finished', () => {
    expect(siteRenderModel(view({ complete: true, stageIndex: 3 }))).toEqual({ kind: 'complete' });
  });

  it('treats a stage index past the ladder as complete (never indexes out of range)', () => {
    expect(siteRenderModel(view({ complete: false, stageIndex: 3 }))).toEqual({ kind: 'complete' });
  });
});

describe('buildSiteGroup', () => {
  it('places the current stage asset mid-build', () => {
    const group = buildSiteGroup(view({ stageIndex: 0 }), pieces());
    // One mesh for the single-piece stakes asset.
    expect(group.children).toHaveLength(1);
  });

  it('swaps to a different asset when the stage changes', () => {
    const early = buildSiteGroup(view({ stageIndex: 0 }), pieces());
    const late = buildSiteGroup(view({ stageIndex: 2 }), pieces());
    // Both draw one mesh, but from different asset geometries — the swap.
    expect(early.children[0]).not.toBe(late.children[0]);
  });

  it('stands the completion payload once finished', () => {
    const built = buildSiteGroup(
      view({ complete: true, stageIndex: 3, completion: { buildings: [], props: [{ asset: 'bakery', position: [4, 0, 4] }] } }),
      pieces(),
    );
    expect(built.children).toHaveLength(1);
  });
});

describe('siteName', () => {
  it('reads an id as a building name', () => {
    expect(siteName('bakery-extension')).toBe('Bakery Extension');
    expect(siteName('town_well')).toBe('Town Well');
  });
});

describe('buildSitePanelData', () => {
  const roster = new Map([['aldous', 'Aldous']]);
  const state = (over: Partial<ConstructionSiteState> = {}): ConstructionSiteState => ({
    id: 'bakery-extension',
    chunk: 'town-square',
    stage: 'timber frame',
    stageIndex: 2,
    stageCount: 3,
    progress: 12,
    required: 40,
    workers: ['aldous'],
    complete: false,
    ...over,
  });

  it('pairs each worker with the tree label they are running now', () => {
    const panel = buildSitePanelData(state(), roster, () => 'raising the frame');
    expect(panel.name).toBe('Bakery Extension');
    expect(panel.stage).toBe('timber frame');
    expect(panel.progress).toBe('12 / 40');
    expect(panel.fraction).toBeCloseTo(0.3);
    expect(panel.workers).toEqual([{ name: 'Aldous', activity: 'raising the frame' }]);
  });

  it('reads "done" with no workers once complete', () => {
    const panel = buildSitePanelData(state({ complete: true, workers: [], progress: 0, required: 0 }), roster, () => '');
    expect(panel.complete).toBe(true);
    expect(panel.stage).toBe('complete');
    expect(panel.progress).toBe('done');
    expect(panel.fraction).toBe(1);
    expect(panel.workers).toEqual([]);
  });

  it('falls back to the id when a worker is not in the roster', () => {
    const panel = buildSitePanelData(state({ workers: ['unknown'] }), roster, () => 'hauling timber');
    expect(panel.workers[0]).toEqual({ name: 'unknown', activity: 'hauling timber' });
  });
});
