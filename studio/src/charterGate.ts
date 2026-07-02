// SPDX-License-Identifier: Apache-2.0
//
// The validator the Founding Session loops against: the charter must parse
// (CharterSchema) AND boot a world end-to-end — generate with the canonical
// asset registry and pass the same gate `pnpm validate` runs.
import {
  AssetRegistrySchema,
  generateWorld,
  parseCharter,
  validateWorld,
  type AssetRegistry,
} from '@fableton/engine';
import type { CharterValidator } from './foundingSession.js';

export function charterGate(registry: AssetRegistry): CharterValidator {
  return (charterYaml) => {
    let charter;
    try {
      charter = parseCharter(charterYaml);
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    const { manifest, chunks } = generateWorld(charter, registry);
    const violations = validateWorld(charter, {
      manifest: { file: 'manifest.json', doc: JSON.parse(JSON.stringify(manifest)) },
      registry: { file: 'assets.json', doc: JSON.parse(JSON.stringify(registry)) },
      chunks: chunks.map((c) => ({
        file: `chunks/${c.id}.json`,
        doc: JSON.parse(JSON.stringify(c)),
      })),
      npcs: [],
    });
    return {
      charter,
      errors: violations.map((v) => `[${v.rule}] ${v.file}: ${v.message}`),
    };
  };
}

export function loadRegistry(json: string): AssetRegistry {
  return AssetRegistrySchema.parse(JSON.parse(json));
}
