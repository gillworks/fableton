// SPDX-License-Identifier: Apache-2.0
//
// v1 DoD test 3, kept runnable: an invalid chunk (bad asset ref /
// disconnected navmesh / blown budget) fails with a legible error naming
// the violation, and the valid sample world passes.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import type { Charter } from '../schemas/charter.js';
import { validateWorld, type WorldDocs } from './validateWorld.js';

const root = new URL('../../test/fixtures/sample-world/', import.meta.url);
const loadJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const charter: Charter = parseCharter(
  readFileSync(new URL('../../../charters/_template/charter.yaml', import.meta.url), 'utf8'),
);

// Deep-copied per test so mutations don't leak.
const sampleWorld = (): WorldDocs =>
  JSON.parse(
    JSON.stringify({
      manifest: { file: 'manifest.json', doc: loadJson('manifest.json') },
      registry: { file: 'assets.json', doc: loadJson('assets.json') },
      chunks: ['town-square', 'orchard-row', 'mill-lane'].map((id) => ({
        file: `chunks/${id}.json`,
        doc: loadJson(`chunks/${id}.json`),
      })),
      npcs: readdirSync(new URL('npcs/', root))
        .sort()
        .map((f) => ({ file: `npcs/${f}`, doc: loadJson(`npcs/${f}`) })),
    }),
  );

type AnyDoc = Record<string, any>;

