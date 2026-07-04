// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExpansionPlanSchema, type ExpansionPlan } from './expansion.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/expansion/valid-starter-plan.json', import.meta.url),
      'utf8',
    ),
  );

const validPlan = (): ExpansionPlan => ExpansionPlanSchema.parse(load());

describe('ExpansionPlanSchema', () => {
  it('accepts a valid plan and round-trips (parse → serialize → parse)', () => {
    const plan = validPlan();
    expect(plan.id).toBe('starter-plan');
    expect(plan.queue.map((e) => e.site.id)).toEqual(['town-well', 'market-hall']);
    expect(plan.queue[0]!.prerequisites).toEqual([{ type: 'day', min_day: 1 }]);
    expect(plan.queue[1]!.prerequisites).toEqual([
      { type: 'site_complete', site: 'town-well' },
      { type: 'day', min_day: 2 },
    ]);
    expect(ExpansionPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('defaults an entry with no prerequisites to open immediately', () => {
    const raw = load() as { queue: Record<string, unknown>[] };
    delete raw.queue[0]!['prerequisites'];
    const plan = ExpansionPlanSchema.parse(raw);
    expect(plan.queue[0]!.prerequisites).toEqual([]);
  });

  it('rejects an unknown schema_version', () => {
    expect(() => ExpansionPlanSchema.parse({ ...validPlan(), schema_version: 99 })).toThrow();
  });

  it('rejects an empty queue — a plan must plan something', () => {
    expect(() => ExpansionPlanSchema.parse({ ...validPlan(), queue: [] })).toThrow();
  });

  it('rejects a non-positive or non-integer day prerequisite', () => {
    const plan = validPlan();
    const withMinDay = (min_day: number): unknown => ({
      ...plan,
      queue: [{ site: plan.queue[0]!.site, prerequisites: [{ type: 'day', min_day }] }],
    });
    expect(() => ExpansionPlanSchema.parse(withMinDay(0))).toThrow();
    expect(() => ExpansionPlanSchema.parse(withMinDay(2.5))).toThrow();
  });

  it('rejects duplicate site ids across the queue', () => {
    const plan = validPlan();
    const clash = { ...plan.queue[1]!, site: { ...plan.queue[1]!.site, id: 'town-well' } };
    expect(() => ExpansionPlanSchema.parse({ ...plan, queue: [plan.queue[0]!, clash] })).toThrow(
      /duplicate site id/,
    );
  });

  it('rejects a site_complete prerequisite naming an unknown site', () => {
    const plan = validPlan();
    const raw = JSON.parse(JSON.stringify(load())) as ExpansionPlan;
    raw.queue[1]!.prerequisites = [{ type: 'site_complete', site: 'nowhere' }];
    expect(() => ExpansionPlanSchema.parse(raw)).toThrow(/references unknown site/);
  });

  it('rejects a site_complete prerequisite pointing forward (or at itself)', () => {
    const raw = JSON.parse(JSON.stringify(load())) as ExpansionPlan;
    // The first entry waits on the second, which has not run yet — a cycle.
    raw.queue[0]!.prerequisites = [{ type: 'site_complete', site: 'market-hall' }];
    expect(() => ExpansionPlanSchema.parse(raw)).toThrow(/not an earlier entry/);
  });

  it('rejects an unknown extra key (strict object)', () => {
    expect(() => ExpansionPlanSchema.parse({ ...validPlan(), cadence: 'annual' })).toThrow();
  });

  it('rejects a non-slug plan id', () => {
    expect(() => ExpansionPlanSchema.parse({ ...validPlan(), id: 'Starter Plan' })).toThrow();
  });
});
