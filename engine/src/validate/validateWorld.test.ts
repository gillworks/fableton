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

// A resident who can work a site, placed in the square (idle behaviour: no
// refs to resolve). identity.kind "master builder" is the role a site's
// builder_roles reuse (issue #91).
const builderNpc = (): { file: string; doc: AnyDoc } => ({
  file: 'npcs/mabel-the-mason.json',
  doc: {
    schema_version: 1,
    id: 'mabel-the-mason',
    identity: { name: 'Mabel', kind: 'master builder', story: 'raises the town beam by beam' },
    lore: [],
    relationships: [],
    behavior: { type: 'idle', label: 'laying stone', duration_s: 10 },
  },
});

const loadSite = (): AnyDoc =>
  JSON.parse(
    readFileSync(new URL('../../test/fixtures/construction/valid-bakery-extension.json', import.meta.url), 'utf8'),
  );

// sampleWorld() + a resident who can build + the fixture site, its roles
// trimmed to the one role that resident fills so refs resolve.
const worldWithSite = (): WorldDocs => {
  const world = sampleWorld();
  world.npcs.push(builderNpc());
  (world.chunks[0]!.doc as AnyDoc).npcs.push('mabel-the-mason'); // town-square
  const site = loadSite();
  site['builder_roles'] = ['master builder'];
  world.constructionSites = [{ file: 'construction/bakery-extension.json', doc: site }];
  return world;
};

describe('validateWorld — construction sites', () => {
  it('passes a valid site whose refs, footprint, and budget all hold', () => {
    expect(validateWorld(charter, worldWithSite())).toEqual([]);
  });

  it('fails a stage that shows an unknown asset, naming it and the site file', () => {
    const world = worldWithSite();
    (world.constructionSites![0]!.doc as AnyDoc).stages[0].asset = 'chrome-scaffold';
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'asset-refs-resolve');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'construction/bakery-extension.json' });
    expect(violations[0]!.message).toContain('chrome-scaffold');
  });

  it('fails a completion prop that places an unknown asset', () => {
    const world = worldWithSite();
    (world.constructionSites![0]!.doc as AnyDoc).completion.props.push({ asset: 'hover-drone', position: [11, 0, 11] });
    const messages = validateWorld(charter, world).map((v) => v.message).join('\n');
    expect(messages).toContain('hover-drone');
  });

  it('fails a site that rises in an unknown chunk', () => {
    const world = worldWithSite();
    (world.constructionSites![0]!.doc as AnyDoc).chunk = 'atlantis';
    const messages = validateWorld(charter, world).map((v) => v.message).join('\n');
    expect(messages).toContain('unknown chunk "atlantis"');
  });

  it('fails a builder role that matches no resident', () => {
    const world = worldWithSite();
    (world.constructionSites![0]!.doc as AnyDoc).builder_roles = ['dragon'];
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'asset-refs-resolve');
    expect(violations.map((v) => v.message).join('\n')).toContain('builder role "dragon"');
  });

  it('fails a footprint that buries a portal node — a border crossing lost', () => {
    const world = worldWithSite();
    const site = world.constructionSites![0]!.doc as AnyDoc;
    site.position = [15, 0, 8]; // town-square east-gate → orchard-row portal
    site.footprint = { width: 2, depth: 2 };
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'nav-connectivity');
    expect(violations.map((v) => v.message).join('\n')).toContain('east-gate');
  });

  it('fails a footprint that disconnects the walk graph by burying the hub', () => {
    const world = worldWithSite();
    const site = world.constructionSites![0]!.doc as AnyDoc;
    site.position = [8, 0, 8]; // square-center — every edge runs through it
    site.footprint = { width: 2, depth: 2 };
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'nav-connectivity');
    expect(violations.map((v) => v.message).join('\n')).toMatch(/unreachable once the site/);
  });

  it('fails a footprint that a walkway edge runs through, though no node is buried', () => {
    const world = worldWithSite();
    const site = world.constructionSites![0]!.doc as AnyDoc;
    // square-center (8,8) → east-gate (15,8) runs along z=8; this footprint sits
    // on that segment at x≈11.5 without covering either endpoint.
    site.position = [11.5, 0, 8];
    site.footprint = { width: 2, depth: 2 };
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'nav-connectivity');
    const msg = violations.map((v) => v.message).join('\n');
    expect(msg).toContain('east-gate');
    expect(msg).toMatch(/once the site's footprint is placed/);
  });

  it('charges each site against the chunk draw-call budget', () => {
    // town-square base = 1 terrain + 4 props = 5 draw calls; the fixture site's
    // completion (1 building → 6 draw calls) pushes it to 11. Budget 10 passes
    // the bare chunk but trips once the site is charged.
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, chunk_drawcall_budget: 10 },
      },
    };
    const violations = validateWorld(tight, worldWithSite()).filter(
      (v) => v.rule === 'perf-budget' && v.file === 'chunks/town-square.json',
    );
    const msg = violations.map((v) => v.message).join('\n');
    expect(msg).toContain('draw calls');
    expect(msg).toContain('construction site(s)');
  });

  it('rejects a site that lists the same builder role twice', () => {
    const world = worldWithSite();
    (world.constructionSites![0]!.doc as AnyDoc).builder_roles = ['master builder', 'master builder'];
    const messages = validateWorld(charter, world).map((v) => v.message).join('\n');
    expect(messages).toContain('duplicate builder role "master builder"');
  });

  it('rejects two sites sharing an id across files', () => {
    const world = worldWithSite();
    const dup = loadSite();
    dup['builder_roles'] = ['master builder'];
    world.constructionSites!.push({ file: 'construction/bakery-extension-copy.json', doc: dup });
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'duplicate-id');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('already defined');
  });

  it('charges staged meshes against the chunk poly budget', () => {
    const tight: Charter = {
      ...charter,
      generation: {
        ...charter.generation,
        caps: { ...charter.generation.caps, chunk_poly_budget: 500 },
      },
    };
    const violations = validateWorld(tight, worldWithSite()).filter(
      (v) => v.rule === 'perf-budget' && v.file === 'chunks/town-square.json',
    );
    // Heaviest stage mesh (cart, 608) beats the completion building (200), so
    // the site adds 608 tris to town-square's line item.
    expect(violations.map((v) => v.message).join('\n')).toContain('construction 608');
  });
});

