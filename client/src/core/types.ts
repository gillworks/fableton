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

/**
 * A studio PR rendered in-world as a construction marker (docs/design.md,
 * "the studio, visible in-world"): engine chrome, same in every world, links
 * to the open PR. Distinct from the citizen-construction sites below — this is
 * the world's makers made visible, not a building the residents raise.
 */
export interface ConstructionSite {
  chunk: string;
  pr: number;
  url?: string;
}

/** One rung of a construction site's stage ladder: its diegetic name and the
 *  asset-registry mesh shown while the site sits at that stage (issue #99). */
export interface ConstructionStageRef {
  name: string;
  asset: string;
}

/**
 * A citizen-construction site's live state, as the sim broadcasts it (the
 * snapshot on connect, stage-change deltas thereafter). Mirrors the engine's
 * ConstructionSiteState. Progress and workers ride the snapshot but NOT the
 * per-tick delta (compact by construction) — the inspect panel polls
 * /api/construction for those.
 */
export interface ConstructionSiteState {
  id: string;
  chunk: string;
  /** Diegetic name of the stage the site currently sits at. */
  stage: string;
  /** Stage the site has climbed to; equals stageCount once complete. */
  stageIndex: number;
  stageCount: number;
  /** Work accrued toward advancing out of the current stage. */
  progress: number;
  /** Work needed to advance out of the current stage (0 once complete). */
  required: number;
  /** Resident ids working the site right now. */
  workers: string[];
  complete: boolean;
}

/**
 * A site's live state paired with its static definition, as /api/construction
 * serves it (issue #99): everything the client needs to place the site, swap
 * in the mesh for the stage it has reached, and stand the finished building.
 */
export interface ConstructionSiteView extends ConstructionSiteState {
  /** Footprint centre, chunk-local — add the chunk origin for world space. */
  position: [number, number, number];
  rotation_y: number;
  /** The stage ladder, low → high — the client maps stageIndex to a mesh. */
  stages: ConstructionStageRef[];
  /** What the finished site becomes: ordinary chunk-data. */
  completion: { buildings: Building[]; props: PropPlacement[] };
}

/**
 * A citizen-construction site changed stage (or finished) this tick — the
 * compact delta the sim socket carries. Last-writer-wins per id.
 */
export interface ConstructionDelta {
  id: string;
  stage: string;
  stageIndex: number;
  done?: boolean;
}

export interface WorldInfo {
  world: string;
  premise: string;
  seed: number;
  charter_version?: number;
  /** Where the studio works — chronicle PR refs link here when set. */
  repo_url?: string;
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

/** What the client renders. Mirrors the engine's WEATHER_KINDS. */
export type WeatherKind = 'clear' | 'rain' | 'fog' | 'snow';

export interface WeatherState {
  season: string;
  kind: WeatherKind;
  /** Diegetic — shown verbatim by the HUD clock (see Hud.tsx). */
  label: string;
  /** VFX strength 0..1. */
  intensity: number;
}

export interface SimSnapshot {
  type: 'snapshot';
  tick: number;
  phase: string;
  timeOfDay: number;
  /** Optional so pre-weather worlds still parse; the sim always sends it. */
  weather?: WeatherState;
  npcs: NpcSnapshot[];
  /** Live construction sites: stage, progress, workers. Optional so
   *  pre-construction worlds still parse. */
  construction?: ConstructionSiteState[];
}

export interface SimDelta {
  type: 'delta';
  tick: number;
  phase?: string;
  /** Present only on the tick the weather turns. */
  weather?: WeatherState;
  npcs: { id: string; pos?: [number, number, number]; ry?: number; activity?: string }[];
  /** Present only on ticks a site changes stage or completes. */
  construction?: ConstructionDelta[];
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
