// SPDX-License-Identifier: Apache-2.0
//
// world-api (docs/architecture.md): thin REST over the live sim — lore
// reads, the chronicle, admin config, and the behavior-tree update
// endpoint. That last one is the L1 seam: it exists in v1 even though
// agents only start using it in Phase B. Plain node:http — a handful of
// routes doesn't justify a framework dependency.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AssetRegistry } from '../schemas/assets.js';
import type { Charter } from '../schemas/charter.js';
import type { Chunk } from '../schemas/chunk.js';
import type { WorldManifest } from '../schemas/manifest.js';
import { NpcSchema, type Npc } from '../schemas/npc.js';
import type { RumorsDoc } from '../schemas/rumors.js';
import { validateWorld } from '../validate/validateWorld.js';
import type { SimEvent } from '../sim/worldSim.js';
import type { WorldSim } from '../sim/worldSim.js';

// Stored, not yet consumed (issue #9): the audit slider and escalation
// cap the Phase B escalation contract reads (docs/architecture.md).
export const AdminConfigSchema = z.strictObject({
  audit_sample_percent: z.number().int().min(0).max(100),
  escalation_cap: z.number().int().min(0),
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

const DEFAULT_ADMIN_CONFIG: AdminConfig = { audit_sample_percent: 10, escalation_cap: 5 };
const CHRONICLE_CAP = 100;

export interface WorldApiDeps {
  sim: WorldSim;
  charter: Charter;
  manifest: WorldManifest;
  chunks: Chunk[];
  npcs: Npc[];
  registry: AssetRegistry;
  /** Rumors this world seeds — resolves rumor ids to their diegetic text. */
  rumors?: RumorsDoc;
}

export interface WorldApi {
  port: number;
  close: () => Promise<void>;
}

export function startWorldApi(deps: WorldApiDeps, options: { port?: number } = {}): Promise<WorldApi> {
  const npcs = new Map(deps.npcs.map((n) => [n.id, n]));
  const rumorText = new Map((deps.rumors?.rumors ?? []).map((r) => [r.id, r.text]));
  const nameOf = (id: string): string => npcs.get(id)?.identity.name ?? id;
  const adminConfig: AdminConfig = { ...DEFAULT_ADMIN_CONFIG };
  const chronicle: { tick: number; entry: string }[] = [];

  const entryFor = (event: SimEvent): string => {
    switch (event.type) {
      case 'phase':
        return `the world turns: ${event.phase}`;
      case 'rumor':
        // The "who told Greta?" line, in plain sight.
        return `${nameOf(event.to)} heard from ${nameOf(event.from)}: “${event.text}”`;
      default:
        return `${event.npc} — ${event.activity}`;
    }
  };

  deps.sim.onEvent((event: SimEvent) => {
    chronicle.push({ tick: event.tick, entry: entryFor(event) });
    if (chronicle.length > CHRONICLE_CAP) chronicle.shift();
  });

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };
  const error = (res: ServerResponse, status: number, message: string): void =>
    json(res, status, { error: message });

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (part: Buffer) => {
        body += part;
        if (body.length > 1_000_000) reject(new Error('body too large'));
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });

  // A tree update must leave the world gate-clean: schema first (labeled
  // nodes enforced), then the same validateWorld the CI gate runs, so a
  // tree pointing at nav nodes or props that don't exist is refused.
  const updateBehavior = (npc: Npc, rawTree: unknown): { status: number; body: unknown } => {
    const candidate = NpcSchema.safeParse({
      ...JSON.parse(JSON.stringify(npc)),
      behavior: rawTree,
    });
    if (!candidate.success) {
      return { status: 400, body: { error: 'behavior tree rejected by NPC schema', detail: z.prettifyError(candidate.error) } };
    }
    const violations = validateWorld(deps.charter, {
      manifest: { file: 'manifest.json', doc: JSON.parse(JSON.stringify(deps.manifest)) },
      registry: { file: 'assets.json', doc: JSON.parse(JSON.stringify(deps.registry)) },
      chunks: deps.chunks.map((c) => ({ file: `chunks/${c.id}.json`, doc: JSON.parse(JSON.stringify(c)) })),
      npcs: [...npcs.values()].map((n) => ({
        file: `npcs/${n.id}.json`,
        doc: JSON.parse(JSON.stringify(n.id === npc.id ? candidate.data : n)),
      })),
    }).filter((v) => v.file === `npcs/${npc.id}.json`);
    if (violations.length > 0) {
      return {
        status: 400,
        body: { error: 'behavior tree rejected by the world gate', detail: violations.map((v) => `[${v.rule}] ${v.message}`) },
      };
    }
    npcs.set(npc.id, candidate.data);
    deps.sim.updateBehavior(npc.id, candidate.data.behavior);
    return { status: 200, body: { ok: true, npc: npc.id, note: 'tree swapped live; takes effect next tick' } };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/$/, '') || '/';
    const npcMatch = /^\/api\/npcs\/([a-z0-9_-]+)(\/behavior)?$/.exec(path);

    if (req.method === 'GET' && path === '/api/world') {
      const clock = deps.sim.clock();
      return json(res, 200, {
        world: deps.charter.identity.name,
        premise: deps.charter.identity.premise,
        seed: deps.charter.identity.seed,
        charter_version: deps.charter.schema_version,
        // Where this world's studio works — the client renders chronicle
        // PR references as links to it (issue #59). Instance config, not
        // charter data; absent means plain text.
        ...(process.env['FABLETON_REPO_URL'] && { repo_url: process.env['FABLETON_REPO_URL'] }),
        // Studio construction sites (Phase B populates this; the client
        // renders markers for whatever appears here).
        construction: [],
        phases: deps.charter.aesthetic.day_phases,
        // Charter theme tokens (docs/design.md): the client derives its
        // atmosphere, accent, and type from these — never from constants.
        theme: {
          theme: deps.charter.aesthetic.theme,
          palette: deps.charter.aesthetic.palette,
          accent: deps.charter.aesthetic.accent,
          typography: deps.charter.aesthetic.typography,
        },
        chunks: deps.manifest.chunks.length,
        npcs: npcs.size,
        clock,
        pace: deps.sim.pace(),
      });
    }
    if (req.method === 'GET' && path === '/api/npcs') {
      return json(
        res,
        200,
        [...npcs.values()].map((n) => ({ id: n.id, name: n.identity.name, kind: n.identity.kind })),
      );
    }
    if (npcMatch && !npcMatch[2] && req.method === 'GET') {
      const npc = npcs.get(npcMatch[1]!);
      if (!npc) return error(res, 404, `no NPC "${npcMatch[1]}" in this world`);
      return json(res, 200, {
        id: npc.id,
        identity: npc.identity,
        relationships: npc.relationships,
        lore: npc.lore,
        // The tree's own name — the inspect panel's footer line.
        tree: npc.behavior.label,
        // What this resident has picked up, and from whom (issue #81). Live
        // sim state, not authored data; `from` is an NPC id the client maps
        // to a name, like relationships. Unknown rumor ids fall back to the
        // id so the panel never silently drops a line.
        heard: deps.sim.heard(npc.id).map((h) => ({
          text: rumorText.get(h.rumor) ?? h.rumor,
          from: h.from,
          tick: h.tick,
        })),
      });
    }
    if (npcMatch && npcMatch[2] && req.method === 'POST') {
      const npc = npcs.get(npcMatch[1]!);
      if (!npc) return error(res, 404, `no NPC "${npcMatch[1]}" in this world`);
      let tree: unknown;
      try {
        tree = JSON.parse(await readBody(req));
      } catch (e) {
        return error(res, 400, `body is not JSON: ${e instanceof Error ? e.message : e}`);
      }
      const result = updateBehavior(npc, tree);
      return json(res, result.status, result.body);
    }
    if (req.method === 'GET' && path === '/api/chronicle') {
      return json(res, 200, { entries: chronicle });
    }
    if (path === '/api/admin/config') {
      if (req.method === 'GET') return json(res, 200, adminConfig);
      if (req.method === 'PUT') {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          return error(res, 400, `body is not JSON: ${e instanceof Error ? e.message : e}`);
        }
        const parsed = AdminConfigSchema.safeParse(body);
        if (!parsed.success) {
          return json(res, 400, { error: 'invalid admin config', detail: z.prettifyError(parsed.error) });
        }
        Object.assign(adminConfig, parsed.data);
        return json(res, 200, adminConfig);
      }
    }
    return error(res, 404, `no route: ${req.method} ${path}`);
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e) => error(res, 500, e instanceof Error ? e.message : String(e)));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8091, () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
