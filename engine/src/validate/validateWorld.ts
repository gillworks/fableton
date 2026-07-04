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
import { slugify } from '../schemas/common.js';
import { ConstructionSiteSchema, type ConstructionSite } from '../schemas/construction.js';
import { ExpansionPlanSchema } from '../schemas/expansion.js';
import { WorldManifestSchema, type WorldManifest } from '../schemas/manifest.js';
import { NpcSchema, type Npc } from '../schemas/npc.js';
import { RumorsDocSchema } from '../schemas/rumors.js';

export interface Violation {
  file: string;
  rule:
    | 'schema-valid'
    | 'asset-refs-resolve'
    | 'nav-connectivity'
    | 'footprint-overlap'
    | 'perf-budget'
    | 'charter-gate-rule'
    | 'duplicate-id';
  message: string;
}

export interface WorldDocs {
  manifest: { file: string; doc: unknown };
  registry: { file: string; doc: unknown };
  chunks: { file: string; doc: unknown }[];
  npcs: { file: string; doc: unknown }[];
  // Optional: worlds without any construction sites (all three flagship
  // charters, today) simply omit this. Part 1 of the citizen-construction
  // feature (issue #91).
  constructionSites?: { file: string; doc: unknown }[];
  // Optional (issue #81): a world with no rumors.json is simply a quiet
  // town. Present ⇒ schema-valid and every origin resolves to a resident.
  rumors?: { file: string; doc: unknown };
  // Optional (issue #95): the town's expansion plan. Its queued sites are
  // pre-placed, so the gate validates them statically alongside any standing
  // construction sites — same ref/footprint/perf checks, plus no two footprints
  // (planned or standing) may overlap in a chunk.
  expansionPlan?: { file: string; doc: unknown };
}

// Is chunk-local point (px, pz) inside a rectangular footprint centred at
// (cx, cz), of the given width (local x) and depth (local z), rotated by
// rotation_y (radians, CCW about the centre)? Pure trig — deterministic.
function pointInFootprint(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationY: number,
): boolean {
  const dx = px - cx;
  const dz = pz - cz;
  const cos = Math.cos(-rotationY);
  const sin = Math.sin(-rotationY);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.abs(localX) <= width / 2 && Math.abs(localZ) <= depth / 2;
}

// Does the walk-graph edge from (ax, az) to (bx, bz) pass through the footprint
// rectangle? Both endpoints may be clear of the site yet the segment between
// them runs straight under the building — a walkway the finished structure
// physically blocks. We clip the segment (in the footprint's local frame) to
// the rectangle with Liang–Barsky; a non-empty clip means it crosses. Pure
// arithmetic — deterministic.
function segmentCrossesFootprint(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotationY: number,
): boolean {
  const cos = Math.cos(-rotationY);
  const sin = Math.sin(-rotationY);
  const x0 = (ax - cx) * cos - (az - cz) * sin;
  const z0 = (ax - cx) * sin + (az - cz) * cos;
  const x1 = (bx - cx) * cos - (bz - cz) * sin;
  const z1 = (bx - cx) * sin + (bz - cz) * cos;
  const hw = width / 2;
  const hd = depth / 2;
  const dx = x1 - x0;
  const dz = z1 - z0;
  let t0 = 0;
  let t1 = 1;
  // Clip against one slab boundary: p·t <= q along the parameter.
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel to this boundary: inside iff q >= 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x0 + hw) &&
    clip(dx, hw - x0) &&
    clip(-dz, z0 + hd) &&
    clip(dz, hd - z0) &&
    t0 <= t1
  );
}

