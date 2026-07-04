// SPDX-License-Identifier: Apache-2.0
//
// The construction interpreter (issue #94, part 2 of citizen-construction):
// residents raise `construction_site` world-DATA through its authored stages,
// Age-of-Empires style. Fully deterministic (CLAUDE.md invariant 3) — a site
// only accrues work while eligible builders stand on it, presence is a pure
// function of the tick (positions already are), sites and workers are walked
// in sorted-id order, and each worker's per-tick effort is an independent
// seeded roll keyed by the world clock. No Math.random, no wall time: same
// world state + same tick ⇒ byte-identical site progress, every machine.
//
// Invariant 1 (world is DATA): the stage ladder, its work costs, and the
// builder roles are all authored — this file hardcodes none of them. It does
// NOT move residents: pathing to the site is behavior-tree territory (a mason
// whose authored schedule brings them to the site works it; invariants 1/5).
// The interpreter spends work units while builders are present and advances
// the stages they climb.
import { deriveSeed, mulberry32 } from '../generate/rng.js';
import type { ConstructionSite } from '../schemas/construction.js';

// A builder counts as "on the job" when they stand within this margin of the
// site's footprint edge — close enough to be raising it, not merely passing.
const WORK_MARGIN = 2;

// Mirrors validateWorld's role matching (ADR-0001): builder_roles reuse NPC
// identity.kind by slug equality, so the residents the gate accepted as
// possible builders are exactly the ones who can work here.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Full 3D distance (y included), matching gossip's co-location test. */
const dist2 = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

/** A read-only view of one site's live progress — the inspect panel's source. */
export interface ConstructionSiteState {
  id: string;
  /** The chunk the site rises in. */
  chunk: string;
  /** Diegetic name of the stage the site currently sits at. */
  stage: string;
  /** Index into the site's stages (0-based); equals stageCount once complete. */
  stageIndex: number;
  /** How many stages the site climbs in total. */
  stageCount: number;
  /** Work units accrued toward advancing out of the current stage. */
  progress: number;
  /** Work units needed to advance out of the current stage (0 once complete). */
  required: number;
  /** Resident ids working the site this tick, sorted. */
  workers: string[];
  /** True once the final stage's work is done and the building stands. */
  complete: boolean;
}

/** A stage the site climbed into (or its completion) this tick — chronicle-ready. */
export interface ConstructionTransition {
  tick: number;
  /** Site id. */
  site: string;
  /** The stage name entered (or the final stage, on completion). */
  stage: string;
  /** New stage index; equals the stage count on completion. */
  stageIndex: number;
  /** True when the site finished this tick. */
  done: boolean;
  /** Diegetic chronicle line. */
  text: string;
}

interface SiteRuntime {
  site: ConstructionSite;
  /** World-space footprint centre, y from the authored position. */
  centre: [number, number, number];
  /** Squared work radius: half the larger footprint span plus the margin. */
  radius2: number;
  /** Builder role slugs that may work here. */
  roles: Set<string>;
  stageIndex: number;
  progress: number;
  complete: boolean;
  workers: string[];
}

export class ConstructionRuntime {
  #seed: number;
  // Resident id → role slug (identity.kind, slugified). Built once.
  #roleOf: Map<string, string>;
  // Sites keyed by id, walked in sorted order for stable output.
  #sites: SiteRuntime[];

  constructor(
    sites: readonly ConstructionSite[],
    originOf: ReadonlyMap<string, readonly [number, number]>,
    roleOf: ReadonlyMap<string, string>,
    worldSeed = 0,
  ) {
    this.#seed = worldSeed;
    this.#roleOf = new Map([...roleOf].map(([id, kind]) => [id, slugify(kind)]));
    this.#sites = [...sites]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((site) => {
        const origin = originOf.get(site.chunk) ?? ([0, 0] as const);
        const reach = Math.max(site.footprint.width, site.footprint.depth) / 2 + WORK_MARGIN;
        return {
          site,
          centre: [origin[0] + site.position[0], site.position[1], origin[1] + site.position[2]] as [
            number,
            number,
            number,
          ],
          radius2: reach * reach,
          roles: new Set(site.builder_roles.map(slugify)),
          stageIndex: 0,
          progress: 0,
          complete: false,
          workers: [],
        };
      });
  }

  // One worker's effort this tick: 1 or 2 units, an independent seeded roll
  // keyed so adding a site, a worker, or a tick never shifts another's
  // outcome (deriveSeed is order-free; the key names exactly this hammer-blow).
  #effort(site: string, npc: string, tick: number): number {
    const roll = mulberry32(deriveSeed(this.#seed, `construction:${site}:${npc}:${tick}`))();
    return roll < 0.5 ? 1 : 2;
  }

  /**
   * Advance one tick. `positions` is every resident's world-space position
   * this tick (the same map gossip reads). Returns the stage transitions and
   * completions that happened, ready for the chronicle and the delta. Sites
   * with no builder present this tick simply don't progress.
   */
  step(tick: number, positions: ReadonlyMap<string, readonly [number, number, number]>): ConstructionTransition[] {
    const transitions: ConstructionTransition[] = [];
    for (const rt of this.#sites) {
      if (rt.complete) {
        rt.workers = [];
        continue;
      }
      // Present, eligible builders: role matches and they stand on the site.
      // Sorted so the worker list and the effort rolls are order-free.
      const workers: string[] = [];
      for (const [id, pos] of positions) {
        const role = this.#roleOf.get(id);
        if (role !== undefined && rt.roles.has(role) && dist2(pos, rt.centre) <= rt.radius2) {
          workers.push(id);
        }
      }
      workers.sort();
      rt.workers = workers;
      if (workers.length === 0) continue;

      for (const id of workers) rt.progress += this.#effort(rt.site.id, id, tick);

      // Spend the accrued units up the ladder. A big crew can clear more than
      // one stage in a tick; the remainder carries into the next stage.
      const stages = rt.site.stages;
      while (!rt.complete && rt.progress >= stages[rt.stageIndex]!.work_units) {
        rt.progress -= stages[rt.stageIndex]!.work_units;
        rt.stageIndex += 1;
        const pretty = rt.site.id.replace(/-/g, ' ');
        if (rt.stageIndex >= stages.length) {
          rt.complete = true;
          rt.progress = 0;
          rt.workers = [];
          transitions.push({
            tick,
            site: rt.site.id,
            stage: stages[stages.length - 1]!.name,
            stageIndex: stages.length,
            done: true,
            text: `the ${pretty} is complete`,
          });
          break;
        }
        transitions.push({
          tick,
          site: rt.site.id,
          stage: stages[rt.stageIndex]!.name,
          stageIndex: rt.stageIndex,
          done: false,
          text: `the ${pretty} — ${stages[rt.stageIndex]!.name}`,
        });
      }
    }
    return transitions;
  }

  /** Every site's live state, sorted by id — the read endpoint's payload. */
  state(): ConstructionSiteState[] {
    return this.#sites.map((rt) => {
      const stages = rt.site.stages;
      const idx = rt.stageIndex;
      return {
        id: rt.site.id,
        chunk: rt.site.chunk,
        stage: rt.complete ? stages[stages.length - 1]!.name : stages[idx]!.name,
        stageIndex: idx,
        stageCount: stages.length,
        progress: rt.progress,
        required: rt.complete ? 0 : stages[idx]!.work_units,
        workers: [...rt.workers],
        complete: rt.complete,
      };
    });
  }
}
