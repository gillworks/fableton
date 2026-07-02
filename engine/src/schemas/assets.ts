// SPDX-License-Identifier: Apache-2.0
//
// The asset registry: every mesh a chunk may place, with license
// provenance (tracked from day one — docs/v1.md) and tags. Tags are what
// gate-enforced charter rules (aesthetic.never / taboos) match against.
import { z } from 'zod';
import { WORLD_DATA_SCHEMA_VERSION, idSlug, nonEmpty } from './common.js';

export const AssetLicenseSchema = z.strictObject({
  // SPDX identifier where one exists (e.g. CC0-1.0), license name otherwise.
  id: nonEmpty,
  // Where the asset came from: kit name, store page, or URL.
  source: nonEmpty,
  attribution: nonEmpty.optional(),
});

export const AssetRegistryEntrySchema = z.strictObject({
  id: idSlug,
  name: nonEmpty,
  path: nonEmpty,
  // Triangle count of the mesh; the CI gate sums placements against
  // charter generation.caps.chunk_poly_budget.
  poly_count: z.number().int().positive(),
  tags: z.array(nonEmpty),
  license: AssetLicenseSchema,
});

export const AssetRegistrySchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    assets: z.array(AssetRegistryEntrySchema),
  })
  .check((ctx) => {
    const seen = new Set<string>();
    ctx.value.assets.forEach((asset, i) => {
      if (seen.has(asset.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate asset id "${asset.id}"`,
          path: ['assets', i, 'id'],
          input: asset.id,
        });
      }
      seen.add(asset.id);
    });
  });

export type AssetLicense = z.infer<typeof AssetLicenseSchema>;
export type AssetRegistryEntry = z.infer<typeof AssetRegistryEntrySchema>;
export type AssetRegistry = z.infer<typeof AssetRegistrySchema>;
