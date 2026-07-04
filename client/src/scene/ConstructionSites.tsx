// SPDX-License-Identifier: Apache-2.0
//
// Citizen-construction sites in the scene (issue #99): each site renders as
// its current stage's asset mesh and swaps that mesh the moment a stage-change
// delta lands on the sim socket — the buildings visibly rise, then stand.
// Thin R3F per ADR-0002: the mesh building lives in core/construction; this
// only mounts it and forwards a click to the inspect panel. Distinct from
// ConstructionMarker, which renders studio PRs, not the sites residents raise.
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { OVERLAY_Z_RANGE } from '../core/hud.js';
import { buildSiteGroup, siteName } from '../core/construction.js';
import type { AssetPiece } from '../core/chunkMeshes.js';
import type { SimState } from '../core/interpolator.js';
import type { WorldTheme } from '../core/theme.js';
import type { ConstructionSiteView, WorldManifest } from '../core/types.js';

interface LiveStage {
  stageIndex: number;
  stage: string;
  complete: boolean;
}

export interface ConstructionSitesProps {
  /** Static definitions + initial state, from /api/construction. */
  defs: ConstructionSiteView[];
  manifest: WorldManifest;
  sim: SimState;
  pieces: Map<string, AssetPiece[]>;
  theme: WorldTheme;
  onSelect: (siteId: string) => void;
}

export function ConstructionSites({
  defs,
  manifest,
  sim,
  pieces,
  theme,
  onSelect,
}: ConstructionSitesProps): ReactElement {
  // Live stage per site id: seeded from the definitions, advanced by the
  // socket. A stage change re-keys the mesh below, so it swaps in place.
  const [live, setLive] = useState<Record<string, LiveStage>>(() =>
    Object.fromEntries(defs.map((d) => [d.id, { stageIndex: d.stageIndex, stage: d.stage, complete: d.complete }])),
  );
  useEffect(() => {
    sim.onSites((sites) => {
      setLive((prev) => {
        const next = { ...prev };
        for (const s of sites) next[s.id] = { stageIndex: s.stageIndex, stage: s.stage, complete: s.complete };
        return next;
      });
    });
  }, [sim]);

  return (
    <>
      {defs.map((def) => {
        const origin = manifest.chunks.find((c) => c.id === def.chunk)?.origin;
        if (!origin) return null;
        const cur = live[def.id] ?? { stageIndex: def.stageIndex, stage: def.stage, complete: def.complete };
        const view: ConstructionSiteView = { ...def, stageIndex: cur.stageIndex, stage: cur.stage, complete: cur.complete };
        return (
          <SiteMesh
            key={`${def.id}:${cur.stageIndex}:${cur.complete}`}
            view={view}
            origin={origin}
            pieces={pieces}
            theme={theme}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}

function SiteMesh({
  view,
  origin,
  pieces,
  theme,
  onSelect,
}: {
  view: ConstructionSiteView;
  origin: [number, number];
  pieces: Map<string, AssetPiece[]>;
  theme: WorldTheme;
  onSelect: (siteId: string) => void;
}): ReactElement {
  // Rebuilt only when the stage actually changes (id/index/complete) — the key
  // above remounts on a stage swap, so within a mount this stays put.
  const group = useMemo(
    () => buildSiteGroup(view, pieces),
    [view.id, view.stageIndex, view.complete, pieces],
  );
  const label = view.complete ? `${siteName(view.id)} · complete` : `${siteName(view.id)} · ${view.stage}`;
  return (
    <group
      position={[origin[0], 0, origin[1]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(view.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      {/* dispose={null}: the group's meshes reuse geometry/material from the
          shared asset-piece pool (core/construction.placeAsset), the same
          instances chunk props draw. A stage swap re-keys and unmounts this
          primitive; without dispose={null} R3F would free those shared
          resources and blank every other prop of the asset scene-wide. */}
      <primitive object={group} dispose={null} />
      <Html
        center
        position={[view.position[0], view.position[1] + 3.2, view.position[2]]}
        distanceFactor={28}
        zIndexRange={OVERLAY_Z_RANGE}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            background: 'rgba(20, 17, 14, 0.9)',
            color: '#f6efe0',
            fontFamily: `"${theme.mono}", ui-monospace, monospace`,
            fontSize: 12,
            letterSpacing: 0.5,
            padding: '5px 11px',
            borderRadius: 8,
            whiteSpace: 'nowrap',
            border: '1px solid rgba(246, 239, 224, 0.3)',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}
