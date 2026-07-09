#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The v1 acceptance harness (issue #7): docs/v1.md's three definition-of-
// done tests as a command — `pnpm accept`. A test SKIPs (with the reason)
// when the piece it exercises hasn't landed yet; it FAILs when the piece
// exists but misses the bar. `--no-skip` turns skips into failures — that
// is the mode the v1 tag must pass.
//
// Test 4 (FABA-69) extends the harness past the v1 DoD with a live-world
// coherence guardrail: every committed world must satisfy Decree 1, the
// Law of Ties — no orphaned single-resident region.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noSkip = process.argv.includes('--no-skip');
const templateCharter = join(root, 'charters', '_template', 'charter.yaml');

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const mark = { PASS: '✓', FAIL: '✗', SKIP: '○' }[status];
  console.log(`${mark} ${status}  ${name}\n         ${detail}\n`);
};

const engineExec = (args, opts = {}) =>
  spawnSync('pnpm', ['--dir', join(root, 'engine'), 'exec', 'tsx', ...args], {
    encoding: 'utf8',
    ...opts,
  });

// ---------------------------------------------------------------- test 1
// Install: fresh machine → docker compose up + a charter → explorable
// world in ≤ 15 minutes. Contract the deploy issue implements (documented
// in docs/v1.md): compose file at deploy/compose.yaml; the world is
// explorable when GET :8080/ returns 200 and :8080/world/manifest.json
// returns the world manifest.
async function testInstall() {
  const name = 'install: compose up → explorable world ≤ 15 min';
  const composeFile = join(root, 'deploy', 'compose.yaml');
  if (!existsSync(composeFile)) {
    return record(name, 'SKIP', 'deploy/compose.yaml not in the repo yet (issue #12); contract in docs/v1.md');
  }
  if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status !== 0) {
    return record(name, 'SKIP', 'docker compose not available on this machine');
  }
  const budgetMs = 15 * 60 * 1000;
  const base = `http://localhost:${process.env.FABLETON_PORT ?? 8080}`;
  const started = Date.now();
  const compose = (args) =>
    spawnSync('docker', ['compose', '-f', composeFile, ...args], { encoding: 'utf8' });
  try {
    const up = compose(['up', '-d', '--build']);
    if (up.status !== 0) {
      return record(name, 'FAIL', `docker compose up failed:\n${up.stderr.slice(-500)}`);
    }
    while (Date.now() - started < budgetMs) {
      try {
        const [page, manifest] = await Promise.all([fetch(base), fetch(`${base}/world/manifest.json`)]);
        if (page.ok && manifest.ok) {
          // "Explorable" means the client actually boots: its bundle must
          // resolve too (a route collision once served 200 HTML + 404 JS).
          const html = await page.text();
          const src = /src="([^"]+\.js)"/.exec(html)?.[1];
          const bundle = src ? await fetch(`${base}${src}`) : { ok: false };
          if (!bundle.ok) throw new Error(`client bundle ${src ?? '(none)'} unreachable`);
          const doc = await manifest.json();
          const elapsed = ((Date.now() - started) / 1000).toFixed(0);
          return record(name, 'PASS', `world "${doc.world}" explorable in ${elapsed}s (budget 900s)`);
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return record(name, 'FAIL', 'world not explorable within the 15-minute budget');
  } finally {
    compose(['down', '-v']);
  }
}

