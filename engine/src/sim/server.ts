// SPDX-License-Identifier: Apache-2.0
//
// The I/O shell around the pure sim: wall time schedules ticks, the
// WebSocket fan-out sends every client the same serialized bytes — two
// connected clients receive identical state by construction.
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_HZ } from './clock.js';
import type { WorldSim } from './worldSim.js';

export interface SimServer {
  port: number;
  clients: () => number;
  close: () => Promise<void>;
}

export function startSimServer(
  sim: WorldSim,
  options: { port?: number; tickHz?: number } = {},
): Promise<SimServer> {
  const tickHz = options.tickHz ?? TICK_HZ;
  const wss = new WebSocketServer({ port: options.port ?? 8090 });

  wss.on('connection', (socket: WebSocket) => {
    socket.send(JSON.stringify(sim.snapshot()));
  });

  const interval = setInterval(() => {
    const payload = JSON.stringify(sim.tick());
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }, 1000 / tickHz);

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const address = wss.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        clients: () => wss.clients.size,
        close: () =>
          new Promise((done) => {
            clearInterval(interval);
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
