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
import type { ConstructionSite } from '../schemas/construction.js';
import type { ExpansionPlan } from '../schemas/expansion.js';
import type { RumorsDoc } from '../schemas/rumors.js';
import { validateWorld } from '../validate/validateWorld.js';
import type { SimEvent } from '../sim/worldSim.js';
import type { WorldSim } from '../sim/worldSim.js';
import { WISH_MIN_LEN, WISH_MAX_LEN } from '../wish.js';
import type { WishIntake } from './wishIntake.js';

// Stored, not yet consumed (issue #9): the audit slider and escalation
// cap the Phase B escalation contract reads (docs/architecture.md).
export const AdminConfigSchema = z.strictObject({
  audit_sample_percent: z.number().int().min(0).max(100),
  escalation_cap: z.number().int().min(0),
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

const DEFAULT_ADMIN_CONFIG: AdminConfig = { audit_sample_percent: 10, escalation_cap: 5 };
const CHRONICLE_CAP = 100;

// Wish intake (issue #79): capped short (bounds in ../wish.js, shared
// with the client) and rate-limited at the API so a visitor's wish can't
// spam the backlog. A wish is a sentence, not a doc.
const WISH_RATE_MAX = 3;
const WISH_RATE_WINDOW_MS = 10 * 60_000;
// Once the per-IP window map grows past this many keys, sweep the buckets
// that have fully expired so a public endpoint can't leak memory forever.
const WISH_BUCKET_SWEEP_AT = 1024;

export const WishRequestSchema = z.strictObject({
  wish: z.string().trim().min(WISH_MIN_LEN, 'a wish needs a few more words').max(WISH_MAX_LEN, 'keep the wish short'),
});

export interface WorldApiDeps {
  sim: WorldSim;
  charter: Charter;
  manifest: WorldManifest;
  chunks: Chunk[];
  npcs: Npc[];
  registry: AssetRegistry;
  /** Rumors this world seeds — resolves rumor ids to their diegetic text. */
  rumors?: RumorsDoc;
  /** The authored construction sites this world seeds (issue #99). The live
   *  sim owns each site's stage/progress; these carry the static definition —
   *  where the site stands and the mesh at each stage — so /api/construction
   *  gives the client everything it needs to render the site AND swap its mesh
   *  as the stage climbs. Absent means the world seeds no sites. */
  sites?: ConstructionSite[];
  /** The town's expansion plan (issue #95). Its queued entries each carry a
   *  full construction_site def, so /api/construction can render a site the
   *  plan opens mid-run (issue #107) exactly like a boot-seeded one — without
   *  it a plan-opened site reaches the client with live state but no position,
   *  stage meshes, or completion payload. */
  expansionPlan?: ExpansionPlan;
}

export interface WorldApi {
  port: number;
  close: () => Promise<void>;
}

export interface WorldApiOptions {
  port?: number;
  /**
   * The viewer wish source of the feedback funnel (issue #79). Absent/null
   * means this instance has no wish token configured — the endpoint then
   * reports that wishes are closed rather than erroring.
   */
  wishIntake?: WishIntake | null;
  /** Injectable clock for the wish rate limiter; defaults to Date.now. */
  now?: () => number;
  /**
   * How many proxy hops in front of world-api are trusted for reading the
   * client IP from `X-Forwarded-For`. Behind the single caddy of the v1
   * deploy (deploy/Caddyfile) this is 1: caddy *appends* the real peer, so
   * the trusted client is the rightmost hop and everything to its left is
   * client-supplied (spoofable). Raise it only if more trusted proxies sit
   * in front. Defaults to 1.
   */
  trustedProxyHops?: number;
}

export function startWorldApi(deps: WorldApiDeps, options: WorldApiOptions = {}): Promise<WorldApi> {
  const npcs = new Map(deps.npcs.map((n) => [n.id, n]));
  const rumorText = new Map((deps.rumors?.rumors ?? []).map((r) => [r.id, r.text]));
  // Static site definitions keyed by id — paired with the live sim state on
  // the /api/construction route so the client can place the site and map its
  // stage index to a mesh (issue #99). Boot-seeded sites AND every site the
  // expansion plan may open (issue #107) are registered up front: the plan's
  // defs are fixed data even though the sim opens them over time, so a
  // plan-opened site renders the moment its ground breaks. A boot-seeded def
  // wins over a same-id plan entry (last-in-map), matching how the sim keeps
  // the already-open site rather than re-spawning it.
  const siteDefs = new Map(
    [...(deps.expansionPlan?.queue ?? []).map((e) => e.site), ...(deps.sites ?? [])].map((s) => [s.id, s]),
  );
  const nameOf = (id: string): string => npcs.get(id)?.identity.name ?? id;
  const adminConfig: AdminConfig = { ...DEFAULT_ADMIN_CONFIG };
  const chronicle: { tick: number; entry: string }[] = [];
  const wishIntake = options.wishIntake ?? null;
  const now = options.now ?? (() => Date.now());
  const trustedProxyHops = Math.max(1, Math.trunc(options.trustedProxyHops ?? 1));

  // Per-IP sliding window: cheap in-memory rate limit for the wish box.
  const wishHits = new Map<string, number[]>();
  const clientIp = (req: IncomingMessage): string => {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    if (raw) {
      // Count from the RIGHT: the trusted proxy appends the real peer, so
      // the rightmost hop is trustworthy and the leftmost is whatever the
      // client sent. Reading the leftmost would let a visitor rotate the
      // header to mint unlimited rate-limit buckets and defeat the cap.
      const hops = raw.split(',').map((h) => h.trim()).filter(Boolean);
      const trusted = hops[hops.length - trustedProxyHops];
      if (trusted) return trusted;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };
  const wishRateLimited = (ip: string): boolean => {
    const cutoff = now() - WISH_RATE_WINDOW_MS;
    // Keep the map bounded: once it grows large, drop every bucket whose
    // timestamps have all aged out of the window. Buckets we keep always
    // hold at least one live timestamp, so idle IPs don't accumulate.
    if (wishHits.size > WISH_BUCKET_SWEEP_AT) {
      for (const [key, hits] of wishHits) {
        if (hits.every((t) => t <= cutoff)) wishHits.delete(key);
      }
    }
    const recent = (wishHits.get(ip) ?? []).filter((t) => t > cutoff);
    if (recent.length >= WISH_RATE_MAX) {
      wishHits.set(ip, recent);
      return true;
    }
    recent.push(now());
    wishHits.set(ip, recent);
    return false;
  };

  const narrate = (event: SimEvent): string => {
    switch (event.type) {
      case 'phase':
        return `the world turns: ${event.phase}`;
      case 'weather':
        return `the weather turns: ${event.weather.label}`;
      case 'rumor':
        // The "who told Greta?" line, in plain sight.
        return `${nameOf(event.to)} heard from ${nameOf(event.from)}: “${event.text}”`;
      case 'event':
        return `the ${event.event} begins`;
      case 'expansion':
        // The town grows: ground breaks on a planned building.
        return `ground breaks on ${event.site} — ${event.stage}`;
      case 'activity':
        return `${event.npc} — ${event.activity}`;
      case 'construction':
        // The "the bakery's frame went up" line, in plain sight.
        return event.text;
    }
  };
  deps.sim.onEvent((event: SimEvent) => {
    chronicle.push({ tick: event.tick, entry: narrate(event) });
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
        // Live construction summary — each site's stage, progress, and
        // current workers (issue #94). A convenience snapshot for third-party
        // consumers of this world; the first-party client does NOT read it,
        // taking site render defs from the dedicated /api/construction route
        // (issue #99) and stage-change deltas from the sim socket instead.
        construction: deps.sim.construction(),
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
        // The town event in effect right now (issue #62); null on an ordinary
        // day. The HUD renders it as "Today: <event>".
        event: deps.sim.event(),
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
          // The rumor id travels with the line so the client has a stable,
          // collision-proof key even if two rumors share text + source.
          rumor: h.rumor,
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
    // Construction sites for the client (issues #94, #99): each site's live
    // stage, work accrued toward the next, and who is working it now — paired
    // with its static definition so the client can place the site and swap in
    // the mesh for the stage it has reached. The stage ladder rides along
    // (name + asset per rung) so a stage-change delta on the socket is all the
    // client needs to swap the mesh; the completion payload lets it stand the
    // finished building. Sites with no authored def (shouldn't happen) fall
    // back to live-state-only so the route never drops one.
    if (req.method === 'GET' && path === '/api/construction') {
      const sites = deps.sim.construction().map((state) => {
        const def = siteDefs.get(state.id);
        return def
          ? {
              ...state,
              position: def.position,
              rotation_y: def.rotation_y,
              stages: def.stages.map((s) => ({ name: s.name, asset: s.asset })),
              completion: def.completion,
            }
          : state;
      });
      return json(res, 200, { sites });
    }
    // The viewer source of the feedback funnel (issue #79): a wish lands
    // in the world repo's backlog as a GH issue labeled `wish`. Disabled
    // gracefully when the instance has no token; capped and rate-limited
    // so it can't spam the backlog.
    if (req.method === 'POST' && path === '/api/wishes') {
      if (!wishIntake) return json(res, 503, { error: 'the wishing well is quiet in this world' });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return error(res, 400, `body is not JSON: ${e instanceof Error ? e.message : e}`);
      }
      const parsed = WishRequestSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, 400, { error: 'that wish will not do', detail: z.prettifyError(parsed.error) });
      }
      if (wishRateLimited(clientIp(req))) {
        return json(res, 429, { error: 'the well needs a moment — make another wish shortly' });
      }
      try {
        const filed = await wishIntake.file(parsed.data.wish);
        return json(res, 201, {
          ok: true,
          url: filed.url,
          number: filed.number,
          note: 'your wish drifts toward the stewards',
        });
      } catch {
        return json(res, 502, { error: 'the wish could not be carried to the stewards — try again' });
      }
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
