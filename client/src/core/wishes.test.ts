// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitWish } from './wishes.js';

const respondWith = (status: number, body?: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('submitWish', () => {
  it('maps 201 to filed, carrying the issue url + number', async () => {
    respondWith(201, { ok: true, url: 'https://gh/issues/7', number: 7 });
    expect(await submitWish('build a lighthouse')).toEqual({
      status: 'filed',
      url: 'https://gh/issues/7',
      number: 7,
    });
  });

  it('maps 503 to closed (intake not configured)', async () => {
    respondWith(503, { error: 'the wishing well is quiet in this world' });
    expect(await submitWish('a wish')).toEqual({ status: 'closed' });
  });

  it('maps 429 to rate-limited', async () => {
    respondWith(429, { error: 'the well needs a moment' });
    expect(await submitWish('a wish')).toEqual({ status: 'rate-limited' });
  });

  it('maps 400 to rejected, surfacing the reason', async () => {
    respondWith(400, { error: 'that wish will not do' });
    expect(await submitWish('x')).toEqual({ status: 'rejected', message: 'that wish will not do' });
  });

  it('maps 5xx to a graceful error', async () => {
    respondWith(502, { error: 'the wish could not be carried' });
    expect(await submitWish('a wish')).toEqual({ status: 'error' });
  });

  it('maps a network failure to a graceful error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await submitWish('a wish')).toEqual({ status: 'error' });
  });
});
