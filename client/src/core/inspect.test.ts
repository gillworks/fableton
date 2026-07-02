// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildPanelData } from './inspect.js';

const detail = {
  id: 'greta-the-baker',
  identity: {
    name: 'Greta',
    kind: 'witch-gone-respectable',
    story: 'Once fattened children in a gingerbread house; now she feeds the whole square.',
  },
  relationships: [
    { to: 'reynard-the-retired', kind: 'keeps his tab open, suspiciously' },
    { to: 'someone-unknown', kind: 'writes letters, gets none back' },
  ],
  lore: ['the-gingerbread-pardon'],
  tree: "a baker's day",
};

describe('buildPanelData', () => {
  it('maps world-api detail to the design.md anatomy', () => {
    const panel = buildPanelData(detail, new Map([['reynard-the-retired', 'Reynard']]));
    expect(panel.initial).toBe('G');
    expect(panel.name).toBe('Greta');
    expect(panel.role).toBe('witch-gone-respectable');
    expect(panel.bio).toContain('gingerbread');
    expect(panel.relationships[0]).toEqual({
      name: 'Reynard',
      clause: 'keeps his tab open, suspiciously',
    });
    // Unknown ids fall back to the id rather than dropping the entry.
    expect(panel.relationships[1]!.name).toBe('someone-unknown');
    expect(panel.footer).toBe('lore/greta-the-baker.json · tree: a-baker-s-day');
  });
});
