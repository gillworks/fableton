// SPDX-License-Identifier: Apache-2.0
//
// The world manifest is the index the client streams from: which chunks
// exist, where each sits on the ground plane, and the adjacency graph.
// Layout and topology live here so chunks stay relocatable (chunk-local
// coordinates).
import { z } from 'zod';
import { WORLD_DATA_SCHEMA_VERSION, finite, idSlug, nonEmpty } from './common.js';

export const ManifestChunkSchema = z.strictObject({
  id: idSlug,
  path: nonEmpty,
  // World-space origin of the chunk's local frame, ground plane [x, z].
  origin: z.tuple([finite, finite]),
  adjacent: z.array(idSlug),
});

export const WorldManifestSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    world: nonEmpty,
    seed: z.number().int().min(0).max(0xffff_ffff),
    // When the world was founded (UTC). The sim derives "day N" from wall
    // time elapsed since this stamp, so deploys and restarts never reset
    // the town to day 1 (issue #57). Optional: pre-#57 worlds still parse
    // and simply start at day 1 each boot.
    founded_at: z.iso.datetime().optional(),
    chunks: z.array(ManifestChunkSchema).min(1),
  })
  .check((ctx) => {
    const byId = new Map<string, Set<string>>();
    ctx.value.chunks.forEach((chunk, i) => {
      if (byId.has(chunk.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate chunk id "${chunk.id}"`,
          path: ['chunks', i, 'id'],
          input: chunk.id,
        });
      }
      byId.set(chunk.id, new Set(chunk.adjacent));
    });
    ctx.value.chunks.forEach((chunk, i) => {
      chunk.adjacent.forEach((other, j) => {
        const path = ['chunks', i, 'adjacent', j];
        if (other === chunk.id) {
          ctx.issues.push({
            code: 'custom',
            message: `chunk "${chunk.id}" lists itself as adjacent`,
            path,
            input: other,
          });
        } else if (!byId.has(other)) {
          ctx.issues.push({
            code: 'custom',
            message: `chunk "${chunk.id}" is adjacent to unknown chunk "${other}"`,
            path,
            input: other,
          });
        } else if (!byId.get(other)!.has(chunk.id)) {
          ctx.issues.push({
            code: 'custom',
            message: `adjacency is not symmetric: "${chunk.id}" lists "${other}" but not vice versa`,
            path,
            input: other,
          });
        }
      });
    });
  });

export type ManifestChunk = z.infer<typeof ManifestChunkSchema>;
export type WorldManifest = z.infer<typeof WorldManifestSchema>;
