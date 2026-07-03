#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Rebuild the committed starter worlds (worlds/<name>/) after a generator
// change — WITHOUT clobbering the studio's work. worlds/ is steward-owned
// (issue #64): residents move, props appear, the chronicle grows, all
// through merged PRs. So this script replaces only what the generator
// produces (manifest.json, assets.json, chunks/) and reads everything
// authored back out of the CURRENT world before regenerating:
//
//   - NPC placement: each chunk's `npcs` array (preserve-by-read — a
//     resident the steward moved stays moved)
//   - Authored props: any prop in a current chunk that the regeneration
//     does not produce for that chunk is carried over, re-grounded on the
//     new mesh
//   - Untouched entirely: npcs/, artifacts/, chronicle.md, og.png, and
//     any other file the studio adds beside the generated ones
//
// Caveat (documented in #64): authored props are detected by diffing
// against the fresh generation, so if the generator's PROP PLACEMENT
// logic itself changed, old generated props are indistinguishable from
// authored ones and get carried over too. The per-chunk carry counts are
// logged — review the git diff when they look fat.
//
// A rebuild with an unchanged generator is a no-op (that is the test).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// The only per-world config left: which charter, and the founding
// timestamp (a fixed point the sim's clock derives "day N" from — see
// issue #57; rebuilds must never re-stamp it).
const WORLDS = {
  fableton: { charter: 'charters/fableton/charter.yaml', founded_at: '2026-07-03T02:00:53Z' },
  cindervault: { charter: 'charters/cindervault/charter.yaml', founded_at: '2026-07-03T01:56:21Z' },
  skeinsea: { charter: 'charters/skeinsea/charter.yaml', founded_at: '2026-07-03T01:56:21Z' },
};

const GRID = 9;
const SIZE = 16;
function groundOn(heights, x, z) {
  const cell = SIZE / (GRID - 1);
  const cx = Math.min(GRID - 2, Math.max(0, Math.floor(x / cell)));
  const cz = Math.min(GRID - 2, Math.max(0, Math.floor(z / cell)));
  const fx = x / cell - cx;
  const fz = z / cell - cz;
  const at = (X, Z) => heights[Z * GRID + X];
  const [a, b, c, d] = [at(cx, cz), at(cx + 1, cz), at(cx, cz + 1), at(cx + 1, cz + 1)];
  return Math.round((a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 1000) / 1000;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, doc) => writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
const propKey = (p) => `${p.asset}@${p.position[0]},${p.position[2]}`;

for (const [name, config] of Object.entries(WORLDS)) {
  const worldDir = join(root, 'worlds', name);

  // 1. Read the steward's current truth before touching anything.
  const current = new Map(); // chunk id → { npcs, props, origin }
  if (existsSync(join(worldDir, 'chunks'))) {
    for (const file of readdirSync(join(worldDir, 'chunks')).filter((f) => f.endsWith('.json'))) {
      const chunk = readJson(join(worldDir, 'chunks', file));
      current.set(chunk.id, { npcs: chunk.npcs, props: chunk.props, origin: null });
    }
  }
  const oldManifest = existsSync(join(worldDir, 'manifest.json'))
    ? readJson(join(worldDir, 'manifest.json'))
    : null;
  for (const entry of oldManifest?.chunks ?? []) {
    if (current.has(entry.id)) current.get(entry.id).origin = entry.origin;
  }

  // 2. Regenerate the skeleton into a temp dir.
  const tmp = mkdtempSync(join(tmpdir(), `fableton-rebuild-${name}-`));
  execFileSync(
    'pnpm',
    ['--dir', join(root, 'engine'), 'exec', 'tsx', 'src/generate/cli.ts', '--charter', join(root, config.charter), '--out', tmp, '--founded-at', config.founded_at],
    { stdio: 'inherit' },
  );
  const manifest = readJson(join(tmp, 'manifest.json'));
  const newIds = new Set(manifest.chunks.map((c) => c.id));

  // 3. Re-place every resident on the new skeleton. A chunk that no
  //    longer exists (layout change) re-homes its residents to the
  //    nearest new chunk by origin, loudly.
  const nearestTo = ([x, z]) =>
    manifest.chunks.reduce(
      (best, c) => {
        const d = (c.origin[0] - x) ** 2 + (c.origin[1] - z) ** 2;
        return d < best.d ? { id: c.id, d } : best;
      },
      { id: manifest.chunks[0].id, d: Infinity },
    ).id;
  const npcsFor = new Map(manifest.chunks.map((c) => [c.id, []]));
  for (const [id, data] of current) {
    if (data.npcs.length === 0) continue;
    let home = id;
    if (!newIds.has(id)) {
      home = data.origin ? nearestTo(data.origin) : manifest.chunks[Math.floor(manifest.chunks.length / 2)].id;
      console.warn(`  ! chunk ${id} is gone — re-homing ${data.npcs.join(', ')} to ${home}`);
    }
    npcsFor.get(home).push(...data.npcs);
  }

  // 4. Carry authored props (anything the fresh generation didn't
  //    produce for that chunk), re-grounded on the new terrain.
  for (const entry of manifest.chunks) {
    const chunk = readJson(join(tmp, 'chunks', `${entry.id}.json`));
    const generated = new Set(chunk.props.map(propKey));
    const carried = (current.get(entry.id)?.props ?? []).filter((p) => !generated.has(propKey(p)));
    for (const p of carried) {
      chunk.props.push({
        ...p,
        position: [p.position[0], groundOn(chunk.terrain.heights, p.position[0], p.position[2]), p.position[2]],
      });
    }
    // Carried props may crowd a generated building — drop any that collides.
    chunk.buildings = chunk.buildings.filter((b) => {
      const r = Math.hypot(b.width, b.depth) / 2;
      return chunk.props.every((p) => Math.hypot(b.position[0] - p.position[0], b.position[2] - p.position[2]) > r + 0.8);
    });
    chunk.npcs = [...new Set(npcsFor.get(entry.id))].sort();
    writeJson(join(tmp, 'chunks', `${entry.id}.json`), chunk);
    if (carried.length > 0) console.log(`  carried ${carried.length} authored prop(s) into ${name}/${entry.id}`);
  }

  // 5. Replace ONLY the generated outputs; authored files stay untouched.
  rmSync(join(worldDir, 'chunks'), { recursive: true, force: true });
  cpSync(join(tmp, 'chunks'), join(worldDir, 'chunks'), { recursive: true });
  writeJson(join(worldDir, 'manifest.json'), manifest);
  cpSync(join(tmp, 'assets.json'), join(worldDir, 'assets.json'));
  rmSync(tmp, { recursive: true, force: true });

  const placed = [...npcsFor.values()].reduce((n, list) => n + list.length, 0);
  console.log(`✓ ${name} rebuilt — ${manifest.chunks.length} chunks, ${placed} residents kept in place`);
}
console.log('starter worlds rebuilt — run pnpm validate and REVIEW THE DIFF (see #64)');
