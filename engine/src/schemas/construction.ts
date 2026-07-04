// SPDX-License-Identifier: Apache-2.0
//
// A construction site is world-data for a building that residents raise over
// time: viewers watch it climb through visible stages ("marked plot" →
// "foundation" → "frame" → "complete"), Age-of-Empires style. This file is
// the DATA MODEL only (issue #91, part 1 of the citizen-construction
// feature); the sim that spends work units, expansion planning that places
// sites, and the client that renders the stage meshes follow in separate
// issues.
//
// Invariant 1 (world is DATA): stage names, their count, the builder roles,
// and the finished building are all authored data — the engine interprets
// them and hardcodes none.
import { z } from 'zod';
import { BuildingSchema, PropPlacementSchema } from './chunk.js';
import { WORLD_DATA_SCHEMA_VERSION, finite, idSlug, nonEmpty } from './common.js';

// A rectangular ground footprint, chunk-local. Width runs along local x,
// depth along local z before rotation_y is applied; the site's `position` is
// the footprint centre. The gate checks this rectangle against the chunk's
// nav-lite graph so a building never buries a walkway it can't spare.
export const FootprintSchema = z.strictObject({
  width: z.number().positive().finite(),
  depth: z.number().positive().finite(),
});

// One rung of the ladder a site climbs. `name` is diegetic and viewer-facing
// (the client narrates it verbatim, invariant 4). What the stage LOOKS like
// is exactly one of:
//   - `asset`: a kit mesh shown while the site sits at this stage, or
//   - `rise` (issue #117): the site's completion buildings rendered rising —
//     bare walls at this fraction of their final height, so a house under
//     construction looks like a house going up, not a prop.
// `work_units` is the effort required to advance OUT of this stage into the
// next — a positive integer the sim decrements against; the last stage's
// work_units is what it costs to finish the build and swap in the
// completion payload.
export const ConstructionStageSchema = z
  .strictObject({
    name: nonEmpty,
    asset: idSlug.optional(),
    rise: z.number().gt(0).lte(1).optional(),
    work_units: z.number().int().positive(),
  })
  .check((ctx) => {
    if ((ctx.value.asset === undefined) === (ctx.value.rise === undefined)) {
      ctx.issues.push({
        code: 'custom',
        message: 'a stage shows exactly one of `asset` (kit mesh) or `rise` (completion buildings at partial height)',
        path: ['asset'],
        input: ctx.value,
      });
    }
  });

// What the finished site becomes: ordinary chunk-data (parametric buildings
// and/or placed props, reusing the chunk schema's own types — no new render
// primitive). Positions are chunk-local, in the same frame as the target
// chunk, so the payload drops straight in.
//
// EP DESIGN DECISION (persistence) — see the PR: whether the sim writes this
// payload back into the static chunk file or applies it as a dynamic overlay
// layer is the sim's call, made in a later issue. The schema is deliberately
// agnostic: the site CARRIES its final chunk-data either way, so neither path
// needs a schema change.
export const CompletionSchema = z
  .strictObject({
    buildings: z.array(BuildingSchema).default([]),
    props: z.array(PropPlacementSchema).default([]),
  })
  .check((ctx) => {
    if (ctx.value.buildings.length === 0 && ctx.value.props.length === 0) {
      ctx.issues.push({
        code: 'custom',
        message: 'completion payload is empty: a finished site must become at least one building or prop',
        path: ['buildings'],
        input: ctx.value,
      });
    }
  });

export const ConstructionSiteSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    id: idSlug,
    // The chunk this site rises in; `position`/`completion` are in that
    // chunk's local frame. The gate resolves this against the manifest.
    chunk: idSlug,
    // Footprint centre, chunk-local, y = ground height.
    position: z.tuple([finite, finite, finite]),
    rotation_y: finite.default(0),
    footprint: FootprintSchema,
    // Which resident roles may work here. Roles are reused from NPC data
    // (`identity.kind`), not a duplicated enum (invariant 1) — the gate
    // resolves each against the world's NPCs by slug equality, the same
    // matching the charter gate rules use (ADR-0001).
    builder_roles: z.array(nonEmpty).min(1),
    // Ordered low → high: the site climbs stages[0] → … → stages[n-1].
    stages: z.array(ConstructionStageSchema).min(1),
    completion: CompletionSchema,
  })
  .check((ctx) => {
    const seen = new Set<string>();
    ctx.value.stages.forEach((stage, i) => {
      // A rising stage renders the completion buildings — there must be some.
      if (stage.rise !== undefined && ctx.value.completion.buildings.length === 0) {
        ctx.issues.push({
          code: 'custom',
          message: `stage "${stage.name}" uses \`rise\` but the completion has no buildings to raise`,
          path: ['stages', i, 'rise'],
          input: stage.rise,
        });
      }
      const slug = stage.name.toLowerCase().trim();
      if (seen.has(slug)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate stage name "${stage.name}"`,
          path: ['stages', i, 'name'],
          input: stage.name,
        });
      }
      seen.add(slug);
    });
    // Builder roles are a set, not a list: a role listed twice is almost
    // certainly an authoring slip and would double-count downstream.
    const roles = new Set<string>();
    ctx.value.builder_roles.forEach((role, i) => {
      const slug = role.toLowerCase().trim();
      if (roles.has(slug)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate builder role "${role}"`,
          path: ['builder_roles', i],
          input: role,
        });
      }
      roles.add(slug);
    });
  });

export type Footprint = z.infer<typeof FootprintSchema>;
export type ConstructionStage = z.infer<typeof ConstructionStageSchema>;
export type Completion = z.infer<typeof CompletionSchema>;
export type ConstructionSite = z.infer<typeof ConstructionSiteSchema>;
