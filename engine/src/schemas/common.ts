// SPDX-License-Identifier: Apache-2.0
//
// Shared primitives for the world-data schemas. World data is authored and
// stored as JSON (agents emit it; the charter alone is YAML-authored).
import { z } from 'zod';

// Chunk, manifest, asset-registry, NPC, and rumors documents version
// together for now; split into per-schema versions if they ever migrate
// independently.
export const WORLD_DATA_SCHEMA_VERSION = 1;

export const nonEmpty = z.string().min(1);

// Stable machine ids (chunks, assets, NPCs, nav nodes): lowercase slugs so
// they are safe as filenames, URL segments, and map keys.
export const idSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids are lowercase slugs: [a-z0-9][a-z0-9_-]*');

// Normalize free text to a slug for equality matching. ADR-0001's charter/role
// gate decides *who may* build a site (slugify(identity.kind) vs
// slugify(builder_role)); the construction runtime independently decides *who
// does*. Both MUST slugify identically, or a gate-accepted builder could
// silently never work a site with no test catching the drift — so this is the
// single shared implementation, not a per-module copy. Distinct from `idSlug`,
// which validates an already-authored id; this derives a comparison key from
// arbitrary text.
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const finite = z.number().finite();

// Local-space position, y-up, world units.
export const vec3 = z.tuple([finite, finite, finite]);

export const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'colors are lowercase #rrggbb hex');
