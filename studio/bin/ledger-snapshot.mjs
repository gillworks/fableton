// SPDX-License-Identifier: Apache-2.0
//
// Regenerate the redacted per-tier ledger surface from usage.csv.
//   node studio/bin/ledger-snapshot.mjs
// env: USAGE_CSV (default studio/logs/usage.csv), LEDGER_DIR (default
// studio/ledger), LEDGER_NOW (default new Date()). Writes tokens-per-tier.md
// and tokens-per-tier.csv into LEDGER_DIR. bin/publish-ledger.sh commits the
// result off-box (fableton#78, protects #42).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCsv, renderMarkdown, summarize } from './usage-ledger.mjs';

const usageCsv = process.env.USAGE_CSV || 'studio/logs/usage.csv';
const outDir = process.env.LEDGER_DIR || 'studio/ledger';
const generatedAt = process.env.LEDGER_NOW || new Date().toISOString();

let csv = '';
try {
  csv = readFileSync(usageCsv, 'utf8');
} catch {
  // No ledger yet (a young studio) — emit the empty surface, not an error.
  csv = '';
}

const summary = summarize(csv);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tokens-per-tier.md'), renderMarkdown(summary, { generatedAt }));
writeFileSync(join(outDir, 'tokens-per-tier.csv'), renderCsv(summary));
console.log(`wrote ${outDir}/tokens-per-tier.{md,csv} from ${usageCsv} (${summary.length} tier(s))`);
