// SPDX-License-Identifier: Apache-2.0
import { CHARTER_SCHEMA_VERSION, CharterSchema, type Charter } from '../schemas/charter.js';

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

// v0 (pre-v1 draft template): aesthetic.never and taboos entries were plain
// strings. v1 marks each with its enforcement channel; 'prompt' is the safe
// default — gate enforcement is opt-in per rule (ADR-0001).
const migrateV0toV1: Migration = (doc) => {
  const wrap = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map((entry) => (typeof entry === 'string' ? { rule: entry, enforced: 'prompt' } : entry))
      : value;

  const aesthetic = isRecord(doc['aesthetic'])
    ? { ...doc['aesthetic'], never: wrap(doc['aesthetic']['never']) }
    : doc['aesthetic'];

  return {
    ...doc,
    schema_version: 1,
    aesthetic,
    taboos: wrap(doc['taboos']),
  };
};

// v2 adds the town-events calendar (issue #62). Pre-calendar charters simply
// have no events; the flagship and every earlier charter migrate untouched.
const migrateV1toV2: Migration = (doc) => ({
  ...doc,
  schema_version: 2,
  calendar: isRecord(doc['calendar']) ? doc['calendar'] : { events: [] },
});

const MIGRATIONS: Record<number, Migration> = {
  0: migrateV0toV1,
  1: migrateV1toV2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Migrate a raw charter document (any known schema_version) up to the
 * current version and validate it. Throws on unknown versions or documents
 * that fail CharterSchema after migration.
 */
export function migrateCharter(doc: unknown): Charter {
  if (!isRecord(doc)) {
    throw new Error('charter document must be a mapping at the top level');
  }
  let current = doc;
  let version = current['schema_version'];
  while (version !== CHARTER_SCHEMA_VERSION) {
    if (typeof version !== 'number' || !(version in MIGRATIONS)) {
      throw new Error(
        `unknown charter schema_version: ${JSON.stringify(version)} (this engine reads versions 0..${CHARTER_SCHEMA_VERSION})`,
      );
    }
    current = MIGRATIONS[version]!(current);
    version = current['schema_version'];
  }
  return CharterSchema.parse(current);
}
