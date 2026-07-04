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
  FogExp2,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  CylinderGeometry,
  Vector3,
} from 'three';
import { OVERLAY_Z_RANGE } from '../core/hud.js';
import { colorFor } from '@fableton/engine/color';
import type { AssetPiece } from '../core/chunkMeshes.js';
import { ConstructionMarker } from './ConstructionMarker.js';
import type { ConstructionSite } from '../core/types.js';
import { buildChunkGroup, coinFor } from '../core/chunkMeshes.js';
import type { SimState } from '../core/interpolator.js';
import { ChunkStreamer } from '../core/streamer.js';
import { phaseLighting, type WorldTheme } from '../core/theme.js';
import { WeatherField, weatherVfx } from '../core/weatherVfx.js';
import { fetchChunk, type WorldBundle } from '../core/loadWorld.js';
import type { Chunk, WeatherState } from '../core/types.js';
import { DEFAULT_FOLLOW, followStep, type FollowCam } from '../core/follow.js';

export interface WorldSceneProps {
  bundle: WorldBundle;
  pieces: Map<string, AssetPiece[]>;
  sim: SimState;
  theme: WorldTheme;
  phaseIndex: number;
  onSelect: (npcId: string) => void;
  construction: ConstructionSite[];
  /** The resident the camera is following, or null for explore. */
  follow: string | null;
  /** The day's weather, or null before the first snapshot / on old worlds. */
  weather: WeatherState | null;
}

const damp = (from: number, to: number, dt: number): number =>
  from + (to - from) * Math.min(1, dt * 3);

// Per-frame scratch: reused via .set() so the useFrame relight loop allocates
// no Color/Vector3 each frame (this is a hot path — keep it GC-quiet).
const _sunColor = new Color();
const _sunPos = new Vector3();
const _fogColor = new Color();

