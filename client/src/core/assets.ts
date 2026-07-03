// SPDX-License-Identifier: Apache-2.0
//
// Kit loading (browser-only — GLTFLoader needs fetch/decoders). Each GLB
// is loaded once and decomposed into AssetPieces for instancing.
import { Matrix4, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { groundAssetPieces, type AssetPiece } from './chunkMeshes.js';
import type { RegistryAsset } from './types.js';

export async function loadAssetPieces(
  assets: RegistryAsset[],
): Promise<Map<string, AssetPiece[]>> {
  const loader = new GLTFLoader();
  const out = new Map<string, AssetPiece[]>();
  await Promise.all(
    assets.map(async (asset) => {
      const gltf = await loader.loadAsync(`/${asset.path}`);
      gltf.scene.updateMatrixWorld(true);
      const pieces: AssetPiece[] = [];
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh) {
          pieces.push({
            geometry: node.geometry,
            material: node.material,
            local: new Matrix4().copy(node.matrixWorld),
          });
        }
      });
      out.set(asset.id, pieces);
    }),
  );
  return groundAssetPieces(out);
}
