// SPDX-License-Identifier: Apache-2.0
import { parse as parseYaml } from 'yaml';
import type { Charter } from '../schemas/charter.js';
import { migrateCharter } from './migrate.js';

/**
 * Parse a charter from its authored YAML form (ADR-0001: YAML-first — the
 * canonical wire/storage form is the parsed JSON), migrating older
 * schema_versions to current. Throws on YAML errors, unknown versions, or
 * schema violations.
 */
export function parseCharter(yamlText: string): Charter {
  return migrateCharter(parseYaml(yamlText));
}
