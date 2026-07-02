// SPDX-License-Identifier: Apache-2.0
//
// The R3F layer: thin components that call the core modules (ADR-0002 —
// rendering logic lives in src/core, never here). Scene graph churn is
// imperative (a Group ref the streamer fills); React only mounts it.
import { Html, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  CapsuleGeometry,
  Color,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  CylinderGeometry,
  Vector3,
} from 'three';
import { colorFor } from '@fableton/engine/color';
import type { AssetPiece } from '../core/chunkMeshes.js';
import { buildChunkGroup, coinFor } from '../core/chunkMeshes.js';
import type { SimState } from '../core/interpolator.js';
import { ChunkStreamer } from '../core/streamer.js';
import { phaseLighting, type WorldTheme } from '../core/theme.js';
import { fetchChunk, type WorldBundle } from '../core/loadWorld.js';
import type { Chunk, WorldInfo, WorldManifest } from '../core/types.js';

export interface WorldSceneProps {
  bundle: WorldBundle;
  pieces: Map<string, AssetPiece[]>;
  sim: SimState;
  theme: WorldTheme;
  phaseIndex: number;
}

const damp = (from: number, to: number, dt: number): number =>
  from + (to - from) * Math.min(1, dt * 3);

export function WorldScene({ bundle, pieces, sim, theme, phaseIndex }: WorldSceneProps): ReactElement {
  const worldRef = useRef<Group>(new Group());
  const chunkGroups = useRef(new Map<string, Group>());
  const streamer = useMemo(() => {
    const s = new ChunkStreamer(bundle.manifest, (path) => fetchChunk<Chunk>(path));
    s.onChunk((chunk, entry) => {
      const group = buildChunkGroup(chunk, entry.origin, pieces);
      chunkGroups.current.set(chunk.id, group);
      worldRef.current.add(group);
    });
    return s;
  }, [bundle.manifest, pieces]);

  const coin = useMemo(
    () => coinFor(bundle.manifest.chunks.map((c) => c.origin)),
    [bundle.manifest],
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>)['__fableton'] = { world: worldRef.current };
    }
  }, []);

  const lighting = phaseLighting(phaseIndex, theme);
  const sunRef = useRef<never>(null);
  const frustum = useMemo(() => new Frustum(), []);
  const matrix = useMemo(() => new Matrix4(), []);
  const { camera } = useThree();

  useFrame((state, dt) => {
    streamer.update(camera.position);
    // Frustum culling: whole chunks toggle, instanced meshes cull themselves.
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const visible = streamer.visible(frustum);
    for (const [id, group] of chunkGroups.current) group.visible = visible.has(id);
    // Relight toward the phase's targets — never relayout.
    const sun = sunRef.current as { intensity: number; color: Color; position: Vector3 } | null;
    if (sun) {
      sun.intensity = damp(sun.intensity, lighting.sunIntensity, dt);
      sun.color.lerp(new Color(lighting.sunColor), Math.min(1, dt * 3));
      sun.position.lerp(new Vector3(...lighting.sunPosition), Math.min(1, dt * 3));
    }
  });

  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity} />
      <directionalLight ref={sunRef} position={lighting.sunPosition} intensity={lighting.sunIntensity} color={lighting.sunColor} castShadow />
      {/* The diorama coin the world sits on */}
      <mesh position={[coin.center[0], -0.52, coin.center[1]]} scale={[coin.rx, 1, coin.rz]}>
        <cylinderGeometry args={[1, 1.06, 1, 48]} />
        <meshLambertMaterial color={new Color(theme.paletteHex[1] ?? theme.paletteHex[0]).multiplyScalar(0.55)} />
      </mesh>
      <primitive object={worldRef.current} />
      <Npcs sim={sim} manifest={bundle.manifest} info={bundle.info} theme={theme} />
      <OrbitControls
        target={[coin.center[0], 0.5, coin.center[1]]}
        enableDamping
        dampingFactor={0.08}
        minDistance={10}
        maxDistance={70}
        maxPolarAngle={1.32}
        makeDefault
      />
    </>
  );
}

function Npcs({ sim, theme }: { sim: SimState; manifest: WorldManifest; info: WorldInfo; theme: WorldTheme }): ReactElement {
  const [ids, setIds] = useState<string[]>([]);
  const [activities, setActivities] = useState<Record<string, string>>({});
  const meshes = useRef(new Map<string, Mesh>());

  useEffect(() => {
    sim.onActivity((npc, activity) => {
      setIds((prev) => (prev.includes(npc) ? prev : [...prev, npc].sort()));
      setActivities((prev) => ({ ...prev, [npc]: activity }));
    });
  }, [sim]);

  const geometry = useMemo(() => new CapsuleGeometry(0.32, 0.65, 4, 12), []);
  const hatGeometry = useMemo(() => new CylinderGeometry(0.12, 0.34, 0.3, 12), []);

  useFrame(() => {
    const now = performance.now();
    for (const id of ids) {
      const mesh = meshes.current.get(id);
      if (!mesh) continue;
      const [x, y, z] = sim.positionOf(id, now);
      mesh.position.set(x, y + 0.65, z);
      mesh.rotation.y = sim.headingOf(id);
    }
  });

  return (
    <>
      {ids.map((id) => (
        <group key={id}>
          <mesh
            ref={(m) => {
              if (m) meshes.current.set(id, m);
            }}
            geometry={geometry}
            castShadow
          >
            <meshLambertMaterial color={colorFor(id)} />
            <mesh geometry={hatGeometry} position={[0, 0.62, 0]}>
              <meshLambertMaterial color={theme.accentHex} />
            </mesh>
            {/* The ambient activity tooltip: the live tree label, verbatim */}
            <Html center distanceFactor={26} position={[0, 1.25, 0]} style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  background: 'rgba(24, 22, 20, 0.88)',
                  color: '#f3ede2',
                  fontFamily: `"${theme.mono}", ui-monospace, monospace`,
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                }}
              >
                {activities[id] ?? ''}
              </div>
            </Html>
          </mesh>
        </group>
      ))}
    </>
  );
}
