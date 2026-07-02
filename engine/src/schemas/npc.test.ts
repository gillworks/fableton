// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NpcSchema, type Npc } from './npc.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/sample-world/npcs/greta-the-baker.json', import.meta.url),
      'utf8',
    ),
  );

const validNpc = (): Npc => NpcSchema.parse(load());

describe('NpcSchema', () => {
  it('accepts a valid NPC and round-trips', () => {
    const npc = validNpc();
    expect(npc.identity.name).toBe('Greta');
    expect(npc.behavior.type).toBe('schedule');
    expect(NpcSchema.parse(JSON.parse(JSON.stringify(npc)))).toEqual(npc);
  });

  it('rejects a behavior tree with any unlabeled node, however deep', () => {
    const npc = load() as { behavior: { entries: { child: { children?: { label?: string }[] } }[] } };
    // Strip the label from a leaf two composites down: schedule → sequence → interact.
    delete npc.behavior.entries[0]!.child.children![1]!.label;
    expect(() => NpcSchema.parse(npc)).toThrow(/label/);
  });

  it('rejects an empty-string label (a label that says nothing is unlabeled)', () => {
    const npc = load() as { behavior: { label: string } };
    npc.behavior.label = '';
    expect(() => NpcSchema.parse(npc)).toThrow(/label/);
  });

  it('rejects unknown behavior node types', () => {
    const npc = validNpc();
    expect(() =>
      NpcSchema.parse({
        ...npc,
        behavior: { type: 'monologue', label: 'soliloquizing' },
      }),
    ).toThrow();
  });

  it('rejects a schedule with no entries and a sequence with no children', () => {
    const npc = validNpc();
    expect(() =>
      NpcSchema.parse({ ...npc, behavior: { type: 'schedule', label: 'an empty day', entries: [] } }),
    ).toThrow();
    expect(() =>
      NpcSchema.parse({ ...npc, behavior: { type: 'sequence', label: 'doing nothing', children: [] } }),
    ).toThrow();
  });

  it('rejects an NPC with a relationship to itself', () => {
    const npc = validNpc();
    expect(() =>
      NpcSchema.parse({
        ...npc,
        relationships: [{ to: npc.id, kind: 'talks to herself' }],
      }),
    ).toThrow(/itself/);
  });
});
