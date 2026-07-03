#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Rebuild the committed starter worlds (worlds/<name>/) after a generator
// change: regenerate each world's skeleton from its charter, then re-dress
// the home chunks (themed props at fixed spots, grounded on the new mesh)
// and re-attach the residents. NPC files (npcs/) and divine artifacts
// (artifacts/) are preserved — authored content, not generated.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Per-world dressing: home chunks, the themed props they need, residents.
// Chunk ids use 'index:N' (Nth chunk in the manifest) so re-dressing
// survives layout changes; fixed ids pin a specific chunk.
const WORLDS = {
  fableton: {
    charter: 'charters/fableton/charter.yaml',
    // Founding timestamps are fixed points (issue #57): the sim derives
    // "day N" from them, so rebuilds must never re-stamp.
    founded_at: '2026-07-03T02:00:53Z',
    // Townsfolk (wander trees — no prop/nav dependencies) spread across
    // the town by chunk index. Heroes live in the dressed chunks below.
    townsfolk: {
      0: ['pip-halfpenny', 'goodwife-crumb'],
      1: ['dame-spindle', 'quill'],
      2: ['old-thorn', 'bo-brindleson'],
      3: ['master-thumbling'],
      4: ['widow-hood', 'marigold-crumb'],
      5: ['brindle', 'ember-wick'],
      6: ['the-lesser-piper'],
      7: ['salt', 'stilts'],
      9: ['cobble', 'granny-ash'],
      10: ['mirabel-glass', 'needle'],
      11: ['humble-pot'],
      12: ['bramble-rose', 'fable-jack'],
      13: ['tick', 'morrow'],
      14: ['puddle', 'winsome'],
      15: ['ferrous-the-constant', 'vesper'],
    },
    dress: [
      {
        chunk: 'index:middle',
        props: [
          ['stall-red', 5.5, 6.0],
          ['fountain-round', 9.5, 8.5],
          ['lantern', 7.0, 10.5],
          ['cart', 11.5, 5.0],
        ],
        npcs: ['greta-the-baker', 'tam-the-lamplighter'],
      },
      {
        chunk: 'index:middle+1',
        props: [
          ['tree', 6.0, 6.0],
          ['tree-crooked', 10.0, 9.0],
        ],
        npcs: ['reynard-the-retired'],
      },
    ],
  },
  cindervault: {
    charter: 'charters/cindervault/charter.yaml',
    founded_at: '2026-07-03T01:56:21Z',
    dress: [
      {
        chunk: 'index:middle',
        props: [
          ['stall-red', 5.5, 6.0],
          ['cart', 7.2, 9.0],
          ['lantern', 9.0, 6.5],
        ],
        npcs: ['brann-of-the-third-hearth', 'ledger-ash', 'cinder-moll'],
      },
    ],
  },
  skeinsea: {
    charter: 'charters/skeinsea/charter.yaml',
    founded_at: '2026-07-03T01:56:21Z',
    dress: [
      {
        chunk: 'index:middle',
        props: [
          ['lantern', 6.0, 7.0],
          ['fountain-round', 9.5, 8.5],
          ['stall-bench', 7.5, 10.5],
        ],
        npcs: ['ninth-bell-odd', 'slackwater-meg', 'haar'],
      },
    ],
  },
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

for (const [name, config] of Object.entries(WORLDS)) {
  const worldDir = join(root, 'worlds', name);
  const AUTHORED = ['npcs', 'artifacts'];
  const backupOf = (sub) => join(tmpdir(), `fableton-${sub}-${name}`);
  for (const sub of AUTHORED) {
    rmSync(backupOf(sub), { recursive: true, force: true });
    if (existsSync(join(worldDir, sub))) cpSync(join(worldDir, sub), backupOf(sub), { recursive: true });
  }
  rmSync(worldDir, { recursive: true, force: true });

  execFileSync('pnpm', ['--dir', join(root, 'engine'), 'exec', 'tsx', 'src/generate/cli.ts', '--charter', join(root, config.charter), '--out', worldDir, '--founded-at', config.founded_at], { stdio: 'inherit' });

  for (const sub of AUTHORED) {
    if (existsSync(backupOf(sub))) cpSync(backupOf(sub), join(worldDir, sub), { recursive: true });
  }

  const manifest = JSON.parse(readFileSync(join(worldDir, 'manifest.json'), 'utf8'));
  const ids = manifest.chunks.map((c) => c.id);
  const resolve = (ref) => {
    if (!ref.startsWith('index:')) return ref;
    const middle = Math.floor(ids.length / 2);
    return ids[ref === 'index:middle' ? middle : middle + Number(ref.split('+')[1] ?? 0)];
  };

  for (const [indexStr, folks] of Object.entries(config.townsfolk ?? {})) {
    const id = ids[Number(indexStr)];
    if (!id) continue;
    const path = join(worldDir, 'chunks', `${id}.json`);
    const chunk = JSON.parse(readFileSync(path, 'utf8'));
    chunk.npcs = [...new Set([...chunk.npcs, ...folks])];
    writeFileSync(path, JSON.stringify(chunk, null, 2) + '\n');
  }

  for (const dress of config.dress) {
    const id = resolve(dress.chunk);
    const path = join(worldDir, 'chunks', `${id}.json`);
    const chunk = JSON.parse(readFileSync(path, 'utf8'));
    const have = new Set(chunk.props.map((p) => p.asset));
    for (const [asset, x, z] of dress.props) {
      if (!have.has(asset)) {
        chunk.props.push({ asset, position: [x, groundOn(chunk.terrain.heights, x, z), z], rotation_y: 0, scale: 1 });
      }
    }
    // Dressing may crowd a generated building — drop any that now collides.
    chunk.buildings = chunk.buildings.filter((b) => {
      const r = Math.hypot(b.width, b.depth) / 2;
      return chunk.props.every((p) => Math.hypot(b.position[0] - p.position[0], b.position[2] - p.position[2]) > r + 0.8);
    });
    chunk.npcs = [...new Set([...chunk.npcs, ...dress.npcs])];
    writeFileSync(path, JSON.stringify(chunk, null, 2) + '\n');
    console.log(`  dressed ${name}/${id} (${dress.npcs.length} residents)`);
  }
}
console.log('starter worlds rebuilt — run pnpm validate');
