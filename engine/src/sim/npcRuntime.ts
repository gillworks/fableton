// SPDX-License-Identifier: Apache-2.0
//
// Tier-0 behavior-tree execution (docs/architecture.md): deterministic
// interpretation of an NPC's tree at frame rate — the LLM writes the mind,
// this runs it. The active leaf's diegetic label IS the NPC's current
// activity; the inspect panel and the deltas read it verbatim.
import type { BehaviorNode } from '../schemas/behavior.js';
import type { Chunk } from '../schemas/chunk.js';
import { deriveSeed, mulberry32, type Rng } from '../generate/rng.js';
import type { Npc } from '../schemas/npc.js';
import { TICK_DT } from './clock.js';

const CHUNK_SIZE = 16; // engine grammar (matches the generator)

export const WALK_SPEED = 1.4; // world units per second

type Leaf = Extract<BehaviorNode, { type: 'move' | 'interact' | 'idle' | 'wander' }>;

export interface NpcState {
  id: string;
  chunk: string;
  /** World-space position. */
  pos: [number, number, number];
  ry: number;
  activity: string;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

// Flatten the tree to the leaf run for the current phase: schedules pick
// their matching entry, sequences concatenate. Empty when no entry matches.
function leavesFor(node: BehaviorNode, phase: string): Leaf[] {
  switch (node.type) {
    case 'schedule': {
      const entry = node.entries.find((e) => e.phase === phase);
      return entry ? leavesFor(entry.child, phase) : [];
    }
    case 'sequence':
      return node.children.flatMap((child) => leavesFor(child, phase));
    default:
      return [node];
  }
}

export class NpcRuntime {
  readonly state: NpcState;
  #npc: Npc;
  #origin: [number, number];
  #navNodes: Map<string, [number, number, number]>;
  #phase = '';
  #leaves: Leaf[] = [];
  #cursor = 0;
  #holdTicks = 0;
  // Personal standing spot: a deterministic offset around any move
  // target, so two NPCs sharing a destination stand beside each other
  // instead of inside each other.
  #offset: [number, number];
  // Seeded per NPC: wandering is random but deterministic (invariant 3).
  #rng: Rng;
  #wanderTarget: [number, number, number] | null = null;

  constructor(npc: Npc, chunk: Chunk, origin: [number, number], worldSeed = 0) {
    this.#npc = npc;
    this.#origin = origin;
    this.#rng = mulberry32(deriveSeed(worldSeed, `npc:${npc.id}`));
    const hash = deriveSeed(0, npc.id);
    const angle = ((hash % 360) * Math.PI) / 180;
    const radius = 0.5 + ((hash >>> 9) % 40) / 100;
    this.#offset = [
      Math.round(Math.cos(angle) * radius * 100) / 100,
      Math.round(Math.sin(angle) * radius * 100) / 100,
    ];
    this.#navNodes = new Map(chunk.nav.nodes.map((n) => [n.id, n.position]));
    const start = chunk.nav.nodes[0]!.position;
    this.state = {
      id: npc.id,
      chunk: chunk.id,
      pos: [round2(origin[0] + start[0]), round2(start[1]), round2(origin[1] + start[2])],
      ry: 0,
      activity: npc.behavior.label,
    };
  }

  /** Hot-swap the tree (the L1 seam): re-plans on the next step, position kept. */
  replaceTree(behavior: BehaviorNode): void {
    this.#npc = { ...this.#npc, behavior };
    this.#phase = ''; // forces re-resolution against the current phase
  }

