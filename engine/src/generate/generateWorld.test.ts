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
    expect(generateWorld(fableton, registry).manifest.chunks).toHaveLength(5); // village
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
