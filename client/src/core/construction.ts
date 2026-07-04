// SPDX-License-Identifier: Apache-2.0
//
// Citizen-construction rendering + inspect view model, kept out of React
// (ADR-0002): the sim raises a `construction_site` through its authored
// stages, and this turns a site's live state into a scene group and a
// render-ready panel. The Age-of-Empires moment — the viewer watches the
// mesh climb the ladder, then the finished building stand. Pure three +
// strings; no React, no loaders, testable headless.
import { Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { buildBuilding, buildRisingBuilding } from './buildings.js';
import type { AssetPiece } from './chunkMeshes.js';
import type { ConstructionSiteState, ConstructionSiteView } from './types.js';

/** World-space footprint centre: the site's chunk-local position shifted by
 *  its chunk origin. y is the authored ground height. */
export function siteWorldPosition(
  position: readonly [number, number, number],
  origin: readonly [number, number],
): [number, number, number] {
  return [origin[0] + position[0], position[1], origin[1] + position[2]];
}

/**
 * What to render for a site at its current stage — the stage-swap decision.
 * Under construction it shows the current rung's mesh; finished, it becomes
 * its completion chunk-data. A stage index past the ladder is treated as
 * complete, so a stray delta never indexes out of range.
 */
export type SiteRender =
  | { kind: 'stage'; asset: string }
  | { kind: 'rising'; fraction: number }
  | { kind: 'complete' };

export function siteRenderModel(site: {
  stageIndex: number;
  complete: boolean;
  stages: readonly { asset?: string; rise?: number }[];
}): SiteRender {
  if (site.complete || site.stageIndex >= site.stages.length) return { kind: 'complete' };
  const stage = site.stages[site.stageIndex]!;
  if (stage.asset !== undefined) return { kind: 'stage', asset: stage.asset };
  return { kind: 'rising', fraction: stage.rise ?? 1 };
}

/** Place one kit asset's pieces as plain meshes at a local transform. Sites
 *  are few, so no instancing — this mirrors buildPropInstances' matrix compose
 *  one placement at a time. */
function placeAsset(
  group: Group,
  pieces: Map<string, AssetPiece[]>,
  asset: string,
  position: readonly [number, number, number],
  rotationY: number,
  scale = 1,
): void {
  const base = new Matrix4().compose(
    new Vector3(position[0], position[1], position[2]),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotationY),
    new Vector3(scale, scale, scale),
  );
  const scratch = new Matrix4();
  for (const piece of pieces.get(asset) ?? []) {
    const mesh = new Mesh(piece.geometry, piece.material);
    mesh.applyMatrix4(scratch.multiplyMatrices(base, piece.local));
    mesh.castShadow = true;
    group.add(mesh);
  }
}

/**
 * Build a site's scene group in CHUNK-LOCAL space — the caller positions the
 * group at the chunk origin. Under construction: the current stage's mesh at
 * the footprint centre. Complete: the finished buildings and props, in their
 * authored chunk-local frame. A finished building's windows sit at their
 * unlit base color (they don't wire into the phase relight loop — a site
 * completes rarely and mid-session), which reads fine.
 */
export function buildSiteGroup(
  site: ConstructionSiteView,
  pieces: Map<string, AssetPiece[]>,
): Group {
  const group = new Group();
  group.name = `construction:${site.id}`;
  const model = siteRenderModel(site);
  if (model.kind === 'stage') {
    placeAsset(group, pieces, model.asset, site.position, site.rotation_y);
    return group;
  }
  if (model.kind === 'rising') {
    // The completion buildings, mid-rise (issue #117). Completion props
    // (furnishings, planting) arrive only when the build finishes.
    for (const building of site.completion.buildings) {
      group.add(buildRisingBuilding(building, model.fraction));
    }
    return group;
  }
  for (const building of site.completion.buildings) group.add(buildBuilding(building).group);
  for (const prop of site.completion.props) {
    placeAsset(group, pieces, prop.asset, prop.position, prop.rotation_y ?? 0, prop.scale ?? 1);
  }
  return group;
}

export interface SiteWorker {
  /** Resident id — stable across renders, safe as a list key. */
  id: string;
  /** Resident's display name. */
  name: string;
  /** Their live behavior-tree label, verbatim ("raising the frame"). */
  activity: string;
}

export interface SitePanelData {
  id: string;
  /** Prettified building name, e.g. "Bakery Extension". */
  name: string;
  /** Diegetic stage name, or "complete". */
  stage: string;
  /** Work accrued vs. needed, e.g. "12 / 40"; "done" once complete. */
  progress: string;
  /** 0..1 for the progress bar (1 when complete). */
  fraction: number;
  complete: boolean;
  /** Who is raising it right now — "Aldous — raising the frame". */
  workers: SiteWorker[];
}

/** A site id read as a building name: "bakery-extension" → "Bakery Extension". */
export function siteName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The inspect panel's view model: the live site state + the resident directory
 * + each resident's live activity in, render-ready strings out. Every worker
 * line pairs a name with the tree label they're running, so "who is raising
 * it" reads straight off the behavior tree.
 */
export function buildSitePanelData(
  site: ConstructionSiteState,
  nameById: Map<string, string>,
  activityOf: (id: string) => string,
): SitePanelData {
  return {
    id: site.id,
    name: siteName(site.id),
    stage: site.complete ? 'complete' : site.stage,
    progress: site.complete ? 'done' : `${site.progress} / ${site.required}`,
    fraction: site.complete ? 1 : site.required > 0 ? Math.min(1, site.progress / site.required) : 0,
    complete: site.complete,
    workers: site.workers.map((id) => ({
      id,
      name: nameById.get(id) ?? id,
      activity: activityOf(id),
    })),
  };
}
