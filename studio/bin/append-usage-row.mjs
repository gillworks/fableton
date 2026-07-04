// SPDX-License-Identifier: Apache-2.0
//
// stdin: Claude Code `--output-format json` envelope (or a crash/timeout's
// partial output). env: ROLE, MODEL, USAGE_CSV, STATUS (the runner's exit
// code). Echoes the readable result and appends one ledger row — including a
// zeroed `exit=timeout|crash` row when the session misbehaved (fableton#78).
// Invoked by bin/run.sh with bare `node`.
import { appendFileSync } from 'node:fs';
import { buildUsageRow } from './usage-ledger.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const { result, row } = buildUsageRow({
    raw,
    role: process.env.ROLE,
    model: process.env.MODEL,
    status: process.env.STATUS,
  });
  console.log(result);
  appendFileSync(process.env.USAGE_CSV, row + '\n');
});