export function WorldScene({ bundle, pieces, sim, theme, phaseIndex, onSelect, construction, follow, weather }: WorldSceneProps): ReactElement {
  const worldRef = useRef<Group>(new Group());
  const chunkGroups = useRef(new Map<string, Group>());
  const windowMaterials = useRef<import('../core/buildings.js').BuiltBuilding['windowMaterials']>([]);
  const streamer = useMemo(() => {
    const s = new ChunkStreamer(bundle.manifest, (path) => fetchChunk<Chunk>(path));
    s.onChunk((chunk, entry) => {
      const built = buildChunkGroup(chunk, entry.origin, pieces);
      chunkGroups.current.set(chunk.id, built.group);
      windowMaterials.current.push(...built.windowMaterials);
      worldRef.current.add(built.group);
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
  const vfx = weatherVfx(weather);
  const sunRef = useRef<never>(null);
  const ambientRef = useRef<never>(null);
  const frustum = useMemo(() => new Frustum(), []);
  const matrix = useMemo(() => new Matrix4(), []);
  const { camera, scene } = useThree();

  // A single exponential fog and a single precipitation field, both driven
  // by the weather. The field is one draw call (core/weatherVfx), so it
  // never threatens the charter's draw-call budget.
  const fog = useMemo(() => new FogExp2(0xffffff, 0), []);
  const weatherField = useMemo(() => new WeatherField(), []);
  useEffect(() => {
    scene.fog = fog;
    scene.add(weatherField.points);
    return () => {
      if (scene.fog === fog) scene.fog = null;
      scene.remove(weatherField.points);
      weatherField.dispose();
    };
  }, [scene, fog, weatherField]);

  useFrame((state, dt) => {
    streamer.update(camera.position);
    // Frustum culling: whole chunks toggle, instanced meshes cull themselves.
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const visible = streamer.visible(frustum);
    for (const [id, group] of chunkGroups.current) group.visible = visible.has(id);
    // Relight toward the phase's targets — never relayout. Windows glow
    // as the lamps come on.
    for (const material of windowMaterials.current) {
      material.emissiveIntensity = damp(material.emissiveIntensity, lighting.windowGlow, dt);
    }
    // Weather relights on top of the phase: overcast dims the sun and
    // flattens shadow; the phase still owns the hue and the sun's arc.
    const sun = sunRef.current as { intensity: number; color: Color; position: Vector3 } | null;
    if (sun) {
      sun.intensity = damp(sun.intensity, lighting.sunIntensity * vfx.sunFactor, dt);
      sun.color.lerp(_sunColor.set(lighting.sunColor), Math.min(1, dt * 3));
      sun.position.lerp(_sunPos.set(...lighting.sunPosition), Math.min(1, dt * 3));
    }
    const ambient = ambientRef.current as { intensity: number } | null;
    if (ambient) {
      ambient.intensity = damp(ambient.intensity, lighting.ambientIntensity * vfx.ambientFactor, dt);
    }
    // Fog eases toward the phase's fog color at the weather's density, so
    // rolling fog thickens smoothly rather than snapping in.
    fog.color.lerp(_fogColor.set(lighting.fogColor), Math.min(1, dt * 3));
    fog.density = damp(fog.density, vfx.fogDensity, dt);
    weatherField.update(dt, vfx, [camera.position.x, 0, camera.position.z]);
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={lighting.ambientIntensity} />
      <directionalLight ref={sunRef} position={lighting.sunPosition} intensity={lighting.sunIntensity} color={lighting.sunColor} castShadow />
      {/* The diorama coin the world sits on */}
      <mesh position={[coin.center[0], -0.52, coin.center[1]]} scale={[coin.rx, 1, coin.rz]}>
        <cylinderGeometry args={[1, 1.06, 1, 48]} />
        <meshLambertMaterial color={new Color(theme.paletteHex[1] ?? theme.paletteHex[0]).multiplyScalar(0.55)} />
      </mesh>
      <primitive object={worldRef.current} />
      <Npcs sim={sim} theme={theme} onSelect={onSelect} />
      {construction.map((site) => {
        const entry = bundle.manifest.chunks.find((c) => c.id === site.chunk);
        return entry ? <ConstructionMarker key={site.chunk + site.pr} site={site} origin={entry.origin} /> : null;
      })}
      {follow ? (
        // Follow mode drives the camera itself; OrbitControls would fight
        // it, so it steps aside until the viewer exits follow (#80).
        <FollowCamera key={follow} sim={sim} follow={follow} />
      ) : (
        <OrbitControls
          target={[coin.center[0], 0.5, coin.center[1]]}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.5}
          // Zoom out far enough to frame the whole diorama, however big
          // the world grows.
          maxDistance={Math.max(70, Math.max(coin.rx, coin.rz) * 2.6)}
          // Street level: tilt to just above horizontal, so the viewer can
          // stand among the houses (#73). The coin hides the void below.
          maxPolarAngle={1.53}
          makeDefault
        />
      )}
    </>
  );
}

/**
 * Drives the camera to trail the followed resident through their day. The
 * pose math is pure (core/follow); this component only reads the live
 * position each frame and writes it onto the camera. Does nothing until
 * the resident has streamed in — so a deep link to someone not yet
 * broadcast just holds the explore framing until they appear.
 */
function FollowCamera({ sim, follow }: { sim: SimState; follow: string }): null {
  const { camera } = useThree();
  const cam = useRef<FollowCam | null>(null);

  useFrame((_, dt) => {
    if (!sim.has(follow)) return;
    const now = performance.now();
    const pos = sim.positionOf(follow, now);
    if (!cam.current) {
      // Seed from wherever the explore camera left off, so the handoff
      // eases in rather than snapping.
      cam.current = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [pos[0], pos[1] + DEFAULT_FOLLOW.lookHeight, pos[2]],
      };
    }
    cam.current = followStep(cam.current, pos, sim.headingOf(follow), dt);
    const { position, target } = cam.current;
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
  });

  return null;
}

function Npcs({ sim, theme, onSelect }: { sim: SimState; theme: WorldTheme; onSelect: (id: string) => void }): ReactElement {
  const [ids, setIds] = useState<string[]>([]);
  const [activities, setActivities] = useState<Record<string, string>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const meshes = useRef(new Map<string, Mesh>());

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

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
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(id);
            }}
            onPointerOut={() => setHovered((h) => (h === id ? null : h))}
          >
            <meshLambertMaterial color={colorFor(id)} />
            <mesh geometry={hatGeometry} position={[0, 0.62, 0]}>
              <meshLambertMaterial color={theme.accentHex} />
            </mesh>
            {/* The ambient activity tooltip: the live tree label, verbatim */}
            <Html center distanceFactor={26} position={[0, 1.25, 0]} zIndexRange={OVERLAY_Z_RANGE} style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  background: 'rgba(24, 22, 20, 0.88)',
                  color: '#f3ede2',
                  fontFamily: `"${theme.mono}", ui-monospace, monospace`,
                  fontSize: 16,
                  padding: '4px 11px',
                  borderRadius: 10,
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
