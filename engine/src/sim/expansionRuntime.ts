// SPDX-License-Identifier: Apache-2.0
//
// The expansion interpreter (issue #95, part 3 of citizen-construction): the
// sim consumes the town's expansion plan and OPENS construction sites as their
// prerequisites come true. It decides *when* ground breaks; it never decides
// *what* is built — that is the plan's authored data (invariant 1).
//
// Determinism (invariant 3): opening is a pure function of the world day and
// the set of sites that have already completed. Prerequisites are monotonic
// (a day passed stays passed; a finished site stays finished), so a site opens
// exactly once and the sweep is stable and terminating. No RNG, no wall clock.
//
// The builder mechanic that SPENDS a site's work_units to advance it toward
// completion (issue #96) feeds the completed-site set the WorldSim passes here:
// day-gated sites open on schedule and site_complete-gated sites open once
// their dependency finishes. This runtime stays pure — it reads the set it is
// given and never watches construction itself, as the runtime's tests exercise.
import type { ConstructionSite } from '../schemas/construction.js';
import type { ExpansionPlan } from '../schemas/expansion.js';

// A site whose ground just broke this evaluation. `stage` is the site's first
// (diegetic) stage name so the chronicle can read it verbatim (invariant 4);
// `def` is the full authored construction_site so the consumer (WorldSim) can
// hand it straight to the construction runtime and let builders raise it —
// this is the reverse wire of the completion→prerequisite loop (issue #107).
export interface SiteOpening {
  site: string;
  stage: string;
  def: ConstructionSite;
}

export class ExpansionRuntime {
  #queue: ExpansionPlan['queue'];
  #opened = new Set<string>();

  constructor(plan: ExpansionPlan) {
    this.#queue = plan.queue;
  }

  /**
   * Evaluate the queue against the current world `day` and the set of sites
   * already `completed`. Returns the sites that newly open this call, in queue
   * order — each site opens at most once across the runtime's life.
   */
  step(day: number, completed: ReadonlySet<string> = EMPTY): SiteOpening[] {
    const openings: SiteOpening[] = [];
    for (const entry of this.#queue) {
      if (this.#opened.has(entry.site.id)) continue;
      const met = entry.prerequisites.every((prereq) =>
        prereq.type === 'day' ? day >= prereq.min_day : completed.has(prereq.site),
      );
      if (met) {
        this.#opened.add(entry.site.id);
        openings.push({ site: entry.site.id, stage: entry.site.stages[0]!.name, def: entry.site });
      }
    }
    return openings;
  }

  /** The sites currently open (ground broken), in queue order. */
  openSites(): string[] {
    return this.#queue.map((e) => e.site.id).filter((id) => this.#opened.has(id));
  }
}

const EMPTY: ReadonlySet<string> = new Set();
