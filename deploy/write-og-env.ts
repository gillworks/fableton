// SPDX-License-Identifier: Apache-2.0
//
// A founded world's social card is its own (issue #55): derive
// OG_TITLE/OG_DESC from the charter and publish them as a shell env file
// on the shared world volume, where the caddy entrypoint sources them.
//   tsx deploy/write-og-env.ts <charter.yaml> <out.env>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCharter } from '../engine/src/charter/parse.js';

const [charterPath, outPath] = process.argv.slice(2);
if (!charterPath || !outPath) {
  console.error('usage: write-og-env.ts <charter.yaml> <out.env>');
  process.exit(2);
}

const charter = parseCharter(readFileSync(charterPath, 'utf8'));
// POSIX single-quote escaping: the premise may contain any prose.
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

writeFileSync(
  outPath,
  [
    `OG_TITLE=${quote(`${charter.identity.name} — a charter-founded world, grown by an autonomous studio`)}`,
    `OG_DESC=${quote(charter.identity.premise)}`,
    '',
  ].join('\n'),
);
console.log(`social card is the charter's: ${outPath} (${charter.identity.name})`);
