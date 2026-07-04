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

// Weather kinds the client knows how to render (rain streaks, fog density,
// falling snow, or clear). A closed enum on purpose: a new kind is a new
// client interpreter, not just data (CLAUDE.md invariant 1) — add it here
// and in the client's weatherVfx together, via an approved issue.
export const WEATHER_KINDS = ['clear', 'rain', 'fog', 'snow'] as const;
export const WeatherKindSchema = z.enum(WEATHER_KINDS);
export type WeatherKind = (typeof WEATHER_KINDS)[number];

// One weighted entry in a season's weather table. The deterministic weather
// function draws from a season's table keyed to the world day; `weight` is
// relative. `label` is diegetic — the sim and client narrate it verbatim
// ("a steady grey rain"). `intensity` scales the client VFX (particle
// density / fog thickness / how far the scene relights toward overcast).
export const WeatherConditionSchema = z.strictObject({
  kind: WeatherKindSchema,
  label: nonEmpty,
  weight: z.number().int().positive(),
  intensity: z.number().min(0).max(1).default(0.6),
});

export const SeasonSchema = z.strictObject({
  name: nonEmpty,
  weather: z.array(WeatherConditionSchema).min(1),
});

// A temperate four-season default, so charters authored before `climate`
// existed still parse (like day_length_hours). It is deliberately generic —
// nobody's world — because a charter must never inherit another world's
// character (CLAUDE.md invariant 5); real charters override it to get their
// own weather (a desert: mostly clear, rare fog; a northern reach: snow).
const TEMPERATE_CLIMATE: {
  season_length_days: number;
  seasons: {
    name: string;
    weather: { kind: WeatherKind; label: string; weight: number; intensity: number }[];
  }[];
} = {
  season_length_days: 28,
  seasons: [
    {
      name: 'spring',
      weather: [
        { kind: 'clear', label: 'clear spring skies', weight: 5, intensity: 0 },
        { kind: 'rain', label: 'a soft spring rain', weight: 3, intensity: 0.5 },
        { kind: 'fog', label: 'a low morning mist', weight: 2, intensity: 0.4 },
      ],
    },
    {
      name: 'summer',
      weather: [
        { kind: 'clear', label: 'a bright summer day', weight: 7, intensity: 0 },
        { kind: 'rain', label: 'a passing summer shower', weight: 2, intensity: 0.6 },
        { kind: 'fog', label: 'a warm haze', weight: 1, intensity: 0.3 },
      ],
    },
    {
      name: 'autumn',
      weather: [
        { kind: 'clear', label: 'crisp autumn air', weight: 4, intensity: 0 },
        { kind: 'rain', label: 'a grey autumn drizzle', weight: 3, intensity: 0.55 },
        { kind: 'fog', label: 'a thick autumn fog', weight: 3, intensity: 0.7 },
      ],
    },
    {
      name: 'winter',
      weather: [
        { kind: 'clear', label: 'a cold clear day', weight: 3, intensity: 0 },
        { kind: 'snow', label: 'a quiet snowfall', weight: 5, intensity: 0.7 },
        { kind: 'fog', label: 'a freezing fog', weight: 2, intensity: 0.6 },
      ],
    },
  ],
};

// Climate is charter DATA: named seasons cycling in order, each a weighted
// weather table. The engine derives weather deterministically from it; it
// never special-cases a world's weather in code (CLAUDE.md invariant 1).
export const ClimateSchema = z
  .strictObject({
    // World-days per season before the cycle advances to the next.
    season_length_days: z.number().int().positive().default(28),
    seasons: z.array(SeasonSchema).min(1),
  })
  .default(TEMPERATE_CLIMATE);

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
    // How many real hours one world day lasts — the founder-tunable time
    // scale (issue #57). Default 6: the town ages 4 days per real day.
    // Defaulted so charters authored before the param existed still parse.
    day_length_hours: z.number().positive().finite().default(6),
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
  // The world's weather character. Defaulted so pre-climate charters parse.
  climate: ClimateSchema,
  taboos: z.array(EnforcedRuleSchema).min(1),
  prime_directives: z.array(nonEmpty).min(1),
  amendments: z.strictObject({
    rule: nonEmpty,
  }),
});

export type Charter = z.infer<typeof CharterSchema>;
export type EnforcedRule = z.infer<typeof EnforcedRuleSchema>;
export type WeatherCondition = z.infer<typeof WeatherConditionSchema>;
export type Season = z.infer<typeof SeasonSchema>;
export type Climate = z.infer<typeof ClimateSchema>;
