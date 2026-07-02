// SPDX-License-Identifier: Apache-2.0
//
// Wire shapes the client consumes. The gate validates all of this before
// it ever reaches a browser, so these are plain interfaces — no runtime
// validation, no zod in the bundle.
export interface ManifestChunk {
  id: string;
  path: string;
  origin: [number, number];
  adjacent: string[];
}

export interface WorldManifest {
  world: string;
  seed: number;
  chunks: ManifestChunk[];
}

export interface PropPlacement {
  asset: string;
  position: [number, number, number];
  /** Wire JSON omits schema-defaulted fields — default at the consumer. */
  rotation_y?: number;
  scale?: number;
}

export interface Chunk {
  id: string;
  terrain: { biome: string; grid_size: number; heights: number[] };
  palette: string[];
  props: PropPlacement[];
  nav: { nodes: { id: string; position: [number, number, number] }[] };
  npcs: string[];
}

export interface RegistryAsset {
  id: string;
  path: string;
  poly_count: number;
}

export interface ThemeTokens {
  theme: string;
  palette: string[];
  accent: string;
  typography: { display: string; mono: string };
}

export interface WorldInfo {
  world: string;
  premise: string;
  seed: number;
  phases: string[];
  theme: ThemeTokens;
  chunks: number;
  npcs: number;
  clock: { tick: number; phase: string; timeOfDay: number };
}

export interface NpcSnapshot {
  id: string;
  chunk: string;
  pos: [number, number, number];
  ry: number;
  activity: string;
}

export interface SimSnapshot {
  type: 'snapshot';
  tick: number;
  phase: string;
  timeOfDay: number;
  npcs: NpcSnapshot[];
}

export interface SimDelta {
  type: 'delta';
  tick: number;
  phase?: string;
  npcs: { id: string; pos?: [number, number, number]; ry?: number; activity?: string }[];
}

export type SimMessage = SimSnapshot | SimDelta;

/** Engine grammar: world units per chunk side (matches the generator). */
export const CHUNK_SIZE = 16;