const loadPlan = (): AnyDoc =>
  JSON.parse(
    readFileSync(new URL('../../test/fixtures/expansion/valid-starter-plan.json', import.meta.url), 'utf8'),
  );

// sampleWorld() + a resident who can build + the starter plan whose two sites
// are pre-placed in the town square. The fixture's builder_roles already read
// "master builder", the role that resident fills, so refs resolve.
const worldWithPlan = (): WorldDocs => {
  const world = sampleWorld();
  world.npcs.push(builderNpc());
  (world.chunks[0]!.doc as AnyDoc).npcs.push('mabel-the-mason'); // town-square
  world.expansionPlan = { file: 'expansion-plan.json', doc: loadPlan() };
  return world;
};

describe('validateWorld — expansion plans', () => {
  it('passes a plan whose pre-placed sites all hold statically', () => {
    expect(validateWorld(charter, worldWithPlan())).toEqual([]);
  });

  it('validates a planned site like any other: an unknown chunk fails, naming the plan file', () => {
    const world = worldWithPlan();
    (world.expansionPlan!.doc as AnyDoc).queue[0].site.chunk = 'atlantis';
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'asset-refs-resolve');
    expect(violations.map((v) => v.message).join('\n')).toContain('unknown chunk "atlantis"');
    expect(violations.some((v) => v.file === 'expansion-plan.json')).toBe(true);
  });

  it('rejects a planned site whose footprint overlaps another building', () => {
    const world = worldWithPlan();
    const queue = (world.expansionPlan!.doc as AnyDoc).queue;
    // Drop market-hall onto town-well's footprint — they would share ground.
    queue[1].site.position = queue[0].site.position;
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'footprint-overlap');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toMatch(/overlaps site "town-well"/);
    expect(violations[0]!.file).toBe('expansion-plan.json');
  });

  it('rejects a planned site whose footprint disconnects the walk graph', () => {
    const world = worldWithPlan();
    const site = (world.expansionPlan!.doc as AnyDoc).queue[0].site;
    site.position = [8, 0, 8]; // square-center — every edge runs through the hub
    site.footprint = { width: 2, depth: 2 };
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'nav-connectivity');
    expect(violations.map((v) => v.message).join('\n')).toMatch(/unreachable once the site/);
  });

  it('adjacent (edge-touching) footprints do not count as overlap', () => {
    const world = worldWithPlan();
    const queue = (world.expansionPlan!.doc as AnyDoc).queue;
    // town-well is 3×3 centred at (11,11) → east edge at x=12.5. Place market-hall
    // 3×3 centred at (14,11) → west edge at x=12.5: they share an edge, no overlap.
    queue[1].site.position = [14, 0, 11];
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'footprint-overlap');
    expect(violations).toEqual([]);
  });

  it('a planned site clashing with a standing construction site is caught across both pools', () => {
    const world = worldWithPlan();
    const standing = loadSite(); // fixture bakery site at (11,0,11), same as town-well
    standing['builder_roles'] = ['master builder'];
    world.constructionSites = [{ file: 'construction/bakery-extension.json', doc: standing }];
    const violations = validateWorld(charter, world).filter((v) => v.rule === 'footprint-overlap');
    expect(violations.some((v) => v.message.includes('bakery-extension'))).toBe(true);
  });
});
