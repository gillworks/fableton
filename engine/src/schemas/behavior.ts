// SPDX-License-Identifier: Apache-2.0
//
// Behavior trees are world-data the Tier-0 runtime interprets every frame
// (ADR-0001, docs/architecture.md). Every node carries a diegetic,
// human-readable label — the inspect panel reads the active node's label
// as the NPC's current activity, so an unlabeled node is a schema error,
// not a style nit.
//
// v1 ambient-life node set: schedule (branch by day phase), sequence (the
// one composite), and the leaves move / interact / idle.
import { z } from 'zod';
import { finite, idSlug, nonEmpty } from './common.js';

export type BehaviorNode =
  | { type: 'schedule'; label: string; entries: { phase: string; child: BehaviorNode }[] }
  | { type: 'sequence'; label: string; children: BehaviorNode[] }
  | { type: 'move'; label: string; to: string }
  | { type: 'interact'; label: string; with: string; duration_s: number }
  | { type: 'idle'; label: string; duration_s: number };

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
  ]),
);
