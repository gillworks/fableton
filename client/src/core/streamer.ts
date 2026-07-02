// SPDX-License-Identifier: Apache-2.0
//
// Chunk streaming + culling, out of React per ADR-0002: nearest chunks
// fetch first, loaded chunks report visibility against the camera
// frustum so the render layer can toggle groups.
import { Box3, Vector3, type Frustum } from 'three';
import { CHUNK_SIZE, type Chunk, type ManifestChunk, type WorldManifest } from './types.js';

const MAX_CONCURRENT_FETCHES = 2;
const TERRAIN_HEIGHT_ALLOWANCE = 6;

export class ChunkStreamer {
  #manifest: WorldManifest;
  #fetchChunk: (path: string) => Promise<Chunk>;
  #pending = new Set<string>();
  #queued: ManifestChunk[] = [];
  loaded = new Map<string, Chunk>();
  #listeners: ((chunk: Chunk, entry: ManifestChunk) => void)[] = [];
  #bounds = new Map<string, Box3>();

  constructor(manifest: WorldManifest, fetchChunk: (path: string) => Promise<Chunk>) {
    this.#manifest = manifest;
    this.#fetchChunk = fetchChunk;
    for (const entry of manifest.chunks) {
      this.#bounds.set(
        entry.id,
        new Box3(
          new Vector3(entry.origin[0], -1, entry.origin[1]),
          new Vector3(entry.origin[0] + CHUNK_SIZE, TERRAIN_HEIGHT_ALLOWANCE, entry.origin[1] + CHUNK_SIZE),
        ),
      );
    }
  }

  onChunk(cb: (chunk: Chunk, entry: ManifestChunk) => void): void {
    this.#listeners.push(cb);
  }

  /** Nearest-first load order — the streaming priority. */
  priority(cameraPos: Vector3): ManifestChunk[] {
    const center = (entry: ManifestChunk): Vector3 =>
      new Vector3(entry.origin[0] + CHUNK_SIZE / 2, 0, entry.origin[1] + CHUNK_SIZE / 2);
    return [...this.#manifest.chunks].sort(
      (a, b) => center(a).distanceToSquared(cameraPos) - center(b).distanceToSquared(cameraPos),
    );
  }

  /** Kick fetches (nearest first, bounded concurrency). Call per frame; cheap when idle. */
  update(cameraPos: Vector3): void {
    if (this.loaded.size + this.#pending.size >= this.#manifest.chunks.length) return;
    this.#queued = this.priority(cameraPos).filter(
      (e) => !this.loaded.has(e.id) && !this.#pending.has(e.id),
    );
    while (this.#pending.size < MAX_CONCURRENT_FETCHES && this.#queued.length > 0) {
      const entry = this.#queued.shift()!;
      this.#pending.add(entry.id);
      this.#fetchChunk(entry.path)
        .then((chunk) => {
          this.loaded.set(entry.id, chunk);
          for (const cb of this.#listeners) cb(chunk, entry);
        })
        .catch((e) => console.error(`chunk ${entry.id} failed to load`, e))
        .finally(() => this.#pending.delete(entry.id));
    }
  }

  /** Which loaded chunks intersect the frustum — frustum culling per chunk. */
  visible(frustum: Frustum): Set<string> {
    const out = new Set<string>();
    for (const id of this.loaded.keys()) {
      if (frustum.intersectsBox(this.#bounds.get(id)!)) out.add(id);
    }
    return out;
  }
}
