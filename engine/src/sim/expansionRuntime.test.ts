// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExpansionPlanSchema, type ExpansionPlan } from '../schemas/expansion.js';
import { ExpansionRuntime } from './expansionRuntime.js';

const plan = (): ExpansionPlan =>
  ExpansionPlanSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../test/fixtures/expansion/valid-starter-plan.json', import.meta.url), 'utf8'),
    ),
  );

describe('ExpansionRuntime', () => {
  it('opens a day-gated site once its day arrives, and only once', () => {
    const rt = new ExpansionRuntime(plan());
    // town-well needs day ≥ 1; market-hall needs town-well complete AND day ≥ 2.
    // Each opening also carries the site's full authored def (issue #107); the
    // chronicle only reads site + stage, so match those.
    expect(rt.step(1, new Set())).toMatchObject([{ site: 'town-well', stage: 'marked plot' }]);
    expect(rt.step(2, new Set())).toEqual([]); // town-well already open; market-hall waits on completion
    expect(rt.openSites()).toEqual(['town-well']);
  });

  it('opens a site_complete-gated site only when both its day and its dependency are met', () => {
    const rt = new ExpansionRuntime(plan());
    rt.step(1, new Set());
    // Dependency complete but day not yet reached: still waits.
    expect(rt.step(1, new Set(['town-well']))).toEqual([]);
    // Day reached but dependency not complete: still waits.
    expect(rt.step(2, new Set())).toEqual([]);
    // Both met: it opens, and the opening carries the full construction_site
    // def so the consumer can raise it (issue #107).
    const opened = rt.step(2, new Set(['town-well']));
    expect(opened).toMatchObject([{ site: 'market-hall', stage: 'marked plot' }]);
    expect(opened[0]!.def).toMatchObject({ id: 'market-hall', builder_roles: ['master builder'] });
    expect(opened[0]!.def.stages[0]!.name).toBe('marked plot');
    expect(rt.step(3, new Set(['town-well']))).toEqual([]); // opens exactly once
    expect(rt.openSites()).toEqual(['town-well', 'market-hall']);
  });

  it('is deterministic: identical (day, completed) streams open identical sequences', () => {
    const run = (): SiteOpeningLog => {
      const rt = new ExpansionRuntime(plan());
      const log: SiteOpeningLog = [];
      const script: [number, string[]][] = [
        [0, []],
        [1, []],
        [1, ['town-well']],
        [2, []],
        [2, ['town-well']],
        [3, ['town-well']],
      ];
      for (const [day, completed] of script) log.push(rt.step(day, new Set(completed)));
      return log;
    };
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });

  it('a resumed world re-derives its open set without re-announcing (step is idempotent)', () => {
    // The sim seeds a resumed world by stepping the runtime to its start day
    // (WorldSim.#growTown with no tick, issue #107): sites whose prerequisites
    // already held come back marked open, and stepping the same day again
    // yields nothing new — so a redeploy never re-breaks ground.
    const rt = new ExpansionRuntime(plan());
    expect(rt.step(5, new Set())).toMatchObject([{ site: 'town-well', stage: 'marked plot' }]);
    expect(rt.openSites()).toEqual(['town-well']);
    expect(rt.step(5, new Set())).toEqual([]); // nothing re-announced
  });
});

type SiteOpeningLog = { site: string; stage: string }[][];
