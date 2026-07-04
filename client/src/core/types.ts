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

export interface Building {
  position: [number, number, number];
  rotation_y?: number;
  width: number;
  depth: number;
  height: number;
  wall_color: string;
  roof_color: string;
  windows?: number;
  chimney?: boolean;
}

export interface Chunk {
  id: string;
  terrain: { biome: string; grid_size: number; heights: number[] };
  palette: string[];
  props: PropPlacement[];
  buildings?: Building[];
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

export interface ConstructionSite {
  chunk: string;
  pr: number;
  url?: string;
}

export interface WorldInfo {
  world: string;
  premise: string;
  seed: number;
  charter_version?: number;
  /** Where the studio works — chronicle PR refs link here when set. */
  repo_url?: string;
  construction?: ConstructionSite[];
  phases: string[];
  theme?: Partial<ThemeTokens>;
  chunks: number;
  npcs: number;
  clock: { tick: number; phase: string; timeOfDay: number; day?: number };
  pace?: { ticks_per_day: number; seconds_per_day: number };
  /** The charter-defined town event in effect now (issue #62); null/absent
   *  on an ordinary day. Rendered as "Today: <event>". */
  event?: string | null;
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

/**
 * Fallback clock shape for pre-#57 worlds whose API sends no pace. Live
 * worlds override all of this via /api/world's pace (charter-tuned).
 */
export const TICKS_PER_PHASE = 600;
export const PHASES_PER_DAY = 4;
export const TICKS_PER_DAY = TICKS_PER_PHASE * PHASES_PER_DAY;