// Do two rectangular footprints overlap? Each is an oriented box (centre,
// width along local x, depth along local z, rotation_y). Separating Axis
// Theorem on the four face normals: if any axis separates the projected
// extents, the boxes are disjoint. Shared edges (exact touch) do not count as
// overlap — adjacent buildings are fine. Pure trig — deterministic.
function footprintsOverlap(a: ConstructionSite, b: ConstructionSite): boolean {
  const au = [Math.cos(a.rotation_y), Math.sin(a.rotation_y)] as const;
  const av = [-Math.sin(a.rotation_y), Math.cos(a.rotation_y)] as const;
  const bu = [Math.cos(b.rotation_y), Math.sin(b.rotation_y)] as const;
  const bv = [-Math.sin(b.rotation_y), Math.cos(b.rotation_y)] as const;
  const ahw = a.footprint.width / 2;
  const ahd = a.footprint.depth / 2;
  const bhw = b.footprint.width / 2;
  const bhd = b.footprint.depth / 2;
  const dx = b.position[0] - a.position[0];
  const dz = b.position[2] - a.position[2];
  const EPS = 1e-9;
  for (const [ex, ez] of [au, av, bu, bv]) {
    const projA = ahw * Math.abs(ex * au[0] + ez * au[1]) + ahd * Math.abs(ex * av[0] + ez * av[1]);
    const projB = bhw * Math.abs(ex * bu[0] + ez * bu[1]) + bhd * Math.abs(ex * bv[0] + ez * bv[1]);
    if (Math.abs(ex * dx + ez * dz) >= projA + projB - EPS) return false; // separated on this axis
  }
  return true;
}

interface BehaviorRefs {
  phases: Set<string>;
  events: Set<string>;
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
    case 'on_event':
      refs.events.add(node.event);
      collectBehaviorRefs(node.child, refs);
      if (node.otherwise) collectBehaviorRefs(node.otherwise, refs);
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
  const sites: { file: string; site: ConstructionSite }[] = [];
  for (const { file, doc } of world.constructionSites ?? []) {
    const result = ConstructionSiteSchema.safeParse(doc);
    if (result.success) sites.push({ file, site: result.data });
    else invalid(file, result.error);
  }
  // The expansion plan's queued sites are pre-placed world-data too, so they
  // join the same site pool: every ref/footprint/perf check below runs over
  // planned and standing sites alike, and the plan is validated statically as
  // if the whole town were already built (issue #95).
  if (world.expansionPlan) {
    const result = ExpansionPlanSchema.safeParse(world.expansionPlan.doc);
    if (result.success) {
      for (const entry of result.data.queue) {
        sites.push({ file: world.expansionPlan.file, site: entry.site });
      }
    } else invalid(world.expansionPlan.file, result.error);
  }

  const registry = registryResult.success ? registryResult.data : undefined;
  const manifest: WorldManifest | undefined = manifestResult.success
    ? manifestResult.data
    : undefined;
  const assetsById = new Map(registry?.assets.map((a) => [a.id, a]) ?? []);
  const chunksById = new Map(chunks.map((c) => [c.chunk.id, c]));
  const npcIds = new Set(npcs.map((n) => n.npc.id));
  // Construction sites grouped by the chunk they rise in — the perf-budget
  // loop below folds each site's cost into its chunk's totals.
  const sitesByChunk = new Map<string, { file: string; site: ConstructionSite }[]>();
  const siteIdSeen = new Map<string, string>();
  for (const entry of sites) {
    // Ids must be unique across the whole construction/ collection — two files
    // sharing an id both load and both count toward perf/placement, matching
    // how the other world-data collections guard uniqueness.
    const prior = siteIdSeen.get(entry.site.id);
    if (prior) {
      violations.push({
        file: entry.file,
        rule: 'duplicate-id',
        message: `construction site id "${entry.site.id}" is already defined in "${prior}"`,
      });
    } else {
      siteIdSeen.set(entry.site.id, entry.file);
    }
    const list = sitesByChunk.get(entry.site.chunk) ?? [];
    list.push(entry);
    sitesByChunk.set(entry.site.chunk, list);
  }
  // A site's builder_roles reuse NPC roles (identity.kind) by slug equality,
  // the same matching charter gate rules use — not a duplicated role enum.
  const npcRoleSlugs = new Set(npcs.map((n) => slugify(n.npc.identity.kind)));

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

  // Rumors (issue #81): schema-valid, and every origin is a real resident —
  // a rumor with no carrier would never spread. Optional file.
  if (world.rumors) {
    const result = RumorsDocSchema.safeParse(world.rumors.doc);
    if (!result.success) invalid(world.rumors.file, result.error);
    else {
      for (const rumor of result.data.rumors) {
        if (!npcIds.has(rumor.origin)) {
          violations.push({
            file: world.rumors.file,
            rule: 'asset-refs-resolve',
            message: `rumor "${rumor.id}" originates with unknown NPC "${rumor.origin}" (no NPC file with that id)`,
          });
        }
      }
    }
  }

