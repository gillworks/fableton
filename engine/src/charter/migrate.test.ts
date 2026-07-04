// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { CHARTER_SCHEMA_VERSION } from '../schemas/charter.js';
import { migrateCharter } from './migrate.js';

const v0doc = (): unknown =>
  parseYaml(readFileSync(new URL('../../test/fixtures/charter-v0.yaml', import.meta.url), 'utf8'));

describe('migrateCharter', () => {
  it('migrates a schema_version 0 charter to current', () => {
    const charter = migrateCharter(v0doc());
    expect(charter.schema_version).toBe(CHARTER_SCHEMA_VERSION);
    expect(charter.identity.name).toBe('Fableton');
  });

  it('wraps v0 string rules as prompt-enforced (gate is opt-in per rule)', () => {
    const charter = migrateCharter(v0doc());
    expect(charter.aesthetic.never).toContainEqual({ rule: 'gore', enforced: 'prompt' });
    expect(charter.taboos.every((t) => t.enforced === 'prompt')).toBe(true);
  });

  it('gives a pre-calendar charter an empty town-events calendar (v1 → v2)', () => {
    expect(migrateCharter(v0doc()).calendar).toEqual({ events: [] });
  });

  it('preserves a calendar already present when migrating from v1', () => {
    const v1 = migrateCharter(v0doc());
    const withCalendar = {
      ...JSON.parse(JSON.stringify(v1)),
      schema_version: 1,
      calendar: { events: [{ name: 'Market Day', cadence: { every_days: 3 } }] },
    };
    const migrated = migrateCharter(withCalendar);
    expect(migrated.schema_version).toBe(CHARTER_SCHEMA_VERSION);
    expect(migrated.calendar.events[0]!.name).toBe('Market Day');
    expect(migrated.calendar.events[0]!.cadence).toEqual({ every_days: 3, offset_days: 0 });
  });

  it('passes a current-version charter through unchanged', () => {
    const migrated = migrateCharter(v0doc());
    expect(migrateCharter(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('rejects unknown schema_versions', () => {
    expect(() => migrateCharter({ schema_version: 999 })).toThrow(/unknown charter schema_version/);
    expect(() => migrateCharter({ schema_version: 'zero' })).toThrow(/unknown charter schema_version/);
  });

  it('rejects non-mapping documents', () => {
    expect(() => migrateCharter('a charter, but as prose')).toThrow(/mapping/);
    expect(() => migrateCharter(null)).toThrow(/mapping/);
  });
});
