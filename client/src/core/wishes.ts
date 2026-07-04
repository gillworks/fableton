// SPDX-License-Identifier: Apache-2.0
//
// The visitor's end of the feedback funnel (issue #79): POST a wish to
// world-api, which files it as a GH issue labeled `wish`. Every failure
// mode maps to a diegetic outcome so the wish box degrades gracefully —
// a closed well, a full well, a rejected wish, or a lost one.
import { WISH_MIN_LEN, WISH_MAX_LEN } from '@fableton/engine/wish';

export { WISH_MIN_LEN, WISH_MAX_LEN };

export type WishResult =
  | { status: 'filed'; url?: string; number?: number }
  | { status: 'closed' } // intake not configured on this instance (503)
  | { status: 'rate-limited' } // too many wishes too fast (429)
  | { status: 'rejected'; message: string } // too short/long/malformed (400)
  | { status: 'error' }; // network, or the stewards couldn't be reached (5xx)

export async function submitWish(wish: string): Promise<WishResult> {
  let res: Response;
  try {
    res = await fetch('/api/wishes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wish }),
    });
  } catch {
    return { status: 'error' };
  }
  if (res.status === 201) {
    const body = (await res.json().catch(() => ({}))) as { url?: string; number?: number };
    return { status: 'filed', ...(body.url ? { url: body.url } : {}), ...(body.number ? { number: body.number } : {}) };
  }
  if (res.status === 503) return { status: 'closed' };
  if (res.status === 429) return { status: 'rate-limited' };
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: 'rejected', message: body.error ?? 'that wish will not do' };
  }
  return { status: 'error' };
}
