// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseCharter } from '../charter/parse.js';
import { ChunkSchema } from '../schemas/chunk.js';
import { WorldManifestSchema } from '../schemas/manifest.js';
import { NpcSchema } from '../schemas/npc.js';
import { startSimServer } from './server.js';
import { WorldSim } from './worldSim.js';

const root = new URL('../../test/fixtures/sample-world/', import.meta.url);
const loadJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const charter = parseCharter(
  readFileSync(new URL('../../../charters/_template/charter.yaml', import.meta.url), 'utf8'),
);
const manifest = WorldManifestSchema.parse(loadJson('manifest.json'));
const chunks = manifest.chunks.map((e) => ChunkSchema.parse(loadJson(e.path)));
const npcs = readdirSync(new URL('npcs/', root))
  .sort()
  .map((f) => NpcSchema.parse(loadJson(`npcs/${f}`)));

const collect = (port: number, count: number): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    const messages: string[] = [];
    socket.on('message', (data) => {
      messages.push(data.toString());
      if (messages.length === count) {
        socket.close();
        resolve(messages);
      }
    });
    socket.on('error', reject);
  });

describe('sim server', () => {
  it('two connected clients receive identical state, snapshot then live deltas', async () => {
    const sim = new WorldSim({ charter, manifest, chunks, npcs });
    const server = await startSimServer(sim, { port: 0, tickHz: 20 }); // fast ticks for the test
    try {
      const [a, b] = await Promise.all([collect(server.port, 6), collect(server.port, 6)]);
      expect(a).toEqual(b); // byte-identical sequences

      const snapshot = JSON.parse(a[0]!);
      expect(snapshot.type).toBe('snapshot');
      expect(snapshot.npcs).toHaveLength(3);

      const deltas = a.slice(1).map((m) => JSON.parse(m));
      for (const delta of deltas) expect(delta.type).toBe('delta');
      // The world is alive: someone moved or changed activity.
      expect(deltas.some((d) => d.npcs.length > 0)).toBe(true);
    } finally {
      await server.close();
    }
  });
});
