// SPDX-License-Identifier: Apache-2.0
//
// Rumors are world-DATA: a bag of diegetic sayings, each seeded at one
// resident, that spread when the sim brings people close (the interpreter
// lives in sim/gossipRuntime.ts). The engine holds only the generic spread
// mechanic — every word here comes from the world, never from engine code
// (CLAUDE.md invariant 1).
import { z } from 'zod';
import { WORLD_DATA_SCHEMA_VERSION, idSlug, nonEmpty } from './common.js';

export const RumorSchema = z.strictObject({
  id: idSlug,
  // Diegetic, viewer-facing: the line the town whispers.
  text: nonEmpty,
  // The resident who starts knowing it — the head of the "who told Greta?"
  // chain. Must resolve to a real NPC (the world gate checks this).
  origin: idSlug,
  // Notable rumors write a chronicle line on each fresh spread; quiet ones
  // still spread and show in the inspect panel, they just don't clutter the
  // chronicle.
  notable: z.boolean().default(false),
});

export const RumorsDocSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    // How close (world units) two residents must be to trade a rumor.
    spread_radius: z.number().positive().finite().default(2.5),
    // Per-tick-in-proximity chance a known rumor jumps to a neighbour who
    // hasn't heard it. The roll is seeded and world-clock keyed, so the
    // chance shapes pace without breaking determinism (invariant 3).
    spread_chance: z.number().min(0).max(1).default(0.35),
    rumors: z.array(RumorSchema),
  })
  .check((ctx) => {
    const seen = new Set<string>();
    ctx.value.rumors.forEach((rumor, i) => {
      if (seen.has(rumor.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate rumor id "${rumor.id}"`,
          path: ['rumors', i, 'id'],
          input: rumor.id,
        });
      }
      seen.add(rumor.id);
    });
  });

export type Rumor = z.infer<typeof RumorSchema>;
export type RumorsDoc = z.infer<typeof RumorsDocSchema>;