describe('validateWorld', () => {
  it('passes the valid sample world', () => {
    expect(validateWorld(charter, sampleWorld())).toEqual([]);
  });

  it('names a schema violation with its file', () => {
    const world = sampleWorld();
    delete (world.chunks[0]!.doc as AnyDoc).palette;
    const schema = validateWorld(charter, world).filter((v) => v.rule === 'schema-valid');
    expect(schema).toHaveLength(1);
    expect(schema[0]).toMatchObject({ file: 'chunks/town-square.json' });
    expect(schema[0]!.message).toContain('palette');
  });

  it('fails a bad asset ref, naming the asset and the chunk file', () => {
    const world = sampleWorld();
    (world.chunks[0]!.doc as AnyDoc).props.push({
      asset: 'chrome-vending-machine',
      position: [1, 0, 1],
    });
    const violations = validateWorld(charter, world);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'asset-refs-resolve', file: 'chunks/town-square.json' });
    expect(violations[0]!.message).toContain('chrome-vending-machine');
  });

  it('fails a disconnected in-chunk nav graph, naming the unreachable nodes', () => {
    const world = sampleWorld();
    const nav = (world.chunks[0]!.doc as AnyDoc).nav;
    nav.edges = nav.edges.filter((e: string[]) => !e.includes('west-gate'));
    const violations = validateWorld(charter, world);
    expect(violations.map((v) => v.rule)).toContain('nav-connectivity');
    expect(violations.map((v) => v.message).join('\n')).toContain('west-gate');
  });

  it('fails a one-way portal — NPCs could enter and never leave', () => {
    const world = sampleWorld();
    const nav = (world.chunks[2]!.doc as AnyDoc).nav; // mill-lane
    nav.portals = [];
    const violations = validateWorld(charter, world);
    expect(violations.map((v) => v.rule)).toContain('nav-connectivity');
    expect(violations.map((v) => v.message).join('\n')).toContain('no return portal');
  });

  it('fails a blown poly budget with the arithmetic shown', () => {
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, chunk_poly_budget: 500 },
      },
    };
    const violations = validateWorld(tight, sampleWorld());
    const budget = violations.filter((v) => v.rule === 'perf-budget');
    expect(budget.length).toBeGreaterThan(0);
    expect(budget[0]!.message).toMatch(/\d+ triangles .* budget is 500/);
  });

  it('fails a blown draw-call budget', () => {
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, chunk_drawcall_budget: 2 },
      },
    };
    const messages = validateWorld(tight, sampleWorld()).map((v) => v.message);
    expect(messages.some((m) => m.includes('draw calls'))).toBe(true);
  });

  it('fails an oversized chunk file against chunk_kb_budget', () => {
    const world = sampleWorld();
    (world.chunks[0]!.doc as AnyDoc).lore = Array.from(
      { length: 300 },
      (_, i) => `an-extremely-long-winded-lore-reference-number-${i}`,
    );
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, chunk_kb_budget: 4 },
      },
    };
    const violations = validateWorld(tight, world).filter((v) => v.rule === 'perf-budget');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('KiB');
  });

  it('fails max_regions when the world outgrows the charter', () => {
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, max_regions: 2 },
      },
    };
    const violations = validateWorld(tight, sampleWorld());
    expect(violations.map((v) => v.message).join('\n')).toContain('max_regions');
  });

  it('fails an asset tagged against a gate-enforced charter rule', () => {
    const world = sampleWorld();
    const registry = world.registry.doc as AnyDoc;
    registry.assets[0].tags.push('Modern Technology');
    const violations = validateWorld(charter, world);
    expect(violations.map((v) => v.rule)).toContain('charter-gate-rule');
    expect(violations.map((v) => v.message).join('\n')).toContain('modern technology');
  });

  it('fails behavior refs that do not resolve: move target, interact target, unknown phase', () => {
    const world = sampleWorld();
    const greta = world.npcs.find((n) => n.file.includes('greta'))!.doc as AnyDoc;
    greta.behavior.entries[0].child.children[0].to = 'the-moon';
    greta.behavior.entries[1].child.with = 'excalibur';
    greta.behavior.entries[3].phase = 'the witching hour';
    const messages = validateWorld(charter, world)
      .filter((v) => v.file.includes('greta'))
      .map((v) => v.message)
      .join('\n');
    expect(messages).toContain('the-moon');
    expect(messages).toContain('excalibur');
    expect(messages).toContain('the witching hour');
  });

  it('accepts an on_event that names a declared calendar event', () => {
    const festive: Charter = {
      ...charter,
      calendar: { events: [{ name: 'Lantern Festival', cadence: { every_days: 2, offset_days: 0 }, phases: [] }] },
    };
    const world = sampleWorld();
    const greta = world.npcs.find((n) => n.file.includes('greta'))!.doc as AnyDoc;
    greta.behavior = {
      type: 'on_event',
      label: "a baker's day, festival or not",
      event: 'Lantern Festival',
      child: { type: 'idle', label: 'feasting in the square', duration_s: 10 },
      otherwise: { type: 'idle', label: 'minding the oven', duration_s: 10 },
    };
    expect(validateWorld(festive, world).filter((v) => v.file.includes('greta'))).toEqual([]);
  });

  it('flags an on_event that names an event the charter calendar does not declare', () => {
    const world = sampleWorld();
    const greta = world.npcs.find((n) => n.file.includes('greta'))!.doc as AnyDoc;
    greta.behavior = {
      type: 'on_event',
      label: "a baker's day",
      event: 'Ghost Festival',
      child: { type: 'idle', label: 'haunting', duration_s: 10 },
    };
    // The template charter declares no events, so the reference cannot resolve.
    const messages = validateWorld(charter, world)
      .filter((v) => v.file.includes('greta'))
      .map((v) => v.message)
      .join('\n');
    expect(messages).toContain('Ghost Festival');
  });

  it('flags an NPC placed in no chunk', () => {
    const world = sampleWorld();
    (world.chunks[1]!.doc as AnyDoc).npcs = []; // orchard-row drops reynard
    const messages = validateWorld(charter, world).map((v) => v.message).join('\n');
    expect(messages).toContain('not placed in any chunk');
  });

  it('passes a valid rumors doc whose origins are all residents (issue #81)', () => {
    const world = sampleWorld();
    world.rumors = { file: 'rumors.json', doc: loadJson('rumors.json') };
    expect(validateWorld(charter, world)).toEqual([]);
  });

  it('flags a rumor whose origin is not a resident, naming rumor and NPC', () => {
    const world = sampleWorld();
    world.rumors = { file: 'rumors.json', doc: loadJson('rumors.json') };
    (world.rumors.doc as AnyDoc).rumors[0].origin = 'a-stranger';
    const violations = validateWorld(charter, world);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'asset-refs-resolve', file: 'rumors.json' });
    expect(violations[0]!.message).toContain('a-stranger');
    expect(violations[0]!.message).toContain('the-cold-oven');
  });

  it('flags a schema-invalid rumors doc against its file', () => {
    const world = sampleWorld();
    world.rumors = { file: 'rumors.json', doc: loadJson('rumors.json') };
    (world.rumors.doc as AnyDoc).spread_chance = 5; // out of [0,1]
    const schema = validateWorld(charter, world).filter((v) => v.rule === 'schema-valid');
    expect(schema).toHaveLength(1);
    expect(schema[0]).toMatchObject({ file: 'rumors.json' });
  });
});
