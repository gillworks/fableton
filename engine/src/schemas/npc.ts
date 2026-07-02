// SPDX-License-Identifier: Apache-2.0
//
// An NPC is lore plus a behavior tree. The inspect panel reads identity,
// story, and relationships from here; current activity comes from the live
// behavior-tree state (docs/architecture.md).
import { z } from 'zod';
import { BehaviorNodeSchema } from './behavior.js';
import { WORLD_DATA_SCHEMA_VERSION, idSlug, nonEmpty } from './common.js';

export const NpcRelationshipSchema = z.strictObject({
  to: idSlug,
  // Diegetic, viewer-facing: "rival", "owes her a story", not an enum.
  kind: nonEmpty,
});

export const NpcSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    id: idSlug,
    identity: z.strictObject({
      name: nonEmpty,
      kind: nonEmpty,
      story: nonEmpty,
    }),
    lore: z.array(idSlug),
    relationships: z.array(NpcRelationshipSchema),
    behavior: BehaviorNodeSchema,
  })
  .check((ctx) => {
    ctx.value.relationships.forEach((rel, i) => {
      if (rel.to === ctx.value.id) {
        ctx.issues.push({
          code: 'custom',
          message: `npc "${ctx.value.id}" has a relationship to itself`,
          path: ['relationships', i, 'to'],
          input: rel.to,
        });
      }
    });
  });

export type NpcRelationship = z.infer<typeof NpcRelationshipSchema>;
export type Npc = z.infer<typeof NpcSchema>;
