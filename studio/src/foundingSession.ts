// SPDX-License-Identifier: Apache-2.0
//
// The Founding Session (issue #6): the only model-in-the-loop piece of v1.
// Expands a founder's one-paragraph prompt into a complete, schema-valid
// charter. The god model is injected so the loop is testable without an
// API key; validation errors are fed back until the charter parses AND
// boots a world through the gate.
import type { Charter } from '@fableton/engine';

export interface GodMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The model seam: system + conversation in, response text out. */
export type GodModel = (system: string, messages: GodMessage[]) => Promise<string>;

/** Returns [] when the YAML is a charter that boots; else legible errors. */
export type CharterValidator = (charterYaml: string) => { charter?: Charter; errors: string[] };

export interface TranscriptEntry {
  role: 'founder' | 'god' | 'validation';
  content: string;
}

export interface FoundingResult {
  charter: Charter;
  charterYaml: string;
  transcript: TranscriptEntry[];
  attempts: number;
}

export class FoundingSessionError extends Error {
  constructor(
    message: string,
    public readonly transcript: TranscriptEntry[],
  ) {
    super(message);
    this.name = 'FoundingSessionError';
  }
}

const systemPrompt = (templateYaml: string): string => `You are the founding \
god of a new world in the Fableton engine. A founder will give you a short \
premise; you expand it into the world's complete charter — its founding \
constitution: part seed, part law, part generation-steering config.

Requirements:
- Output ONLY the charter as YAML. No prose before or after, no markdown fences.
- Follow the template's structure exactly: every section present, schema_version 1.
- identity.seed is a single integer 0..4294967295.
- aesthetic.day_phases has exactly 4 diegetic phase names.
- Every aesthetic.never and taboos entry is {rule, enforced} where enforced is
  "gate" (machine-checkable against asset tags) or "prompt" (law for agents).
- generation.caps must be generous enough that a world can actually be built
  (keep the template's cap values unless the premise demands otherwise).
- Quote any YAML string containing a colon.
- Be specific and evocative — this charter is the anti-slop anchor every
  future agent obeys. Generic fantasy is failure.

The annotated template (structure reference — replace every example value
with this world's own law):

${templateYaml}`;

const stripFences = (text: string): string => {
  const trimmed = text.trim();
  const match = /^```(?:yaml|yml)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return match ? match[1]! : trimmed;
};

export interface FoundingSessionOptions {
  prompt: string;
  templateYaml: string;
  model: GodModel;
  validate: CharterValidator;
  maxAttempts?: number;
}

export async function foundingSession(options: FoundingSessionOptions): Promise<FoundingResult> {
  const { prompt, templateYaml, model, validate, maxAttempts = 4 } = options;
  const system = systemPrompt(templateYaml);
  const messages: GodMessage[] = [{ role: 'user', content: prompt }];
  const transcript: TranscriptEntry[] = [{ role: 'founder', content: prompt }];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await model(system, messages);
    transcript.push({ role: 'god', content: response });
    messages.push({ role: 'assistant', content: response });

    const charterYaml = stripFences(response);
    const { charter, errors } = validate(charterYaml);
    if (charter && errors.length === 0) {
      return { charter, charterYaml, transcript, attempts: attempt };
    }

    const feedback = `The charter did not validate. Fix these and output the complete corrected YAML (again: YAML only):\n${errors
      .map((e) => `- ${e}`)
      .join('\n')}`;
    transcript.push({ role: 'validation', content: feedback });
    messages.push({ role: 'user', content: feedback });
  }

  throw new FoundingSessionError(
    `charter did not validate after ${maxAttempts} attempts`,
    transcript,
  );
}
