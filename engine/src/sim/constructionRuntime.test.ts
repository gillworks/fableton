// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ConstructionSiteSchema, type ConstructionSite } from '../schemas/construction.js';
import { ConstructionRuntime } from './constructionRuntime.js';

// A minimal but schema-valid site. The runtime reads id/chunk/position/
// footprint/builder_roles/stages; completion is carried for the client but
// the interpreter never touches it.
const site = (over: Record<string, unknown> = {}): ConstructionSite =>
  ConstructionSiteSchema.parse({
    schema_version: 1,
    id: 'bakery-extension',
    chunk: 'town-square',
    position: [4, 0, 4],
    footprint: { width: 4, depth: 4 }, // reach = 2 + margin(2) = 4, radius² = 16
    builder_roles: ['master builder'],
    stages: [
      { name: 'marked plot', asset: 'stakes', work_units: 2 },
      { name: 'foundation', asset: 'foundation-mesh', work_units: 3 },
      { name: 'frame', asset: 'frame-mesh', work_units: 4 },
    ],
    completion: { props: [{ asset: 'bakery', position: [4, 0, 4] }] },
    ...over,
  });

const origins = new Map<string, readonly [number, number]>([['town-square', [0, 0]]]);
// identity.kind, deliberately unslugged — the runtime slugifies to match the
// gate ("Master Builder" ≡ "master builder" ≡ "master builder").
const roles = new Map<string, string>([
  ['mabel', 'Master Builder'],
  ['greta', 'witch-gone-respectable'],
]);

const onSite = new Map<string, readonly [number, number, number]>([['mabel', [4, 0, 4]]]);

// Run a fresh runtime for `ticks`, feeding the same positions each tick.
// Returns the transitions and the final state.
const run = (
  positions: ReadonlyMap<string, readonly [number, number, number]>,
  ticks: number,
  seed = 42,
  sites: ConstructionSite[] = [site()],
): { transitions: ReturnType<ConstructionRuntime['step']>; rt: ConstructionRuntime } => {
  const rt = new ConstructionRuntime(sites, origins, roles, seed);
  const transitions = [];
  for (let t = 1; t <= ticks; t++) transitions.push(...rt.step(t, positions));
  return { transitions, rt };
};

describe('ConstructionRuntime', () => {
  it('does not progress a site with no builder present', () => {
    const { transitions, rt } = run(new Map(), 50);
    expect(transitions).toEqual([]);
    const [s] = rt.state();
    expect(s).toMatchObject({ stageIndex: 0, progress: 0, complete: false, workers: [] });
  });

  it('only counts role-matched residents standing on the site as workers', () => {
    // greta is on the footprint but is not a builder; a stranger far away is.
    const positions = new Map<string, readonly [number, number, number]>([
      ['mabel', [4, 0, 4]], // builder, on site
      ['greta', [4, 0, 4]], // wrong role
    ]);
    const rt = new ConstructionRuntime([site()], origins, roles, 1);
    rt.step(1, positions);
    expect(rt.state()[0]!.workers).toEqual(['mabel']);

    // Same builder, but standing off the footprint (radius² = 16 ⇒ >4 away).
    const away = new Map<string, readonly [number, number, number]>([['mabel', [4, 0, 20]]]);
    const rt2 = new ConstructionRuntime([site()], origins, roles, 1);
    rt2.step(1, away);
    expect(rt2.state()[0]!.workers).toEqual([]);
    expect(rt2.state()[0]!.progress).toBe(0);
  });

  it('climbs its authored stages in order and completes, with diegetic lines', () => {
    const { transitions, rt } = run(onSite, 200);
    expect(transitions.map((t) => t.stage)).toEqual(['foundation', 'frame', 'frame']);
    expect(transitions.map((t) => t.done)).toEqual([false, false, true]);
    expect(transitions.map((t) => t.text)).toEqual([
      'the bakery extension — foundation',
      'the bakery extension — frame',
      'the bakery extension is complete',
    ]);
    // Ticks strictly increase: work is spent over time, not all at once.
    for (let i = 1; i < transitions.length; i++) {
      expect(transitions[i]!.tick).toBeGreaterThanOrEqual(transitions[i - 1]!.tick);
    }
    const [s] = rt.state();
    expect(s).toMatchObject({ stageIndex: 3, stageCount: 3, complete: true, required: 0, workers: [] });
  });

  it('is deterministic: same seed + positions + ticks ⇒ identical state and transitions', () => {
    const a = run(onSite, 30, 7);
    const b = run(onSite, 30, 7);
    expect(JSON.stringify(a.rt.state())).toBe(JSON.stringify(b.rt.state()));
    expect(JSON.stringify(a.transitions)).toBe(JSON.stringify(b.transitions));
  });

  it('walks sites and workers in sorted-id order regardless of input order', () => {
    const two = [site({ id: 'zed-tower' }), site({ id: 'aardvark-hall' })];
    const rt = new ConstructionRuntime(two, origins, roles, 3);
    rt.step(1, new Map([['mabel', [4, 0, 4]]]));
    expect(rt.state().map((s) => s.id)).toEqual(['aardvark-hall', 'zed-tower']);
  });

  it('accrues nothing on a completed site (no further transitions or workers)', () => {
    const { rt } = run(onSite, 200);
    expect(rt.state()[0]!.complete).toBe(true);
    const more = rt.step(999, onSite);
    expect(more).toEqual([]);
    expect(rt.state()[0]!.workers).toEqual([]);
  });

  // openSite puts a site the expansion plan opened onto the board mid-run
  // (issue #107) — the reverse wire of the completion→prerequisite loop.
  it('openSite makes a mid-run site constructible and keeps sorted order', () => {
    // Start with one site; open a second whose id sorts BEFORE it. Both must
    // then walk in sorted-id order (state and step iterate that order).
    const rt = new ConstructionRuntime([site({ id: 'zed-tower' })], origins, roles, 5);
    expect(rt.openSite(site({ id: 'aardvark-hall' }))).toBe(true);
    expect(rt.state().map((s) => s.id)).toEqual(['aardvark-hall', 'zed-tower']);
    // The freshly opened site is workable immediately: a builder on its plot
    // accrues and it climbs off stage 0.
    const onBoth = new Map<string, readonly [number, number, number]>([['mabel', [4, 0, 4]]]);
    for (let t = 1; t <= 200; t++) rt.step(t, onBoth);
    expect(rt.state().find((s) => s.id === 'aardvark-hall')).toMatchObject({ complete: true });
  });

  it('openSite is idempotent by id: an already-present site is left untouched', () => {
    const rt = new ConstructionRuntime([site()], origins, roles, 5);
    // Advance the site a little so it holds real progress.
    rt.step(1, onSite);
    const before = JSON.stringify(rt.state());
    // Re-opening the same id (e.g. a site both boot-seeded AND named by the
    // plan) is a no-op: it returns false and does not reset progress.
    expect(rt.openSite(site())).toBe(false);
    expect(rt.state()).toHaveLength(1);
    expect(JSON.stringify(rt.state())).toBe(before);
  });
});
