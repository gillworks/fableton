// SPDX-License-Identifier: Apache-2.0
//
// Behavior trees are world-data the Tier-0 runtime interprets every frame
// (ADR-0001, docs/architecture.md). Every node carries a diegetic,
// human-readable label — the inspect panel reads the active node's label
// as the NPC's current activity, so an unlabeled node is a schema error,
// not a style nit.
//
// v1 ambient-life node set: schedule (branch by day phase), sequence (the
// one composite), and the leaves move / interact / idle. on_event adds the
// town-calendar branch (issue #62): gather for a festival, otherwise carry on.
import { z } from 'zod';
import { WeatherKindSchema, type WeatherKind } from './charter.js';
import { finite, idSlug, nonEmpty } from './common.js';

export type BehaviorNode =
  | { type: 'schedule'; label: string; entries: { phase: string; child: BehaviorNode }[] }
  | {
      type: 'weather';
      label: string;
      entries: { kind: WeatherKind; child: BehaviorNode }[];
      fallback?: BehaviorNode | undefined;
    }
  | { type: 'on_event'; label: string; event: string; child: BehaviorNode; otherwise?: BehaviorNode | undefined }
  | { type: 'sequence'; label: string; children: BehaviorNode[] }
  | { type: 'move'; label: string; to: string }
  | { type: 'interact'; label: string; with: string; duration_s: number }
  | { type: 'idle'; label: string; duration_s: number }
  | { type: 'wander'; label: string; radius: number; min_pause_s: number; max_pause_s: number };

const label = nonEmpty;
const duration_s = z.number().positive().finite();

export const BehaviorNodeSchema: z.ZodType<BehaviorNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('schedule'),
      label,
      // Phases name the charter's aesthetic.day_phases; the runtime picks
      // the entry matching the world clock.
      entries: z
        .array(z.strictObject({ phase: nonEmpty, child: BehaviorNodeSchema }))
        .min(1),
    }),
    // Branch on the day's weather (deterministic, sim/weather.ts). The
    // runtime picks the entry matching the current weather kind, else the
    // fallback. Labels stay diegetic — "waiting out the rain under the
    // awning" — so the inspect panel reads the branch as narration.
    z.strictObject({
      type: z.literal('weather'),
      label,
      entries: z
        .array(z.strictObject({ kind: WeatherKindSchema, child: BehaviorNodeSchema }))
        .min(1),
      fallback: z.optional(BehaviorNodeSchema),
    }),
    z.strictObject({
      type: z.literal('on_event'),
      label,
      // A charter calendar event name to gather for; '*' matches whatever
      // event is in effect. The runtime runs `child` while that event is
      // active and `otherwise` (if given) the rest of the time.
      event: nonEmpty,
      child: BehaviorNodeSchema,
      otherwise: BehaviorNodeSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('sequence'),
      label,
      children: z.array(BehaviorNodeSchema).min(1),
    }),
    z.strictObject({
      type: z.literal('move'),
      label,
      // A nav node id (chunk-local walk graph).
      to: idSlug,
    }),
    z.strictObject({
      type: z.literal('interact'),
      label,
      // A prop asset placement or NPC to interact with.
      with: idSlug,
      duration_s,
    }),
    z.strictObject({
      type: z.literal('idle'),
      label,
      duration_s,
    }),
    // Ambient drift: pick a seeded-random point nearby, walk there, pause a
    // seeded-random while, repeat. Randomness comes from the sim's PRNG —
    // deterministic, per-NPC (CLAUDE.md invariant 3).
    z.strictObject({
      type: z.literal('wander'),
      label,
      radius: z.number().positive().finite().default(5),
      min_pause_s: z.number().positive().finite().default(2),
      max_pause_s: z.number().positive().finite().default(10),
    }),
  ]),
);
