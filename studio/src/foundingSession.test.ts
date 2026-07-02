// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { charterGate, loadRegistry } from './charterGate.js';
import {
  FoundingSessionError,
  foundingSession,
  type GodMessage,
  type GodModel,
} from './foundingSession.js';

const repoRoot = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, repoRoot), 'utf8');

const templateYaml = read('charters/_template/charter.yaml');
const validCharterYaml = read('engine/test/fixtures/charter-valid.yaml');
const registry = loadRegistry(read('assets/registry.json'));
const validate = charterGate(registry);

/** A god that answers from a script, recording what it was asked. */
const scriptedGod = (responses: string[]): { model: GodModel; calls: GodMessage[][] } => {
  const calls: GodMessage[][] = [];
  const model: GodModel = (_system, messages) => {
    calls.push(structuredClone(messages));
    return Promise.resolve(responses[Math.min(calls.length, responses.length) - 1]!);
  };
  return { model, calls };
};

const prompt = 'A city that banked the last fire.';

describe('foundingSession', () => {
  it('accepts a valid first answer and boots it end-to-end', async () => {
    const { model } = scriptedGod([validCharterYaml]);
    const result = await foundingSession({ prompt, templateYaml, model, validate });
    expect(result.attempts).toBe(1);
    expect(result.charter.identity.name).toBe('Cindervault');
    expect(result.transcript.map((t) => t.role)).toEqual(['founder', 'god']);
  });

  it('strips markdown fences before validating', async () => {
    const { model } = scriptedGod(['```yaml\n' + validCharterYaml + '\n```']);
    const result = await foundingSession({ prompt, templateYaml, model, validate });
    expect(result.charter.identity.name).toBe('Cindervault');
    expect(result.charterYaml.startsWith('```')).toBe(false);
  });

  it('feeds schema errors back and retries until valid', async () => {
    const broken = validCharterYaml.replace('    - banked\n', ''); // 3 day phases
    const { model, calls } = scriptedGod([broken, validCharterYaml]);
    const result = await foundingSession({ prompt, templateYaml, model, validate });
    expect(result.attempts).toBe(2);
    // The second call carries the first answer plus the validation feedback.
    const feedback = calls[1]!.at(-1)!;
    expect(feedback.role).toBe('user');
    expect(feedback.content).toContain('day_phases');
    expect(result.transcript.map((t) => t.role)).toEqual([
      'founder',
      'god',
      'validation',
      'god',
    ]);
  });

  it('feeds gate violations back — a charter that parses but cannot boot is not done', async () => {
    // Schema-valid, but a 1 KiB chunk budget fails the generated world.
    const unbootable = validCharterYaml.replace(
      'chunk_drawcall_budget: 120',
      'chunk_drawcall_budget: 120\n    chunk_kb_budget: 1',
    );
    const { model, calls } = scriptedGod([unbootable, validCharterYaml]);
    const result = await foundingSession({ prompt, templateYaml, model, validate });
    expect(result.attempts).toBe(2);
    expect(calls[1]!.at(-1)!.content).toContain('perf-budget');
  });

  it('gives up after maxAttempts, preserving the founding record', async () => {
    const { model } = scriptedGod(['not: [a, charter]']);
    const run = foundingSession({ prompt, templateYaml, model, validate, maxAttempts: 3 });
    await expect(run).rejects.toThrow(FoundingSessionError);
    await expect(run).rejects.toThrow(/3 attempts/);
    try {
      await foundingSession({ prompt, templateYaml, model, validate, maxAttempts: 2 });
    } catch (error) {
      const transcript = (error as FoundingSessionError).transcript;
      expect(transcript.filter((t) => t.role === 'god')).toHaveLength(2);
      expect(transcript.filter((t) => t.role === 'validation')).toHaveLength(2);
    }
  });

  it('the template itself passes the gate the god is held to', () => {
    expect(validate(templateYaml).errors).toEqual([]);
  });
});
