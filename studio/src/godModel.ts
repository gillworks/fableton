// SPDX-License-Identifier: Apache-2.0
//
// The real god model: GOD_MODEL env (default claude-fable-5, per
// docs/architecture.md model tiering), bring-your-own-keys via the SDK's
// standard credential resolution. Streaming, because charters are long.
//
// claude-fable-5 notes: thinking is always on (the `thinking` param must be
// omitted), sampling params are not accepted, and safety classifiers can
// return stop_reason "refusal" — surfaced here as a clear error.
import Anthropic from '@anthropic-ai/sdk';
import type { GodModel } from './foundingSession.js';

export const DEFAULT_GOD_MODEL = 'claude-fable-5';

export function anthropicGodModel(modelId?: string): GodModel {
  const model = modelId ?? process.env['GOD_MODEL'] ?? DEFAULT_GOD_MODEL;
  const client = new Anthropic();
  return async (system, messages) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      system,
      messages,
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error(
        `the god model (${model}) refused the request` +
          (final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : '') +
          ' — try rephrasing the premise or set GOD_MODEL=claude-opus-4-8',
      );
    }
    return final.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  };
}
