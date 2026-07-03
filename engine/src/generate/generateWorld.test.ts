// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCharter } from '../charter/parse.js';
import { AssetRegistrySchema } from '../schemas/assets.js';
import type { Charter } from '../schemas/charter.js';
import { validateWorld } from '../validate/validateWorld.js';
import { generateWorld } from './generateWorld.js';

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

const fableton: Charter = parseCharter(read('../../../charters/_template/charter.yaml'));
const cindervault: Charter = parseCharter(read('../../test/fixtures/charter-valid.yaml'));
const registry = AssetRegistrySchema.parse(JSON.parse(read('../../test/fixtures/sample-world/assets.json')));

describe('generateWorld', () => {
  it('golden seed: same charter + seed ⇒ byte-identical manifest', () => {
    const { manifest } = generateWorld(fableton, registry);
    expect(JSON.stringify(manifest, null, 2)).toMatchSnapshot();
  });

  it('golden seed: chunks are byte-identical too', () => {
    const { chunks } = generateWorld(fableton, registry);
    expect(JSON.stringify(chunks[0], null, 2)).toMatchSnapshot();
  });

  it('is deterministic across runs in-process', () => {
    expect(generateWorld(fableton, registry)).toEqual(generateWorld(fableton, registry));
  });

  it('stamps founded_at only as an input — never from the wall clock', () => {
    const founded = generateWorld(fableton, registry, { foundedAt: '2026-07-03T02:00:53Z' });
    expect(founded.manifest.founded_at).toBe('2026-07-03T02:00:53Z');
    // Same inputs ⇒ same bytes; omitting the stamp omits the field.
    expect(founded).toEqual(generateWorld(fableton, registry, { foundedAt: '2026-07-03T02:00:53Z' }));
    expect(generateWorld(fableton, registry).manifest.founded_at).toBeUndefined();
  });

  it('a different seed ⇒ a different layout', () => {
    const reseeded: Charter = {
      ...fableton,
      identity: { ...fableton.identity, seed: 7 },
    };
    const a = generateWorld(fableton, registry);
    const b = generateWorld(reseeded, registry);
    expect(JSON.stringify(b.manifest)).not.toEqual(JSON.stringify(a.manifest));
    expect(JSON.stringify(b.chunks)).not.toEqual(JSON.stringify(a.chunks));
  });

  it('a different charter ⇒ a structurally different world (DoD test 2)', () => {
    const a = generateWorld(fableton, registry);
    const b = generateWorld(cindervault, registry);
    expect(b.manifest.world).toBe('Cindervault');
    // Structure, not just bytes: layout graph and dressing differ.
    const shape = (m: typeof a.manifest): string =>
      JSON.stringify(m.chunks.map((c) => [c.id, c.origin, c.adjacent]));
    expect(shape(b.manifest)).not.toEqual(shape(a.manifest));
    expect(b.chunks[0]!.palette).not.toEqual(a.chunks[0]!.palette);
  });

  it('respects charter generation params: scale and caps', () => {
    const capped: Charter = {
      ...fableton,
      generation: {
        ...fableton.generation,
        caps: { ...fableton.generation.caps, max_regions: 2 },
      },
    };
    expect(generateWorld(fableton, registry).manifest.chunks).toHaveLength(8); // village (doubled grammar)
    expect(generateWorld(capped, registry).manifest.chunks).toHaveLength(2);

    const tightPolys: Charter = {
      ...fableton,
      generation: {
        ...fableton.generation,
        caps: { ...fableton.generation.caps, chunk_poly_budget: 200 },
      },
    };
    // Terrain costs 128 triangles; the smallest kit asset is 90 — no prop fits.
    for (const chunk of generateWorld(tightPolys, registry).chunks) {
      expect(chunk.props).toHaveLength(0);
    }
  });

  it('buildings are grounded, palette-derived, and budget-priced', () => {
    const { chunks } = generateWorld(fableton, registry);
    let total = 0;
    for (const chunk of chunks) {
      for (const b of chunk.buildings) {
        total += 1;
        const min = Math.min(...chunk.terrain.heights);
        const max = Math.max(...chunk.terrain.heights);
        expect(b.position[1]).toBeGreaterThanOrEqual(min - 0.01);
        expect(b.position[1]).toBeLessThanOrEqual(max + 0.01);
        expect(b.wall_color).toMatch(/^#[0-9a-f]{6}$/);
        expect(b.roof_color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(total).toBeGreaterThan(chunks.length); // a town, not a field
  });

  it('buildings never intersect each other, props, or the walk lines', () => {
    for (const charter of [fableton, cindervault]) {
      const { chunks } = generateWorld(charter, registry);
      for (const chunk of chunks) {
        const radius = (b: (typeof chunk.buildings)[number]): number => Math.hypot(b.width, b.depth) / 2;
        for (let i = 0; i < chunk.buildings.length; i++) {
          const a = chunk.buildings[i]!;
          for (let j = i + 1; j < chunk.buildings.length; j++) {
            const b = chunk.buildings[j]!;
            const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
            expect(dist, `${chunk.id}: buildings ${i}/${j} overlap`).toBeGreaterThan(radius(a) + radius(b));
          }
          for (const p of chunk.props) {
            const dist = Math.hypot(a.position[0] - p.position[0], a.position[2] - p.position[2]);
            expect(dist, `${chunk.id}: building ${i} sits on prop ${p.asset}`).toBeGreaterThan(radius(a) + 0.8);
          }
          const nodeAt = new Map(chunk.nav.nodes.map((n) => [n.id, n.position]));
          for (const [ea, eb] of chunk.nav.edges) {
            const [ax, , az] = nodeAt.get(ea)!;
            const [bx, , bz] = nodeAt.get(eb)!;
            const dx = bx - ax;
            const dz = bz - az;
            const tt = Math.max(0, Math.min(1, ((a.position[0] - ax) * dx + (a.position[2] - az) * dz) / (dx * dx + dz * dz || 1)));
            const seg = Math.hypot(a.position[0] - (ax + tt * dx), a.position[2] - (az + tt * dz));
            expect(seg, `${chunk.id}: building ${i} blocks a walk line`).toBeGreaterThan(radius(a) + 1);
          }
        }
      }
    }
  });

  it('output passes the validation gate (pnpm validate)', () => {
    for (const charter of [fableton, cindervault]) {
      const { manifest, chunks } = generateWorld(charter, registry);
      const violations = validateWorld(charter, {
        manifest: { file: 'generated/manifest.json', doc: JSON.parse(JSON.stringify(manifest)) },
        registry: { file: 'assets.json', doc: JSON.parse(JSON.stringify(registry)) },
        chunks: chunks.map((c) => ({
          file: `generated/chunks/${c.id}.json`,
          doc: JSON.parse(JSON.stringify(c)),
        })),
        npcs: [],
      });
      expect(violations).toEqual([]);
    }
  });
});
