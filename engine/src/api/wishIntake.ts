// SPDX-License-Identifier: Apache-2.0
//
// Wish intake (docs/architecture.md § The feedback funnel): a visitor's
// in-client wish lands in the world repo's backlog as a GitHub issue
// labeled `wish`, where the steward triages it like any other item. This
// is the viewer source of the one funnel — pulled forward as a thin
// Phase C slice (issue #79).
//
// Bring-your-own-keys: the token and target repo come from env, never the
// repo. With no token the intake is disabled and the endpoint says so —
// the v1 stack ships without keys (deploy/README.md).

/** Files one wish and reports where it landed. */
export interface WishIntake {
  file(wish: string): Promise<{ url: string; number: number }>;
}

/**
 * Parse an `owner/repo` slug from either a bare slug or a GitHub URL
 * (`https://github.com/owner/repo`, trailing `.git`/`/` tolerated).
 * Returns null for anything that isn't a clean single-repo reference.
 */
export function parseRepoSlug(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed);
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** A wish's title is its first line, trimmed to a legible length. */
function wishTitle(wish: string): string {
  const line = wish.split('\n')[0]!.trim();
  const clipped = line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
  return `Wish: ${clipped}`;
}

/**
 * Wrap arbitrary visitor text in a fenced code block so GitHub renders it
 * verbatim: no `@mention` notification pings, no `#123` cross-references
 * onto other issues, and no markdown/HTML injection from an anonymous
 * public write path. The fence is grown longer than the longest backtick
 * run in the text so the visitor can't close it early and break out.
 */
function fencedVerbatim(text: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

function wishBody(wish: string): string {
  return [
    '> A visitor made this wish through the in-world wish box.',
    '',
    fencedVerbatim(wish),
    '',
    '_Filed by world-api wish intake (docs/architecture.md § The feedback funnel). Triage like any other backlog item._',
  ].join('\n');
}

export interface GithubWishIntakeConfig {
  token: string;
  owner: string;
  repo: string;
  /** The backlog label; the funnel's viewer source is `wish`. */
  label?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** A WishIntake backed by the GitHub issues API. */
export function createGithubWishIntake(config: GithubWishIntakeConfig): WishIntake {
  const label = config.label ?? 'wish';
  const doFetch = config.fetchImpl ?? fetch;
  const endpoint = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;
  return {
    async file(wish: string) {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'fableton-wish-intake',
        },
        body: JSON.stringify({ title: wishTitle(wish), body: wishBody(wish), labels: [label] }),
      });
      if (!res.ok) {
        throw new Error(`github issue create failed: ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { html_url: string; number: number };
      return { url: json.html_url, number: json.number };
    },
  };
}

/**
 * Build the intake from env (bring-your-own-keys), or null when this
 * instance has no wish token configured — then the endpoint reports that
 * wishes are closed rather than failing. Target repo is `FABLETON_WISH_REPO`
 * (an `owner/repo` slug), falling back to `FABLETON_REPO_URL`.
 */
export function githubWishIntakeFromEnv(env: NodeJS.ProcessEnv = process.env): WishIntake | null {
  const token = env['FABLETON_WISH_TOKEN'];
  if (!token) return null;
  // `||`, not `??`: compose's `${FABLETON_WISH_REPO:-}` delivers an EMPTY
  // STRING when unset, which must fall through to FABLETON_REPO_URL —
  // this bit the first production enablement (issue #110).
  const source = env['FABLETON_WISH_REPO'] || env['FABLETON_REPO_URL'];
  const slug = source ? parseRepoSlug(source) : null;
  if (!slug) return null;
  return createGithubWishIntake({ token, owner: slug.owner, repo: slug.repo });
}
