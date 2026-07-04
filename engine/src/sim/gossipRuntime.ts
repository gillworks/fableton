// SPDX-License-Identifier: Apache-2.0
//
// The gossip interpreter (docs/architecture.md, ADR-0001 Tier-0): rumors are
// world-DATA; this runs the generic spread mechanic over them. Fully
// deterministic (CLAUDE.md invariant 3) — co-location is a pure function of
// the tick (positions already are), pairs are walked in sorted-id order, and
// every jump is an independent seeded roll keyed by the world clock. No
// Math.random, no wall time. Same world state ⇒ same spread, every machine.
import { deriveSeed, mulberry32 } from '../generate/rng.js';
import type { RumorsDoc } from '../schemas/rumors.js';

/** One rumor a resident carries, and where it came from. */
export interface Heard {
  /** Rumor id. */
  rumor: string;
  /** The resident it was heard from (or the origin itself, for seeds). */
  from: string;
  /** Sim tick the resident first heard it (0 for origin seeds). */
  tick: number;
}

/** A fresh jump this tick — the interpreter's output, one per new listener. */
export interface Spread {
  tick: number;
  from: string;
  to: string;
  rumor: string;
  text: string;
  notable: boolean;
}

// Full 3D distance, y included. Intentional for v1's flat worlds — if
// verticality ever matters (multi-floor buildings), two residents one floor
// apart won't gossip, and this is where you'd drop the dy term.
const dist2 = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

export class GossipRuntime {
  #seed: number;
  #radius2: number;
  #chance: number;
  // rumor id → {text, notable}
  #rumors = new Map<string, { text: string; notable: boolean }>();
  // resident id → (rumor id → Heard). Insertion order is stable per resident.
  #heard = new Map<string, Map<string, Heard>>();

  constructor(rumors: RumorsDoc, npcIds: readonly string[], worldSeed = 0) {
    this.#seed = worldSeed;
    this.#radius2 = rumors.spread_radius * rumors.spread_radius;
    this.#chance = rumors.spread_chance;
    for (const id of npcIds) this.#heard.set(id, new Map());
    for (const rumor of rumors.rumors) {
      this.#rumors.set(rumor.id, { text: rumor.text, notable: rumor.notable });
      // The origin knows it from the start — the head of the chain. If the
      // origin isn't a resident of this world (gate-clean worlds never do
      // this), the rumor simply has no carrier and never spreads.
      this.#heard.get(rumor.origin)?.set(rumor.id, { rumor: rumor.id, from: rumor.origin, tick: 0 });
    }
  }

  /** Does this resident already carry this rumor? */
  #knows(npc: string, rumor: string): boolean {
    return this.#heard.get(npc)?.has(rumor) ?? false;
  }

  // A single independent roll, keyed so adding rumors or residents never
  // shifts another jump's outcome (deriveSeed is order-free; the key names
  // exactly this jump at this tick).
  #rolls(rumor: string, from: string, to: string, tick: number): boolean {
    const key = `gossip:${rumor}:${from}:${to}:${tick}`;
    return mulberry32(deriveSeed(this.#seed, key))() < this.#chance;
  }

  /**
   * Advance one tick. `positions` is the residents' world-space positions
   * this tick; iteration order does not affect the result (we snapshot the
   * known-set before applying any jump, so a rumor can't hop two links in a
   * single tick, and pairs are walked in a fixed order). Returns the fresh
   * spreads, ready for the chronicle.
   */
  step(tick: number, positions: ReadonlyMap<string, readonly [number, number, number]>): Spread[] {
    if (this.#rumors.size === 0) return [];
    const ids = [...positions.keys()].sort();
    // Snapshot: who knew what at the start of the tick. Jumps read this, so
    // the order pairs are visited never changes the outcome.
    const knownAtStart = new Map<string, Set<string>>();
    for (const id of ids) knownAtStart.set(id, new Set(this.#heard.get(id)?.keys() ?? []));

    const spreads: Spread[] = [];
    const record = (from: string, to: string, rumor: string): void => {
      if (this.#knows(to, rumor)) return; // already caught it this tick
      this.#heard.get(to)?.set(rumor, { rumor, from, tick });
      const meta = this.#rumors.get(rumor)!;
      spreads.push({ tick, from, to, rumor, text: meta.text, notable: meta.notable });
    };

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        if (dist2(pa, pb) > this.#radius2) continue;
        const knowsA = knownAtStart.get(a)!;
        const knowsB = knownAtStart.get(b)!;
        for (const rumor of knowsA) {
          if (!knowsB.has(rumor) && this.#rolls(rumor, a, b, tick)) record(a, b, rumor);
        }
        for (const rumor of knowsB) {
          if (!knowsA.has(rumor) && this.#rolls(rumor, b, a, tick)) record(b, a, rumor);
        }
      }
    }
    return spreads;
  }

  /**
   * What a resident has heard from others — the inspect panel's HAS HEARD
   * section. Origin seeds (heard from oneself) are omitted: you don't hear
   * your own rumor. Ordered by when it was heard, then rumor id, for a
   * stable panel.
   */
  heardBy(npc: string): Heard[] {
    const carried = this.#heard.get(npc);
    if (!carried) return [];
    return [...carried.values()]
      .filter((h) => h.from !== npc)
      .sort((x, y) => x.tick - y.tick || x.rumor.localeCompare(y.rumor));
  }
}
