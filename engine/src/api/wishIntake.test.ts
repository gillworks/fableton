// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createGithubWishIntake, githubWishIntakeFromEnv, parseRepoSlug } from './wishIntake.js';

describe('parseRepoSlug', () => {
  it('reads a bare owner/repo slug', () => {
    expect(parseRepoSlug('gillworks/fableton')).toEqual({ owner: 'gillworks', repo: 'fableton' });
  });
  it('reads a github url, tolerating scheme, .git, and trailing slash', () => {
    expect(parseRepoSlug('https://github.com/gillworks/fableton')).toEqual({ owner: 'gillworks', repo: 'fableton' });
    expect(parseRepoSlug('https://github.com/gillworks/fableton.git')).toEqual({ owner: 'gillworks', repo: 'fableton' });
    expect(parseRepoSlug('http://github.com/gillworks/fableton/')).toEqual({ owner: 'gillworks', repo: 'fableton' });
  });
  it('rejects anything that is not a single owner/repo', () => {
    expect(parseRepoSlug('gillworks')).toBeNull();
    expect(parseRepoSlug('gillworks/fableton/extra')).toBeNull();
    expect(parseRepoSlug('')).toBeNull();
  });
});

describe('createGithubWishIntake', () => {
  it('files a wish as an issue labeled `wish` and returns where it landed', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ html_url: 'https://gh/issues/7', number: 7 }), { status: 201 });
    }) as unknown as typeof fetch;

    const intake = createGithubWishIntake({ token: 'tok', owner: 'gillworks', repo: 'fableton', fetchImpl });
    const landed = await intake.file('build a lighthouse');

    expect(landed).toEqual({ url: 'https://gh/issues/7', number: 7 });
    expect(calls[0]!.url).toBe('https://api.github.com/repos/gillworks/fableton/issues');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.labels).toEqual(['wish']);
    expect(body.title).toContain('build a lighthouse');
    expect(body.body).toContain('build a lighthouse');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('throws when the GitHub API rejects — the endpoint maps this to a graceful failure', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch;
    const intake = createGithubWishIntake({ token: 'bad', owner: 'o', repo: 'r', fetchImpl });
    await expect(intake.file('a wish')).rejects.toThrow(/401/);
  });
});

describe('githubWishIntakeFromEnv', () => {
  it('is disabled without a token (bring-your-own-keys)', () => {
    expect(githubWishIntakeFromEnv({ FABLETON_WISH_REPO: 'gillworks/fableton' })).toBeNull();
  });
  it('is disabled when no usable repo is configured', () => {
    expect(githubWishIntakeFromEnv({ FABLETON_WISH_TOKEN: 'tok' })).toBeNull();
    expect(githubWishIntakeFromEnv({ FABLETON_WISH_TOKEN: 'tok', FABLETON_WISH_REPO: 'not-a-slug' })).toBeNull();
  });
  it('enables intake from a token plus repo, falling back to FABLETON_REPO_URL', () => {
    expect(githubWishIntakeFromEnv({ FABLETON_WISH_TOKEN: 'tok', FABLETON_WISH_REPO: 'a/b' })).not.toBeNull();
    expect(
      githubWishIntakeFromEnv({ FABLETON_WISH_TOKEN: 'tok', FABLETON_REPO_URL: 'https://github.com/a/b' }),
    ).not.toBeNull();
  });
});
