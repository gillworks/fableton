// SPDX-License-Identifier: Apache-2.0
//
// Deterministic weather: a pure function of (charter, world day). The day
// comes from the tick-derived world clock (clock.ts), never wall time, so
// the same charter + seed + world day yields identical weather on every
// machine (CLAUDE.md invariant 3 — no Date.now()/Math.random()). Climate is
// charter DATA (charter.climate); this only interprets it (invariant 1).
import type { Charter, WeatherKind } from '../schemas/charter.js';
import { deriveSeed, mulberry32 } from '../generate/rng.js';

export interface WeatherState {
  /** The active season's charter-authored name. */
  season: string;
  /** What the client renders: clear | rain | fog | snow. */
  kind: WeatherKind;
  /** Diegetic — narrated verbatim by the client and inspect panel. */
  label: string;
  /** VFX strength 0..1. */
  intensity: number;
}

/**
 * The weather for a given 1-based world day. Seasons cycle in the charter's
 * order every `season_length_days`; within a season, one deterministic
 * weighted draw picks the day's weather. Keyed to the day so a redeploy
 * lands on the same weather it left (like the clock's derived day count).
 */
export function weatherAt(charter: Charter, day: number): WeatherState {
  const { season_length_days, seasons } = charter.climate;
  const d = Math.max(1, Math.floor(day));
  const seasonIndex = Math.floor((d - 1) / season_length_days) % seasons.length;
  const season = seasons[seasonIndex]!;
  const table = season.weather;
  const total = table.reduce((sum, c) => sum + c.weight, 0);
  // One draw per day from a sub-seed named for the day — an independent
  // stream, so adding weather never shifts another subsystem's sequence
  // (ADR-0001 named sub-seeds).
  const rng = mulberry32(deriveSeed(charter.identity.seed, `weather:day:${d}`));
  let roll = rng() * total;
  for (const condition of table) {
    roll -= condition.weight;
    if (roll < 0) {
      return {
        season: season.name,
        kind: condition.kind,
        label: condition.label,
        intensity: condition.intensity,
      };
    }
  }
  // Float slack only: the loop exits above for any finite roll < total.
  const last = table[table.length - 1]!;
  return { season: season.name, kind: last.kind, label: last.label, intensity: last.intensity };
}