  #enterLeaf(): void {
    const leaf = this.#leaves[this.#cursor];
    if (!leaf) return;
    this.state.activity = leaf.label;
    if (leaf.type === 'interact' || leaf.type === 'idle') {
      this.#holdTicks = Math.max(1, Math.ceil(leaf.duration_s / TICK_DT));
    }
    if (leaf.type === 'wander') {
      this.#pickWanderTarget(leaf);
    }
  }

  // Drift within the leaf's radius of wherever the day put this NPC,
  // clamped inside the home chunk's walkable margin.
  #pickWanderTarget(leaf: Extract<Leaf, { type: 'wander' }>): void {
    const angle = this.#rng() * Math.PI * 2;
    const dist = 1 + this.#rng() * Math.max(0.1, leaf.radius - 1);
    const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    this.#wanderTarget = [
      clamp(this.state.pos[0] + Math.cos(angle) * dist, this.#origin[0] + 1.5, this.#origin[0] + CHUNK_SIZE - 1.5),
      this.state.pos[1],
      clamp(this.state.pos[2] + Math.sin(angle) * dist, this.#origin[1] + 1.5, this.#origin[1] + CHUNK_SIZE - 1.5),
    ];
  }

  #advance(): void {
    this.#cursor = (this.#cursor + 1) % this.#leaves.length; // ambient life loops
    this.#enterLeaf();
  }

  /** One deterministic tick. Mutates and returns this.state. */
  step(phase: string): NpcState {
    if (phase !== this.#phase) {
      this.#phase = phase;
      this.#leaves = leavesFor(this.#npc.behavior, phase);
      this.#cursor = 0;
      if (this.#leaves.length === 0) {
        // No entry for this phase: the tree's own label narrates the lull.
        this.state.activity = this.#npc.behavior.label;
      } else {
        this.#enterLeaf();
      }
    }
    const leaf = this.#leaves[this.#cursor];
    if (!leaf) return this.state;

    if (leaf.type === 'move') {
      const target = this.#navNodes.get(leaf.to);
      if (!target) {
        this.#advance(); // gate-validated worlds never hit this
        return this.state;
      }
      const [tx, ty, tz] = [
        this.#origin[0] + target[0] + this.#offset[0],
        target[1],
        this.#origin[1] + target[2] + this.#offset[1],
      ];
      const [dx, dy, dz] = [tx - this.state.pos[0], ty - this.state.pos[1], tz - this.state.pos[2]];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const stepLen = WALK_SPEED * TICK_DT;
      if (dist <= stepLen) {
        this.state.pos = [round2(tx), round2(ty), round2(tz)];
        this.#advance();
      } else {
        this.state.pos = [
          round2(this.state.pos[0] + (dx / dist) * stepLen),
          round2(this.state.pos[1] + (dy / dist) * stepLen),
          round2(this.state.pos[2] + (dz / dist) * stepLen),
        ];
        this.state.ry = round3(Math.atan2(dx, dz));
      }
    } else if (leaf.type === 'wander') {
      if (this.#wanderTarget) {
        const [tx, ty, tz] = this.#wanderTarget;
        const [dx, dy, dz] = [tx - this.state.pos[0], ty - this.state.pos[1], tz - this.state.pos[2]];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const stepLen = WALK_SPEED * 0.6 * TICK_DT; // an amble, not an errand
        if (dist <= stepLen) {
          this.state.pos = [round2(tx), round2(ty), round2(tz)];
          this.#wanderTarget = null;
          const pause = leaf.min_pause_s + this.#rng() * (leaf.max_pause_s - leaf.min_pause_s);
          this.#holdTicks = Math.max(1, Math.ceil(pause / TICK_DT));
        } else {
          this.state.pos = [
            round2(this.state.pos[0] + (dx / dist) * stepLen),
            round2(this.state.pos[1] + (dy / dist) * stepLen),
            round2(this.state.pos[2] + (dz / dist) * stepLen),
          ];
          this.state.ry = round3(Math.atan2(dx, dz));
        }
      } else {
        this.#holdTicks -= 1;
        if (this.#holdTicks <= 0) this.#pickWanderTarget(leaf);
      }
    } else {
      this.#holdTicks -= 1;
      if (this.#holdTicks <= 0) this.#advance();
    }
    return this.state;
  }
}