  // NPC behavior refs resolve against the chunks the NPC is placed in.
  const dayPhases = new Set(charter.aesthetic.day_phases);
  // on_event nodes may reference '*' (any event) or a declared calendar event.
  const eventNames = new Set(charter.calendar.events.map((e) => e.name));
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
    const refs: BehaviorRefs = { phases: new Set(), events: new Set(), moveTargets: new Set(), interactTargets: new Set() };
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
    for (const event of refs.events) {
      if (event !== '*' && !eventNames.has(event)) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `behavior on_event "${event}" is not a charter calendar event (${[...eventNames].join(', ') || 'none declared'})`,
        });
      }
    }
  }

  // 2b — construction sites: chunk, stage-mesh, completion-prop, and builder
  // role refs resolve (issue #91).
  for (const { file, site } of sites) {
    if (!chunksById.has(site.chunk)) {
      violations.push({
        file,
        rule: 'asset-refs-resolve',
        message: `construction site "${site.id}" rises in unknown chunk "${site.chunk}" (no chunk with that id)`,
      });
    }
    if (registry) {
      site.stages.forEach((stage, i) => {
        if (stage.asset !== undefined && !assetsById.has(stage.asset)) {
          violations.push({
            file,
            rule: 'asset-refs-resolve',
            message: `stage[${i}] "${stage.name}" shows unknown asset "${stage.asset}" (not in the asset registry)`,
          });
        }
      });
      site.completion.props.forEach((prop, i) => {
        if (!assetsById.has(prop.asset)) {
          violations.push({
            file,
            rule: 'asset-refs-resolve',
            message: `completion.props[${i}] places unknown asset "${prop.asset}" (not in the asset registry)`,
          });
        }
      });
    }
    for (const role of site.builder_roles) {
      if (!npcRoleSlugs.has(slugify(role))) {
        violations.push({
          file,
          rule: 'asset-refs-resolve',
          message: `builder role "${role}" matches no resident (no NPC whose identity.kind resolves to it)`,
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

  // 3b — a construction footprint must not sever the walk graph (issue #91):
  // nav nodes buried under the site are removed AND edges whose segment runs
  // under the footprint are severed (the finished building blocks that
  // walkway even when both endpoints stay clear); the rest of the chunk's
  // graph must stay connected — and no buried node may be a portal, or the
  // chunk loses a border crossing.
  //
  // Known limitation: connectivity is checked per-site against the chunk's
  // original nav. Two sites that each individually preserve connectivity could
  // together bury complementary nodes (or cross complementary edges) and
  // disconnect the chunk. Direct footprint overlap between sites is caught in
  // 3c below (issue #95); the subtler complementary-burial case remains a
  // deferred enhancement.
  for (const { file, site } of sites) {
    const target = chunksById.get(site.chunk);
    if (!target) continue; // unknown-chunk already reported in 2b.
    const nav = target.chunk.nav;
    const [cx, , cz] = site.position;
    const nodePos = new Map(nav.nodes.map((n) => [n.id, n.position]));
    const buried = new Set(
      nav.nodes
        .filter((n) =>
          pointInFootprint(n.position[0], n.position[2], cx, cz, site.footprint.width, site.footprint.depth, site.rotation_y),
        )
        .map((n) => n.id),
    );
    // Edges with both endpoints clear of the site but whose segment still runs
    // under the footprint — a walkway the building physically blocks.
    const crossing = nav.edges.filter(([a, b]) => {
      if (buried.has(a) || buried.has(b)) return false;
      const pa = nodePos.get(a);
      const pb = nodePos.get(b);
      return (
        !!pa &&
        !!pb &&
        segmentCrossesFootprint(
          pa[0], pa[2], pb[0], pb[2], cx, cz, site.footprint.width, site.footprint.depth, site.rotation_y,
        )
      );
    });
    if (buried.size === 0 && crossing.length === 0) continue;
    const buriedPortals = nav.portals.filter((p) => buried.has(p.node));
    if (buriedPortals.length > 0) {
      violations.push({
        file,
        rule: 'nav-connectivity',
        message: `site "${site.id}" footprint buries portal node(s) ${buriedPortals.map((p) => `"${p.node}"→"${p.to_chunk}"`).join(', ')} in chunk "${site.chunk}" — a border crossing would be lost`,
      });
    }
    const remaining = nav.nodes.filter((n) => !buried.has(n.id));
    if (remaining.length === 0) {
      violations.push({
        file,
        rule: 'nav-connectivity',
        message: `site "${site.id}" footprint buries every nav node in chunk "${site.chunk}" — nothing left to walk`,
      });
      continue;
    }
    const crossingSet = new Set(crossing.map(([a, b]) => `${a} ${b}`));
    const adjacency = new Map<string, string[]>(remaining.map((n) => [n.id, []]));
    for (const [a, b] of nav.edges) {
      if (buried.has(a) || buried.has(b)) continue;
      if (crossingSet.has(`${a} ${b}`)) continue; // severed by the footprint
      adjacency.get(a)?.push(b);
      adjacency.get(b)?.push(a);
    }
    const first = remaining[0]!.id;
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
    const cut = remaining.filter((n) => !seen.has(n.id));
    if (cut.length > 0) {
      violations.push({
        file,
        rule: 'nav-connectivity',
        message: `site "${site.id}" footprint disconnects chunk "${site.chunk}": ${cut.map((n) => `"${n.id}"`).join(', ')} unreachable once the site's footprint is placed`,
      });
    }
  }

  // 3c — no two footprints (planned or standing) may overlap within a chunk
  // (issue #95): buildings that share ground would fight for the same tiles.
  // Deterministic pairwise sweep, stable order (sites keep their load order).
  for (const [chunkId, chunkSites] of sitesByChunk) {
    for (let i = 0; i < chunkSites.length; i++) {
      for (let j = i + 1; j < chunkSites.length; j++) {
        const a = chunkSites[i]!;
        const b = chunkSites[j]!;
        if (footprintsOverlap(a.site, b.site)) {
          violations.push({
            file: b.file,
            rule: 'footprint-overlap',
            message: `site "${b.site.id}" footprint overlaps site "${a.site.id}" in chunk "${chunkId}" — two buildings cannot share ground`,
          });
        }
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
    // Each construction site adds, at its most expensive moment, the heavier
    // of (a) its single visible stage mesh mid-build or (b) the parametric
    // building(s)/prop(s) it becomes when finished — never both at once, so
    // we charge the max. Priced the same as anything else in the chunk:
    // registry poly_count for meshes, 200 tris / 6 draw calls per building.
    const chunkSites = sitesByChunk.get(chunk.id) ?? [];
    let sitePolys = 0;
    let siteDrawCalls = 0;
    for (const { site } of chunkSites) {
      // A rise stage shows the completion buildings at partial height —
      // price it like the completion's buildings (200 tris each).
      const heaviestStagePolys = site.stages.reduce(
        (max, s) =>
          Math.max(
            max,
            s.rise !== undefined
              ? site.completion.buildings.length * 200
              : (assetsById.get(s.asset ?? '')?.poly_count ?? 0),
          ),
        0,
      );
      const completionPolys =
        site.completion.buildings.length * 200 +
        site.completion.props.reduce((sum, p) => sum + (assetsById.get(p.asset)?.poly_count ?? 0), 0);
      sitePolys += Math.max(heaviestStagePolys, completionPolys);
      const completionDrawCalls = site.completion.buildings.length * 6 + site.completion.props.length;
      siteDrawCalls += Math.max(1, completionDrawCalls);
    }
    const polys = terrainPolys + propPolys + buildingPolys + sitePolys;
    if (polys > caps.chunk_poly_budget) {
      violations.push({
        file,
        rule: 'perf-budget',
        message: `chunk "${chunk.id}" has ${polys} triangles (terrain ${terrainPolys} + props ${propPolys} + buildings ${buildingPolys} + construction ${sitePolys}), budget is ${caps.chunk_poly_budget}`,
      });
    }
    const drawCalls = 1 + chunk.props.length + chunk.buildings.length * 6 + siteDrawCalls;
    if (drawCalls > caps.chunk_drawcall_budget) {
      violations.push({
        file,
        rule: 'perf-budget',
        message: `chunk "${chunk.id}" needs ${drawCalls} draw calls (terrain + ${chunk.props.length} props + ${chunk.buildings.length} buildings + ${chunkSites.length} construction site(s)), budget is ${caps.chunk_drawcall_budget}`,
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
