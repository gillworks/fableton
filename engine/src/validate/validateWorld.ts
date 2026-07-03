// SPDX-License-Identifier: Apache-2.0
//
// The validation gate (docs/v1.md, DoD test 3): schema-valid · asset refs
// resolve · navmesh-lite connectivity · perf budget. Pure — the CLI feeds
// it raw parsed JSON; every finding is a legible Violation naming the
// file, the rule, and what broke.
import { z } from 'zod';
import { AssetRegistrySchema } from '../schemas/assets.js';
import type { BehaviorNode } from '../schemas/behavior.js';
import type { Charter } from '../schemas/charter.js';
import { ChunkSchema, type Chunk } from '../schemas/chunk.js';
import { WorldManifestSchema, type WorldManifest } from '../schemas/manifest.js';
import { NpcSchema, type Npc } from '../schemas/npc.js';

export interface Violation {
  file: string;
  rule:
    | 'schema-valid'
    | 'asset-refs-resolve'
    | 'nav-connectivity'
    | 'perf-budget'
    | 'charter-gate-rule';
  message: string;
}

export interface WorldDocs {
  manifest: { file: string; doc: unknown };
  registry: { file: string; doc: unknown };
  chunks: { file: string; doc: unknown }[];
  npcs: { file: string; doc: unknown }[];
}

// Gate-enforced charter rules match asset tags on slug equality (ADR-0001).
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface BehaviorRefs {
  phases: Set<string>;
  moveTargets: Set<string>;
  interactTargets: Set<string>;
}

function collectBehaviorRefs(node: BehaviorNode, refs: BehaviorRefs): void {
  switch (node.type) {
    case 'schedule':
      for (const entry of node.entries) {
        refs.phases.add(entry.phase);
        collectBehaviorRefs(entry.child, refs);
      }
      break;
    case 'sequence':
      for (const child of node.children) collectBehaviorRefs(child, refs);
      break;
    case 'move':
      refs.moveTargets.add(node.to);
      break;
    case 'interact':
      refs.interactTargets.add(node.with);
      break;
    case 'idle':
      break;
  }
}

