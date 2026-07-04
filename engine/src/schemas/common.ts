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

export const finite = z.number().finite();

// Local-space position, y-up, world units.
export const vec3 = z.tuple([finite, finite, finite]);

export const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'colors are lowercase #rrggbb hex');
