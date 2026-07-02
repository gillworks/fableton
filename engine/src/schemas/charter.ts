// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const CHARTER_SCHEMA_VERSION = 1;

const nonEmpty = z.string().min(1);

// gate = machine-checked by the CI validation gate (matched against
// asset-registry tags); prompt = law carried in agent context, caught by
// the taste audit. Every never/taboo entry declares which it is (ADR-0001).
export const EnforcedRuleSchema = z.strictObject({
  rule: nonEmpty,
  enforced: z.enum(['gate', 'prompt']),
});

// Single root seed, uint32 so every PRNG implementation agrees on range.
// Subsystems derive named sub-seeds from it deterministically; sub-seeds
// are never authored (ADR-0001).
const seed = z.number().int().min(0).max(0xffff_ffff);

export const CharterSchema = z.strictObject({
  schema_version: z.literal(CHARTER_SCHEMA_VERSION),
  identity: z.strictObject({
    name: nonEmpty,
    premise: nonEmpty,
    seed,
  }),
  tone: z.strictObject({
    register: nonEmpty,
    pillars: z.array(nonEmpty).min(1),
  }),
  laws: z.array(nonEmpty).min(1),
  aesthetic: z.strictObject({
    theme: nonEmpty,
    palette: z.array(nonEmpty).min(1),
    typography: z.strictObject({
      display: nonEmpty,
      mono: nonEmpty,
    }),
    accent: nonEmpty,
    // Exactly 4: the client's day cycle relights on phase change (docs/design.md).
    day_phases: z.array(nonEmpty).length(4),
    architecture: nonEmpty,
    never: z.array(EnforcedRuleSchema).min(1),
  }),
  inhabitants: z.strictObject({
    kinds: nonEmpty,
    factions: nonEmpty,
    naming: nonEmpty,
  }),
  generation: z.strictObject({
    scale: nonEmpty,
    region_cadence: nonEmpty,
    caps: z.strictObject({
      max_regions: z.number().int().positive(),
      chunk_poly_budget: z.number().int().positive(),
      chunk_drawcall_budget: z.number().int().positive(),
      // Serialized chunk JSON cap in KiB — chunks are CDN-cached statics,
      // so size is a perf budget like polys (docs/v1.md). Defaulted so
      // charters authored before the gate landed still parse.
      chunk_kb_budget: z.number().int().positive().default(256),
    }),
  }),
  taboos: z.array(EnforcedRuleSchema).min(1),
  prime_directives: z.array(nonEmpty).min(1),
  amendments: z.strictObject({
    rule: nonEmpty,
  }),
});

export type Charter = z.infer<typeof CharterSchema>;
export type EnforcedRule = z.infer<typeof EnforcedRuleSchema>;