// ---------------------------------------------------------------- test 2
// Divergence: swap the charter ⇒ structurally different world.
function testDivergence() {
  const name = 'divergence: different charter ⇒ structurally different world';
  // Prefer a real committed charter (issue #13 adds them); fall back to the
  // engine's Cindervault fixture until then.
  const chartersDir = join(root, 'charters');
  const committed = readdirSync(chartersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_template')
    .map((d) => join(chartersDir, d.name, 'charter.yaml'))
    .filter((p) => existsSync(p));
  const second = committed[0] ?? join(root, 'engine', 'test', 'fixtures', 'charter-valid.yaml');
  const run = engineExec(['src/acceptance/divergence.ts', templateCharter, second]);
  if (run.status === 0) {
    record(name, 'PASS', run.stdout.trim().replace(/^✓ /, ''));
  } else {
    record(name, 'FAIL', (run.stderr || run.stdout).trim());
  }
}

// ---------------------------------------------------------------- test 3
// The gate holds: a world containing an invalid chunk (bad asset ref /
// disconnected navmesh / blown perf budget) is rejected by the same
// command CI runs, with the violation named. A pristine world passes.
function testGate() {
  const name = 'gate: invalid chunk rejected by CI\'s validate command';
  const fixtures = join(root, 'engine', 'test', 'fixtures', 'sample-world');
  const chunkPath = 'chunks/town-square.json';
  const cases = [
    {
      label: 'bad asset ref',
      expect: 'asset-refs-resolve',
      mutate: (chunk) => {
        chunk.props[0].asset = 'chrome-vending-machine';
      },
    },
    {
      label: 'disconnected navmesh',
      expect: 'nav-connectivity',
      mutate: (chunk) => {
        chunk.nav.edges = chunk.nav.edges.filter((e) => !e.includes('west-gate'));
      },
    },
    {
      label: 'blown perf budget',
      expect: 'perf-budget',
      mutate: (chunk) => {
        for (let i = 0; i < 2000; i++) {
          chunk.props.push({ asset: 'windmill', position: [1, 0, 1] });
        }
      },
    },
  ];

  const gate = (worldDir) =>
    engineExec(['src/validate/cli.ts', '--charter', templateCharter, '--world', worldDir]);

  const control = gate(fixtures);
  if (control.status !== 0) {
    return record(name, 'FAIL', `control failed: the pristine sample world did not pass the gate:\n${control.stderr}`);
  }

  const failures = [];
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'fableton-accept-'));
    try {
      cpSync(fixtures, dir, { recursive: true });
      const chunk = JSON.parse(readFileSync(join(dir, chunkPath), 'utf8'));
      c.mutate(chunk);
      writeFileSync(join(dir, chunkPath), JSON.stringify(chunk));
      const run = gate(dir);
      if (run.status === 0) {
        failures.push(`${c.label}: the gate let it through`);
      } else if (!`${run.stderr}${run.stdout}`.includes(c.expect)) {
        failures.push(`${c.label}: rejected, but without naming the violation (${c.expect})`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failures.length > 0) {
    record(name, 'FAIL', failures.join('; '));
  } else {
    record(name, 'PASS', `pristine world passes; ${cases.map((c) => c.label).join(', ')} each rejected with the violation named`);
  }
}

// ---------------------------------------------------------------- test 4
// Coherence (FABA-69): every populated region in a committed world is
// tethered — Decree 1, the Law of Ties. A committed world is a directory
// under worlds/ with a manifest and a matching charter under charters/.
// The check reads NPC relationships, so it skips until real worlds land.
function testCoherence() {
  const name = 'coherence: no orphaned regions in committed worlds (Law of Ties)';
  const worldsDir = join(root, 'worlds');
  if (!existsSync(worldsDir)) {
    return record(name, 'SKIP', 'no worlds/ directory yet — nothing to tether');
  }
  const worlds = readdirSync(worldsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (w) =>
        existsSync(join(worldsDir, w, 'manifest.json')) &&
        existsSync(join(root, 'charters', w, 'charter.yaml')),
    );
  if (worlds.length === 0) {
    return record(name, 'SKIP', 'no committed world has both a manifest and a charter yet');
  }
  const failures = [];
  for (const w of worlds) {
    const run = engineExec([
      'src/acceptance/coherence.ts',
      join(root, 'charters', w, 'charter.yaml'),
      join(worldsDir, w),
    ]);
    if (run.status !== 0) failures.push((run.stderr || run.stdout).trim());
  }
  if (failures.length > 0) {
    record(name, 'FAIL', failures.join('\n'));
  } else {
    record(name, 'PASS', `${worlds.length} world(s) — every populated region tethered: ${worlds.join(', ')}`);
  }
}

// ---------------------------------------------------------------- run
console.log('v1 acceptance harness — docs/v1.md definition of done\n');
await testInstall();
testDivergence();
testGate();
testCoherence();

const failed = results.filter((r) => r.status === 'FAIL');
const skipped = results.filter((r) => r.status === 'SKIP');
console.log(
  `${results.filter((r) => r.status === 'PASS').length} passed · ${failed.length} failed · ${skipped.length} skipped${noSkip && skipped.length > 0 ? ' (skips forbidden by --no-skip)' : ''}`,
);
if (failed.length > 0 || (noSkip && skipped.length > 0)) process.exit(1);
