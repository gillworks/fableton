// SPDX-License-Identifier: Apache-2.0
//
// An expansion plan is world-data for HOW A TOWN GROWS: an ordered queue of
// planned buildings the sim opens over time. Each entry carries a full
// construction_site payload (the thing that gets raised — reused verbatim from
// the construction schema, issue #91) plus the prerequisites that gate when it
// opens ("day ≥ N", "an earlier site is complete"). This file is part 3 of the
// citizen-construction feature (issue #95): the DATA MODEL for the queue. The
// sim that consumes it (ExpansionRuntime) and the gate that validates the
// pre-placed sites statically live alongside.
//
// Invariant 1 (world is DATA): the engine never hardcodes what a town builds
// or in what order. The plan is authored data — generated at world-birth or
// extended by a steward PR through the gate; the sim only interprets it.
// Invariant 3 (determinism): prerequisites are pure functions of world day and
// which sites have completed, so `plan → identical opening sequence` on every
// machine.
import { z } from 'zod';
import { ConstructionSiteSchema } from './construction.js';
import { WORLD_DATA_SCHEMA_VERSION, idSlug } from './common.js';

// A gate on when a queued site opens. Two shapes, discriminated on `type`:
//   - day: the world day (1-based, matching the sim clock) has reached min_day.
//   - site_complete: a named earlier site in this plan has finished building.
// Both are pure and monotonic — once satisfied they stay satisfied, so plan
// consumption never oscillates.
export const DayPrerequisiteSchema = z.strictObject({
  type: z.literal('day'),
  // 1-based world day; min_day 1 opens on the world's first day.
  min_day: z.number().int().positive(),
});

export const SiteCompletePrerequisiteSchema = z.strictObject({
  type: z.literal('site_complete'),
  // The id of another site in this plan (validated to be an EARLIER entry).
  site: idSlug,
});

export const PrerequisiteSchema = z.discriminatedUnion('type', [
  DayPrerequisiteSchema,
  SiteCompletePrerequisiteSchema,
]);

// One rung of the growth queue: the site to raise, and the conditions that
// must all hold before ground breaks. An entry with no prerequisites opens on
// day one — that is how a starter plan puts scaffolding on screen immediately.
export const ExpansionEntrySchema = z.strictObject({
  site: ConstructionSiteSchema,
  prerequisites: z.array(PrerequisiteSchema).default([]),
});

export const ExpansionPlanSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    id: idSlug,
    // Ordered: earlier entries are raised (or become raisable) first, and a
    // site_complete prerequisite may only look BACKWARD in this list. That
    // ordering makes the dependency graph a DAG by construction — the queue
    // can always be consumed to completion, never deadlocked on a cycle.
    queue: z.array(ExpansionEntrySchema).min(1),
  })
  .check((ctx) => {
    // Site ids identify a build across the plan; a repeat is an authoring slip
    // that would make site_complete references ambiguous.
    const indexById = new Map<string, number>();
    ctx.value.queue.forEach((entry, i) => {
      const id = entry.site.id;
      if (indexById.has(id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate site id "${id}" in the expansion queue`,
          path: ['queue', i, 'site', 'id'],
          input: id,
        });
      } else {
        indexById.set(id, i);
      }
    });
    // A site_complete prerequisite must name an EARLIER site in the queue.
    // Forward or self references would be undefined (nothing has run yet) or
    // circular (a site waiting on itself); rejecting them keeps consumption a
    // terminating, deterministic sweep.
    ctx.value.queue.forEach((entry, i) => {
      entry.prerequisites.forEach((prereq, j) => {
        if (prereq.type !== 'site_complete') return;
        const dep = indexById.get(prereq.site);
        if (dep === undefined) {
          ctx.issues.push({
            code: 'custom',
            message: `prerequisite site_complete references unknown site "${prereq.site}" (no such entry in this plan)`,
            path: ['queue', i, 'prerequisites', j, 'site'],
            input: prereq.site,
          });
        } else if (dep >= i) {
          ctx.issues.push({
            code: 'custom',
            message: `prerequisite site_complete references "${prereq.site}", which is not an earlier entry in the queue (a site cannot wait on itself or a later build)`,
            path: ['queue', i, 'prerequisites', j, 'site'],
            input: prereq.site,
          });
        }
      });
    });
  });

export type DayPrerequisite = z.infer<typeof DayPrerequisiteSchema>;
export type SiteCompletePrerequisite = z.infer<typeof SiteCompletePrerequisiteSchema>;
export type Prerequisite = z.infer<typeof PrerequisiteSchema>;
export type ExpansionEntry = z.infer<typeof ExpansionEntrySchema>;
export type ExpansionPlan = z.infer<typeof ExpansionPlanSchema>;
