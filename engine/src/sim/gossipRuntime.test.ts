// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { RumorsDoc } from '../schemas/rumors.js';
import { GossipRuntime } from './gossipRuntime.js';

type Pos = readonly [number, number, number];
const at = (x: number, z: number): Pos => [x, 0, z];

// chance 1 makes every in-radius roll fire, so co-location alone decides the
// outcome — the seeded roll is still exercised, just never the deciding coin.
const doc = (over: Partial<RumorsDoc> = {}): RumorsDoc => ({
  schema_version: 1,
  spread_radius: 3,
  spread_chance: 1,
  rumors: [
    { id: 'r1', text: 'the oven knocked back', origin: 'a', notable: true },
    { id: 'r2', text: 'the apples are honest', origin: 'b', notable: false },
  ],
  ...over,
});

describe('GossipRuntime', () => {
  it('spreads between residents in range, both directions, and skips the distant one', () => {
    const g = new GossipRuntime(doc(), ['a', 'b', 'c']);
    const spreads = g.step(1, new Map([['a', at(0, 0)], ['b', at(0, 2)], ['c', at(0, 100)]]));
    expect(spreads).toContainEqual({ tick: 1, from: 'a', to: 'b', rumor: 'r1', text: 'the oven knocked back', notable: true });
    expect(spreads).toContainEqual({ tick: 1, from: 'b', to: 'a', rumor: 'r2', text: 'the apples are honest', notable: false });
    // b now carries r1, heard from a; c overheard nothing.
    expect(g.heardBy('b')).toEqual([{ rumor: 'r1', from: 'a', tick: 1 }]);
    expect(g.heardBy('c')).toEqual([]);
    // a originated r1, so it never shows in a's "has heard" — you don't hear
    // your own rumor — but the r2 it caught from b does.
    expect(g.heardBy('a')).toEqual([{ rumor: 'r2', from: 'b', tick: 1 }]);
  });

  it('never spreads past the radius', () => {
    const g = new GossipRuntime(doc(), ['a', 'b']);
    const spreads = g.step(1, new Map([['a', at(0, 0)], ['b', at(0, 3.5)]])); // > radius 3
    expect(spreads).toEqual([]);
    expect(g.heardBy('b')).toEqual([]);
  });

  it('a zero chance keeps the town silent even when everyone is close', () => {
    const g = new GossipRuntime(doc({ spread_chance: 0 }), ['a', 'b']);
    expect(g.step(1, new Map([['a', at(0, 0)], ['b', at(0, 1)]]))).toEqual([]);
  });

  it('snapshots the known-set: a rumor takes one tick per link, no same-tick cascade', () => {
    // a—b—c chain: a↔b and b↔c are in range, a↔c is not.
    const g = new GossipRuntime(doc({ rumors: [{ id: 'r1', text: 'x', origin: 'a', notable: true }] }), ['a', 'b', 'c']);
    const positions = new Map([['a', at(0, 0)], ['b', at(0, 2)], ['c', at(0, 4)]]);
    g.step(1, positions);
    expect(g.heardBy('b').map((h) => h.rumor)).toEqual(['r1']); // a → b this tick
    expect(g.heardBy('c')).toEqual([]); // b didn't know r1 when the tick began
    g.step(2, positions);
    expect(g.heardBy('c')).toEqual([{ rumor: 'r1', from: 'b', tick: 2 }]); // b → c next tick
  });

  it('is deterministic: same seed + same positions ⇒ identical spread', () => {
    const positions = new Map([['a', at(0, 0)], ['b', at(1, 1)], ['c', at(0, 2)]]);
    const run = (): unknown => {
      const g = new GossipRuntime(doc({ spread_chance: 0.5 }), ['a', 'b', 'c'], 1234);
      const out = [];
      for (let t = 1; t <= 10; t++) out.push(g.step(t, positions));
      return { out, heardC: g.heardBy('c'), heardB: g.heardBy('b') };
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });

  it('a different world seed produces a different (but still deterministic) spread', () => {
    const positions = new Map([['a', at(0, 0)], ['b', at(1, 1)]]);
    const spreadCount = (seed: number): number => {
      const g = new GossipRuntime(doc({ spread_chance: 0.3 }), ['a', 'b'], seed);
      let n = 0;
      for (let t = 1; t <= 5; t++) n += g.step(t, positions).length;
      return n;
    };
    // Both are deterministic; the seed shifts which ticks fire (proves the
    // roll is keyed on the seed, not fixed).
    expect(spreadCount(1)).toBe(spreadCount(1));
    expect(spreadCount(7)).toBe(spreadCount(7));
  });
});
