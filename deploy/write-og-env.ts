// SPDX-License-Identifier: Apache-2.0
//
// A founded world's social card is its own (issue #55): derive
// OG_TITLE/OG_DESC/OG_IMAGE_PATH from the charter and publish them as a
// shell env file on the shared world volume, where the caddy entrypoint
// sources them.
//   tsx deploy/write-og-env.ts <charter.yaml> <out.env>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseCharter } from '../engine/src/charter/parse.js';

const [charterPath, outPath] = process.argv.slice(2);
if (!charterPath || !outPath) {
  console.error('usage: write-og-env.ts <charter.yaml> <out.env>');
  process.exit(2);
}

const charter = parseCharter(readFileSync(charterPath, 'utf8'));
// POSIX single-quote escaping: the premise may contain any prose.
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

// og:image — the world serves its own 1200×630 card at /world/og.png when
// it ships one (og.env lands in the world dir the caddy container serves at
// /world). A fresh charter without one falls back to the engine default, so
// twitter:image always resolves to a real image rather than a bare URL.
const imagePath = existsSync(join(dirname(outPath), 'og.png'))
  ? '/world/og.png'
  : '/assets/og-default.png';

writeFileSync(
  outPath,
  [
    `OG_TITLE=${quote(`${charter.identity.name} — a charter-founded world, grown by an autonomous studio`)}`,
    `OG_DESC=${quote(charter.identity.premise)}`,
    `OG_IMAGE_PATH=${quote(imagePath)}`,
    '',
  ].join('\n'),
);
console.log(
  `social card is the charter's: ${outPath} (${charter.identity.name}, image ${imagePath})`,
);
