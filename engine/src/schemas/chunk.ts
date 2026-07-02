// SPDX-License-Identifier: Apache-2.0
//
// A chunk is one streamable unit of static world geometry: terrain, prop
// placements, nav data, and refs to the NPCs and lore that live there.
// Positions are chunk-local; the manifest places chunks in the world.
import { z } from 'zod';
import { WORLD_DATA_SCHEMA_VERSION, finite, hexColor, idSlug, nonEmpty, vec3 } from './common.js';

export const PropPlacementSchema = z.strictObject({
  asset: idSlug,
  position: vec3,
  rotation_y: finite.default(0),
  scale: z.number().positive().finite().default(1),
});

// Nav-lite: a walk graph, not a navmesh. Portals name the nav node an NPC
// stands on to cross into an adjacent chunk; the CI gate walks these for
// world connectivity.
export const NavSchema = z
  .strictObject({
    nodes: z.array(z.strictObject({ id: idSlug, position: vec3 })).min(1),
    edges: z.array(z.tuple([idSlug, idSlug])),
    portals: z.array(z.strictObject({ node: idSlug, to_chunk: idSlug })),
  })
  .check((ctx) => {
    const ids = new Set<string>();
    ctx.value.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate nav node id "${node.id}"`,
          path: ['nodes', i, 'id'],
          input: node.id,
        });
      }
      ids.add(node.id);
    });
    ctx.value.edges.forEach((edge, i) => {
      const [a, b] = edge;
      if (a === b) {
        ctx.issues.push({
          code: 'custom',
          message: `edge ${i} connects "${a}" to itself`,
          path: ['edges', i],
          input: edge,
        });
      }
      for (const end of edge) {
        if (!ids.has(end)) {
          ctx.issues.push({
            code: 'custom',
            message: `edge ${i} references unknown nav node "${end}"`,
            path: ['edges', i],
            input: end,
          });
        }
      }
    });
    ctx.value.portals.forEach((portal, i) => {
      if (!ids.has(portal.node)) {
        ctx.issues.push({
          code: 'custom',
          message: `portal ${i} references unknown nav node "${portal.node}"`,
          path: ['portals', i, 'node'],
          input: portal.node,
        });
      }
    });
  });

export const ChunkSchema = z.strictObject({
  schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
  id: idSlug,
  terrain: z
    .strictObject({
      biome: nonEmpty,
      // Square heightmap: grid_size vertices per side, row-major heights.
      grid_size: z.number().int().min(2),
      heights: z.array(finite),
    })
    .check((ctx) => {
      const expected = ctx.value.grid_size ** 2;
      if (ctx.value.heights.length !== expected) {
        ctx.issues.push({
          code: 'custom',
          message: `heights has ${ctx.value.heights.length} values, expected grid_size² = ${expected}`,
          path: ['heights'],
          input: ctx.value.heights.length,
        });
      }
    }),
  palette: z.array(hexColor).min(1),
  props: z.array(PropPlacementSchema),
  nav: NavSchema,
  npcs: z.array(idSlug),
  lore: z.array(idSlug),
});

export type PropPlacement = z.infer<typeof PropPlacementSchema>;
export type Nav = z.infer<typeof NavSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