export function validateWorld(charter: Charter, world: WorldDocs): Violation[] {
  const violations: Violation[] = [];
  const invalid = (file: string, error: z.ZodError): void => {
    violations.push({ file, rule: 'schema-valid', message: z.prettifyError(error) });
  };

  // 1 — schema-valid. Cross-checks run on whatever parsed cleanly.
  const manifestResult = WorldManifestSchema.safeParse(world.manifest.doc);
  if (!manifestResult.success) invalid(world.manifest.file, manifestResult.error);
  const registryResult = AssetRegistrySchema.safeParse(world.registry.doc);
  if (!registryResult.success) invalid(world.registry.file, registryResult.error);

  const chunks: { file: string; chunk: Chunk }[] = [];
  for (const { file, doc } of world.chunks) {
    const result = ChunkSchema.safeParse(doc);
    if (result.success) chunks.push({ file, chunk: result.data });
    else invalid(file, result.error);
  }
  const npcs: { file: string; npc: Npc }[] = [];
  for (const { file, doc } of world.npcs) {
    const result = NpcSchema.safeParse(doc);
    if (result.success) npcs.push({ file, npc: result.data });
    else invalid(file, result.error);
  }

  const registry = registryResult.success ? registryResult.data : undefined;
  const manifest: WorldManifest | undefined = manifestResult.success
    ? manifestResult.data
    : undefined;
  const assetsById = new Map(registry?.assets.map((a) => [a.id, a]) ?? []);
  const chunksById = new Map(chunks.map((c) => [c.chunk.id, c]));
  const npcIds = new Set(npcs.map((n) => n.npc.id));

  // 2 — asset refs resolve.
  if (registry) {
    for (const { file, chunk } of chunks) {
      chunk.props.forEach((prop, i) => {
        if (!assetsById.has(prop.asset)) {
          violations.push({
            file,
            rule: 'asset-refs-resolve',
            message: `props[${i}] places unknown asset "${prop.asset}" (not in the asset registry)`,
          });
        }
      });
    }
  }
  for (const { file, chunk } of chunks) {
    for (const npcId of chunk.npcs) {
      if (!npcIds.has(npcId)) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `chunk "${chunk.id}" places unknown NPC "${npcId}" (no NPC file with that id)`,
        });
      }
    }
  }

  // NPC behavior refs resolve against the chunks the NPC is placed in.
  const dayPhases = new Set(charter.aesthetic.day_phases);
  for (const { file, npc } of npcs) {
    const home = chunks.filter((c) => c.chunk.npcs.includes(npc.id));
    if (home.length === 0) {
      violations.push({
        file,
        rule: 'asset-refs-resolve',
        message: `NPC "${npc.id}" is not placed in any chunk`,
      });
      continue;
    }
    const refs: BehaviorRefs = { phases: new Set(), moveTargets: new Set(), interactTargets: new Set() };
    collectBehaviorRefs(npc.behavior, refs);
    const navNodes = new Set(home.flatMap((c) => c.chunk.nav.nodes.map((n) => n.id)));
    const placedAssets = new Set(home.flatMap((c) => c.chunk.props.map((p) => p.asset)));
    const neighbours = new Set(home.flatMap((c) => c.chunk.npcs));
    for (const target of refs.moveTargets) {
      if (!navNodes.has(target)) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `behavior move target "${target}" is not a nav node in any chunk placing "${npc.id}"`,
        });
      }
    }
    for (const target of refs.interactTargets) {
      if (!placedAssets.has(target) && !(neighbours.has(target) && target !== npc.id)) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `behavior interact target "${target}" is neither a placed asset nor a co-located NPC for "${npc.id}"`,
        });
      }
    }
    for (const phase of refs.phases) {
      if (!dayPhases.has(phase)) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `behavior schedule phase "${phase}" is not one of the charter's day_phases (${[...dayPhases].join(', ')})`,
        });
      }
    }
  }

  // 3 — navmesh-lite connectivity.
  for (const { file, chunk } of chunks) {
    const adjacency = new Map<string, string[]>(chunk.nav.nodes.map((n) => [n.id, []]));
    for (const [a, b] of chunk.nav.edges) {
      adjacency.get(a)?.push(b);
      adjacency.get(b)?.push(a);
    }
    const first = chunk.nav.nodes[0]!.id;
    const seen = new Set([first]);
    const queue = [first];
    while (queue.length > 0) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = chunk.nav.nodes.filter((n) => !seen.has(n.id));
    if (unreachable.length > 0) {
      violations.push({
        file,
        rule: 'nav-connectivity',
        message: `nav graph is disconnected: ${unreachable.map((n) => `"${n.id}"`).join(', ')} unreachable from "${first}"`,
      });
    }
  }
  if (manifest && chunks.length > 0) {
    const adjacentOf = new Map(manifest.chunks.map((c) => [c.id, new Set(c.adjacent)]));
    for (const { file, chunk } of chunks) {
      for (const portal of chunk.nav.portals) {
        if (!adjacentOf.get(chunk.id)?.has(portal.to_chunk)) {
          violations.push({
            file,
            rule: 'nav-connectivity',
            message: `portal targets "${portal.to_chunk}", which the manifest does not mark adjacent to "${chunk.id}"`,
          });
        }
        const back = chunksById.get(portal.to_chunk);
        if (back && !back.chunk.nav.portals.some((p) => p.to_chunk === chunk.id)) {
          violations.push({
            file: back.file,
            rule: 'nav-connectivity',
            message: `portal "${chunk.id}" → "${portal.to_chunk}" has no return portal — NPCs could enter and never leave`,
          });
        }
      }
    }
    // Every chunk reachable from the first, walking portals.
    const first = chunks[0]!.chunk.id;
    const seen = new Set([first]);
    const queue = [first];
    while (queue.length > 0) {
      const current = chunksById.get(queue.shift()!);
      for (const portal of current?.chunk.nav.portals ?? []) {
        if (chunksById.has(portal.to_chunk) && !seen.has(portal.to_chunk)) {
          seen.add(portal.to_chunk);
          queue.push(portal.to_chunk);
        }
      }
    }
    for (const { file, chunk } of chunks) {
      if (!seen.has(chunk.id)) {
        violations.push({
          file,
          rule: 'nav-connectivity',
          message: `chunk "${chunk.id}" is unreachable from "${first}" via portals`,
        });
      }
    }
  }

  // 4 — perf budget (charter generation.caps).
  const caps = charter.generation.caps;
  if (manifest && manifest.chunks.length > caps.max_regions) {
    violations.push({
      file: world.manifest.file,
      rule: 'perf-budget',
      message: `world has ${manifest.chunks.length} chunks, charter caps max_regions at ${caps.max_regions}`,
    });
  }
  for (const { file, chunk } of chunks) {
    // Terrain is one draw call and 2·(grid_size−1)² triangles; each placed
    // prop is one draw call and its registry poly_count; each parametric
    // building is priced at 6 draw calls (walls, two roof slabs, door,
    // windows, chimney) and 200 triangles — a deliberate over-estimate.
    const terrainPolys = 2 * (chunk.terrain.grid_size - 1) ** 2;
    const propPolys = chunk.props.reduce(
      (sum, p) => sum + (assetsById.get(p.asset)?.poly_count ?? 0),
      0,
    );
    const buildingPolys = chunk.buildings.length * 200;
    const polys = terrainPolys + propPolys + buildingPolys;
    if (polys > caps.chunk_poly_budget) {
      violations.push({
        file,
        rule: 'perf-budget',
        message: `chunk "${chunk.id}" has ${polys} triangles (terrain ${terrainPolys} + props ${propPolys} + buildings ${buildingPolys}), budget is ${caps.chunk_poly_budget}`,
      });
    }
    const drawCalls = 1 + chunk.props.length + chunk.buildings.length * 6;
    if (drawCalls > caps.chunk_drawcall_budget) {
      violations.push({
        file,
        rule: 'perf-budget',
        message: `chunk "${chunk.id}" needs ${drawCalls} draw calls (terrain + ${chunk.props.length} props + ${chunk.buildings.length} buildings), budget is ${caps.chunk_drawcall_budget}`,
      });
    }
  }
  for (const { file, doc } of world.chunks) {
    const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (bytes > caps.chunk_kb_budget * 1024) {
      violations.push({
        file,
        rule: 'perf-budget',
        message: `chunk file is ${(bytes / 1024).toFixed(1)} KiB serialized, budget is ${caps.chunk_kb_budget} KiB`,
      });
    }
  }

  // 5 — gate-enforced charter rules vs asset tags (ADR-0001 resolution 2).
  const gateRules = [...charter.aesthetic.never, ...charter.taboos]
    .filter((r) => r.enforced === 'gate')
    .map((r) => ({ rule: r.rule, slug: slugify(r.rule) }));
  if (gateRules.length > 0) {
    for (const { file, chunk } of chunks) {
      const placed = new Set(chunk.props.map((p) => p.asset));
      for (const assetId of placed) {
        const asset = assetsById.get(assetId);
        for (const tag of asset?.tags ?? []) {
          const hit = gateRules.find((g) => g.slug === slugify(tag));
          if (hit) {
            violations.push({
              file,
              rule: 'charter-gate-rule',
              message: `asset "${assetId}" is tagged "${tag}", which violates the charter's gate-enforced rule "${hit.rule}"`,
            });
          }
        }
      }
    }
  }

  return violations;
}
