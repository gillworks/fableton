// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARTER_SCHEMA_VERSION } from '../schemas/charter.js';
import { parseCharter } from './parse.js';

describe('parseCharter', () => {
  it('parses charters/_template/charter.yaml cleanly (v1 acceptance)', () => {
    const yamlText = readFileSync(
      new URL('../../../charters/_template/charter.yaml', import.meta.url),
      'utf8',
    );
    const charter = parseCharter(yamlText);
    expect(charter.schema_version).toBe(CHARTER_SCHEMA_VERSION);
    expect(charter.identity.name).toBe('Fableton');
    expect(charter.identity.seed).toBe(20260702);
    expect(charter.aesthetic.day_phases).toEqual(['first light', 'high sun', 'lamplighting', 'hush']);
  });

  it('rejects YAML that is not a charter', () => {
    expect(() => parseCharter('just: [some, yaml]')).toThrow();
  });

  it('rejects malformed YAML', () => {
    expect(() => parseCharter('identity: [unclosed')).toThrow();
  });
});
