// SPDX-License-Identifier: Apache-2.0
//
// Divine artifacts — durable, versioned files the god produces (ADR-0001,
// docs/architecture.md). The charter itself is immutable; these are the
// mutable world-state documents that sit beside it: master plan (rolling),
// decrees (append-only), world-bible amendments.
import { z } from 'zod';

export const ARTIFACT_SCHEMA_VERSION = 1;

const nonEmpty = z.string().min(1);
const issued = z.iso.datetime();

export const MasterPlanSchema = z.strictObject({
  schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
  kind: z.literal('master-plan'),
  world: nonEmpty,
  // Rolling document: each god session that revises it bumps revision.
  revision: z.number().int().positive(),
  issued,
  horizon: nonEmpty,
  goals: z.array(nonEmpty).min(1),
});

export const DecreeSchema = z.strictObject({
  seq: z.number().int().positive(),
  issued,
  title: nonEmpty,
  text: nonEmpty,
});

export const DecreeLogSchema = z
  .strictObject({
    schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
    kind: z.literal('decree-log'),
    world: nonEmpty,
    decrees: z.array(DecreeSchema),
  })
  .check((ctx) => {
    // Append-only: seq is dense and 1-based, so any edit or deletion in
    // history is a validation failure, not just a diff-review smell.
    ctx.value.decrees.forEach((decree, i) => {
      if (decree.seq !== i + 1) {
        ctx.issues.push({
          code: 'custom',
          message: `decree at index ${i} has seq ${decree.seq}, expected ${i + 1} (the log is append-only and strictly sequential)`,
          path: ['decrees', i, 'seq'],
          input: decree.seq,
        });
      }
    });
  });

export const WorldBibleAmendmentSchema = z.strictObject({
  schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
  kind: z.literal('world-bible-amendment'),
  world: nonEmpty,
  seq: z.number().int().positive(),
  issued,
  section: nonEmpty,
  change: nonEmpty,
  rationale: nonEmpty.optional(),
});

export type MasterPlan = z.infer<typeof MasterPlanSchema>;
export type Decree = z.infer<typeof DecreeSchema>;
export type DecreeLog = z.infer<typeof DecreeLogSchema>;
export type WorldBibleAmendment = z.infer<typeof WorldBibleAmendmentSchema>;

export function appendDecree(log: DecreeLog, decree: Omit<Decree, 'seq'>): DecreeLog {
  return DecreeLogSchema.parse({
    ...log,
    decrees: [...log.decrees, { ...decree, seq: log.decrees.length + 1 }],
  });
}
