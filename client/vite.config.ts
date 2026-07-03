// SPDX-License-Identifier: Apache-2.0
//
// Dev server wiring. In production caddy serves /world (chunk JSON),
// /assets (the kit), and proxies /api + /sim; in dev this config plays
// caddy's role: static middleware for world data + assets, proxies to a
// locally running `pnpm --dir ../engine serve`.
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
};

function statics(routes: Record<string, string>): Plugin {
  return {
    name: 'fableton-statics',
    configureServer(server) {
      for (const [prefix, dir] of Object.entries(routes)) {
        server.middlewares.use(prefix, (req, res, next) => {
          const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^([/\\]|\.\.)+/, '');
          const file = join(dir, rel);
          if (!existsSync(file) || !statSync(file).isFile()) return next();
          const ext = file.slice(file.lastIndexOf('.'));
          res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
          res.end(readFileSync(file));
        });
      }
    },
  };
}

export default defineConfig({
  // The kit owns /assets/* (deploy contract) — vite's bundle lives at /bundle.
  build: { assetsDir: 'bundle' },
  plugins: [
    react(),
    statics({
      '/world': join(import.meta.dirname, '..', process.env['FABLETON_WORLD'] ?? 'engine/test/fixtures/sample-world'),
      '/assets': join(import.meta.dirname, '../assets'),
    }),
  ],
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:8091',
      '/sim': { target: 'ws://localhost:8090', ws: true },
    },
  },
});
