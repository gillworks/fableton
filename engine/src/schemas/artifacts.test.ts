// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  DecreeLogSchema,
  MasterPlanSchema,
  WorldBibleAmendmentSchema,
  appendDecree,
} from './artifacts.js';

const masterPlan = {
  schema_version: 1,
  kind: 'master-plan',
  world: 'Fableton',
  revision: 3,
  issued: '2026-07-02T09:00:00Z',
  horizon: 'the season of the long lamplighting',
  goals: ['open the orchard quarter', 'resolve the miller–baker feud on stage'],
};

const decreeLog = {
  schema_version: 1,
  kind: 'decree-log',
  world: 'Fableton',
  decrees: [
    { seq: 1, issued: '2026-07-02T09:00:00Z', title: 'On signage', text: 'No sign shall name what a silhouette can say.' },
    { seq: 2, issued: '2026-07-03T09:00:00Z', title: 'On the well', text: 'The well is never dry; it is occasionally shy.' },
  ],
};

const amendment = {
  schema_version: 1,
  kind: 'world-bible-amendment',
  world: 'Fableton',
  seq: 1,
  issued: '2026-07-04T09:00:00Z',
  section: 'inhabitants/guilds',
  change: 'The Tricksters Guild is henceforth licensed, not outlawed.',
  rationale: 'Outlawing them made every plot a chase; licensing makes every plot a negotiation.',
};

describe('MasterPlanSchema', () => {
  it('accepts a valid rolling plan and round-trips', () => {
    const plan = MasterPlanSchema.parse(masterPlan);
    expect(MasterPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('rejects a plan with no goals or a bad timestamp', () => {
    expect(() => MasterPlanSchema.parse({ ...masterPlan, goals: [] })).toThrow();
    expect(() => MasterPlanSchema.parse({ ...masterPlan, issued: 'yesterday-ish' })).toThrow();
  });
});

describe('DecreeLogSchema', () => {
  it('accepts a sequential log and round-trips', () => {
    const log = DecreeLogSchema.parse(decreeLog);
    expect(DecreeLogSchema.parse(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it('accepts an empty log (a young world)', () => {
    expect(() => DecreeLogSchema.parse({ ...decreeLog, decrees: [] })).not.toThrow();
  });

  it('rejects gaps and reordering — the log is append-only', () => {
    const [first, second] = decreeLog.decrees;
    expect(() =>
      DecreeLogSchema.parse({ ...decreeLog, decrees: [second] }),
    ).toThrow(/append-only/);
    expect(() =>
      DecreeLogSchema.parse({ ...decreeLog, decrees: [second, first] }),
    ).toThrow(/append-only/);
  });

  it('appendDecree assigns the next seq', () => {
    const log = DecreeLogSchema.parse(decreeLog);
    const grown = appendDecree(log, {
      issued: '2026-07-05T09:00:00Z',
      title: 'On weather',
      text: 'Rain falls only where it improves the scene.',
    });
    expect(grown.decrees).toHaveLength(3);
    expect(grown.decrees[2]?.seq).toBe(3);
    expect(log.decrees).toHaveLength(2);
  });
});

describe('WorldBibleAmendmentSchema', () => {
  it('accepts a valid amendment, with rationale optional', () => {
    expect(() => WorldBibleAmendmentSchema.parse(amendment)).not.toThrow();
    const { rationale: _rationale, ...bare } = amendment;
    expect(() => WorldBibleAmendmentSchema.parse(bare)).not.toThrow();
  });

  it('rejects a wrong kind and unknown keys', () => {
    expect(() => WorldBibleAmendmentSchema.parse({ ...amendment, kind: 'decree-log' })).toThrow();
    expect(() => WorldBibleAmendmentSchema.parse({ ...amendment, mood: 'plaintive' })).toThrow();
  });
});
