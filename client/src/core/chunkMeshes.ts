// SPDX-License-Identifier: Apache-2.0
//
// Chunk JSON → three objects: displaced terrain with palette vertex
// colors, GPU-instanced props (one InstancedMesh per asset sub-mesh, not
// per placement). Plain three, no React, no loaders — geometry sources
// are injected so this is testable headless.
import {
  Box3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { buildBuilding, type BuiltBuilding } from './buildings.js';
import { CHUNK_SIZE, type Chunk } from './types.js';

/** One renderable piece of a kit asset: geometry + material + its local transform. */
export interface AssetPiece {
  geometry: BufferGeometry;
  material: Material;
  local: Matrix4;
}

export function buildTerrain(chunk: Chunk): Mesh {
  const g = chunk.terrain.grid_size;
  const geometry = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, g - 1, g - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes['position']!;
  const heights = chunk.terrain.heights;
  const low = new Color(chunk.palette[0]!);
  const high = new Color(chunk.palette[1] ?? chunk.palette[0]!);
  const min = Math.min(...heights);
  const span = Math.max(0.001, Math.max(...heights) - min);
  const colors = new Float32Array(positions.count * 3);
  const shaded = new Color();
  for (let i = 0; i < positions.count; i++) {
    // PlaneGeometry orders vertices row-major, matching the heightmap.
    const h = heights[i]!;
    positions.setY(i, h);
    // Plane is centered; shift so the chunk's local frame starts at 0,0.
    positions.setX(i, positions.getX(i) + CHUNK_SIZE / 2);
    positions.setZ(i, positions.getZ(i) + CHUNK_SIZE / 2);
    shaded.lerpColors(low, high, (h - min) / span);
    colors[i * 3] = shaded.r;
    colors[i * 3 + 1] = shaded.g;
    colors[i * 3 + 2] = shaded.b;
  }
  geometry.setAttribute('color', new (positions.constructor as { new (a: Float32Array, n: number): typeof positions })(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = `terrain:${chunk.id}`;
  return mesh;
}

/**
 * GPU instancing: for each asset used by the chunk, one InstancedMesh per
 * sub-mesh of the kit model, holding every placement of that asset.
 */
export function buildPropInstances(
  chunk: Chunk,
  pieces: Map<string, AssetPiece[]>,
): InstancedMesh[] {
  const byAsset = new Map<string, Matrix4[]>();
  for (const prop of chunk.props) {
    const scale = prop.scale ?? 1;
    const transform = new Matrix4().compose(
      new Vector3(...prop.position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), prop.rotation_y ?? 0),
      new Vector3(scale, scale, scale),
    );
    const list = byAsset.get(prop.asset) ?? [];
    list.push(transform);
    byAsset.set(prop.asset, list);
  }

  const meshes: InstancedMesh[] = [];
  const scratch = new Matrix4();
  for (const [assetId, transforms] of byAsset) {
    for (const piece of pieces.get(assetId) ?? []) {
      const instanced = new InstancedMesh(piece.geometry, piece.material, transforms.length);
      transforms.forEach((t, i) => instanced.setMatrixAt(i, scratch.multiplyMatrices(t, piece.local)));
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = true;
      instanced.computeBoundingSphere();
      instanced.name = `props:${chunk.id}:${assetId}`;
      meshes.push(instanced);
    }
  }
  return meshes;
}

/** Draw calls as built: terrain + instanced sub-meshes + ~6 per building (validator parity). */
export function drawCallCount(chunk: Chunk, pieces: Map<string, AssetPiece[]>): number {
  const assets = new Set(chunk.props.map((p) => p.asset));
  let calls = 1;
  for (const id of assets) calls += (pieces.get(id) ?? []).length;
  calls += (chunk.buildings?.length ?? 0) * 6;
  return calls;
}

export interface BuiltChunk {
  group: Group;
  windowMaterials: BuiltBuilding['windowMaterials'];
}

export function buildChunkGroup(
  chunk: Chunk,
  origin: [number, number],
  pieces: Map<string, AssetPiece[]>,
): BuiltChunk {
  const group = new Group();
  group.name = `chunk:${chunk.id}`;
  group.position.set(origin[0], 0, origin[1]);
  group.add(buildTerrain(chunk));
  for (const mesh of buildPropInstances(chunk, pieces)) group.add(mesh);
  const windowMaterials: BuiltChunk['windowMaterials'] = [];
  for (const spec of chunk.buildings ?? []) {
    const built = buildBuilding(spec);
    group.add(built.group);
    windowMaterials.push(...built.windowMaterials);
  }
  return { group, windowMaterials };
}

/**
 * Some kit models keep their origin mid-body (windmill, watermill), which
 * buries them when placed at ground height. Bake a lift into each asset's
 * local matrices so its lowest vertex sits at y = 0.
 */
export function groundAssetPieces(pieces: Map<string, AssetPiece[]>): Map<string, AssetPiece[]> {
  const box = new Box3();
  const pieceBox = new Box3();
  for (const list of pieces.values()) {
    box.makeEmpty();
    for (const piece of list) {
      piece.geometry.computeBoundingBox();
      pieceBox.copy(piece.geometry.boundingBox!).applyMatrix4(piece.local);
      box.union(pieceBox);
    }
    if (box.isEmpty() || Math.abs(box.min.y) < 0.01) continue;
    const lift = new Matrix4().makeTranslation(0, -box.min.y, 0);
    for (const piece of list) piece.local = lift.clone().multiply(piece.local);
  }
  return pieces;
}

/** The diorama coin: an ellipse hugging the world's footprint. */
export function coinFor(origins: [number, number][]): { center: [number, number]; rx: number; rz: number } {
  const box = new Box3();
  for (const [x, z] of origins) {
    box.expandByPoint(new Vector3(x, 0, z));
    box.expandByPoint(new Vector3(x + CHUNK_SIZE, 0, z + CHUNK_SIZE));
  }
  const center = new Vector3();
  const size = new Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    center: [center.x, center.z],
    rx: (size.x / 2) * 1.35,
    rz: (size.z / 2) * 1.35,
  };
}
