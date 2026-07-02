// SPDX-License-Identifier: Apache-2.0
//
// Founding Session CLI — runnable standalone, no compose stack.
// Usage: pnpm found --prompt <text | @file> --out <dir>
// Writes <out>/charter.yaml and <out>/founding-session.md (the founding
// record: prompt, every god response, every validation round).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { charterGate, loadRegistry } from './charterGate.js';
import { FoundingSessionError, foundingSession, type TranscriptEntry } from './foundingSession.js';
import { DEFAULT_GOD_MODEL, anthropicGodModel } from './godModel.js';

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.prompt || !values.out) {
  console.error('usage: cli.ts --prompt "<paragraph>" | --prompt @premise.txt --out <dir>');
  process.exit(2);
}
const prompt = values.prompt.startsWith('@')
  ? readFileSync(values.prompt.slice(1), 'utf8').trim()
  : values.prompt;
const outDir = values.out;

const repoRoot = new URL('../../', import.meta.url);
const templateYaml = readFileSync(new URL('charters/_template/charter.yaml', repoRoot), 'utf8');
const registry = loadRegistry(readFileSync(new URL('assets/registry.json', repoRoot), 'utf8'));
const model = process.env['GOD_MODEL'] ?? DEFAULT_GOD_MODEL;

const startedAt = new Date().toISOString();

const record = (transcript: TranscriptEntry[], outcome: string): string => {
  const heading: Record<TranscriptEntry['role'], string> = {
    founder: '## The founder speaks',
    god: '## The god answers',
    validation: '## The gate answers',
  };
  return [
    '# Founding Session',
    '',
    `- model: \`${model}\``,
    `- started: ${startedAt}`,
    `- finished: ${new Date().toISOString()}`,
    `- outcome: ${outcome}`,
    '',
    ...transcript.flatMap((entry) => [
      heading[entry.role],
      '',
      entry.role === 'god' ? '```yaml\n' + entry.content + '\n```' : entry.content,
      '',
    ]),
  ].join('\n');
};

try {
  const result = await foundingSession({
    prompt,
    templateYaml,
    model: anthropicGodModel(model),
    validate: charterGate(registry),
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'charter.yaml'), result.charterYaml + '\n');
  writeFileSync(
    join(outDir, 'founding-session.md'),
    record(result.transcript, `charter accepted on attempt ${result.attempts}`),
  );
  console.log(
    `✓ "${result.charter.identity.name}" founded — charter validates and boots (attempt ${result.attempts})`,
  );
  console.log(`  ${join(outDir, 'charter.yaml')}`);
  console.log(`  ${join(outDir, 'founding-session.md')}`);
} catch (error) {
  if (error instanceof FoundingSessionError) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'founding-session.md'), record(error.transcript, error.message));
    console.error(`✗ ${error.message} — transcript saved to ${join(outDir, 'founding-session.md')}`);
  } else {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
}
