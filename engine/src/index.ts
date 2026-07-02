// SPDX-License-Identifier: Apache-2.0
export {
  CHARTER_SCHEMA_VERSION,
  CharterSchema,
  EnforcedRuleSchema,
  type Charter,
  type EnforcedRule,
} from './schemas/charter.js';
export {
  ARTIFACT_SCHEMA_VERSION,
  MasterPlanSchema,
  DecreeSchema,
  DecreeLogSchema,
  WorldBibleAmendmentSchema,
  appendDecree,
  type MasterPlan,
  type Decree,
  type DecreeLog,
  type WorldBibleAmendment,
} from './schemas/artifacts.js';
export { parseCharter } from './charter/parse.js';
export { migrateCharter } from './charter/migrate.js';
export {
  WORLD_DATA_SCHEMA_VERSION,
  hexColor,
  idSlug,
  vec3,
} from './schemas/common.js';
export {
  ChunkSchema,
  NavSchema,
  PropPlacementSchema,
  type Chunk,
  type Nav,
  type PropPlacement,
} from './schemas/chunk.js';
export {
  ManifestChunkSchema,
  WorldManifestSchema,
  type ManifestChunk,
  type WorldManifest,
} from './schemas/manifest.js';
export {
  AssetLicenseSchema,
  AssetRegistryEntrySchema,
  AssetRegistrySchema,
  type AssetLicense,
  type AssetRegistry,
  type AssetRegistryEntry,
} from './schemas/assets.js';
export { BehaviorNodeSchema, type BehaviorNode } from './schemas/behavior.js';
export {
  NpcRelationshipSchema,
  NpcSchema,
  type Npc,
  type NpcRelationship,
} from './schemas/npc.js';
export { validateWorld, type Violation, type WorldDocs } from './validate/validateWorld.js';
