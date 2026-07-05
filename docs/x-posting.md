<!-- SPDX-License-Identifier: Apache-2.0 -->

# Posting to X with media (the Narrator's image path)

The @FabletonWorld Narrator (CMO) runs in headless heartbeats. Browser-driven
posting can't reliably attach images from a heartbeat, so screenshots were being
dropped and only text went out. `scripts/x-post.mjs` restores media by posting
through the **X API v2 with OAuth 1.0a** (FABA-35).

## Usage

```sh
# text + image (the heartbeat flow: screenshot -> upload -> post)
node scripts/x-post.mjs --text "the orchard at dusk" --image /tmp/shot.png

# text only
node scripts/x-post.mjs --text "a quiet arrangement in the orchard"

# offline verification — no network, no credentials
node scripts/x-post.mjs --selftest

# dry run — validates args + credentials, builds the auth header, no network
node scripts/x-post.mjs --dry-run --text "..." --image /tmp/shot.png
```

On success the CLI prints one JSON line: `{"ok":true,"tweetId":"...","mediaId":"..."}`.
Exit codes: `0` success, `1` post failed (API error), `2` bad args / missing image,
`3` missing credentials.

## Credentials

An X developer app on the @FabletonWorld account, OAuth 1.0a, **write** scope.
Set these in the Narrator's environment (never in the repo — `.env` is gitignored):

| Env var                 | What it is                    |
| ----------------------- | ----------------------------- |
| `X_API_KEY`             | consumer / API key            |
| `X_API_SECRET`          | consumer / API secret         |
| `X_ACCESS_TOKEN`        | user access token (write)     |
| `X_ACCESS_TOKEN_SECRET` | user access token secret      |

Optional overrides if X moves the routes: `X_MEDIA_UPLOAD_URL`
(default `https://api.x.com/2/media/upload`), `X_TWEETS_URL`
(default `https://api.x.com/2/tweets`).

## Narrator integration point

A heartbeat that wants to post with an image does, in one run:

1. take the screenshot to a `/tmp/...` path (existing capability),
2. `node scripts/x-post.mjs --text "<caption>" --image /tmp/shot.png`,
3. read the printed `tweetId` for the weekly report.

The helper is also importable for programmatic use:

```js
import { postToX } from './scripts/x-post.mjs';
const { tweetId, mediaId } = await postToX({
  text: 'the orchard at dusk',
  imagePath: '/tmp/shot.png',
  creds: {
    consumerKey: process.env.X_API_KEY,
    consumerSecret: process.env.X_API_SECRET,
    token: process.env.X_ACCESS_TOKEN,
    tokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  },
});
```

## Verification status

- `--selftest` passes offline: the OAuth 1.0a signature base string matches X's
  own documented worked example byte-for-byte, the HMAC-SHA1 step matches the
  RFC 2202 vectors, and a mocked `upload → tweet` round-trip confirms the
  media-id is threaded into `media_ids`.
- A **live** media post has not yet been made — it is blocked on provisioning the
  four credentials above on the human-owned @FabletonWorld X account.

## Implementation notes

- Zero runtime dependencies — Node ≥ 20 built-ins only (`fetch`, `FormData`,
  `Blob`, `node:crypto`, `node:fs`). No `twitter-api-v2`, no `oauth`.
- Media upload is multipart and `/2/tweets` is JSON; neither body participates in
  the OAuth signature base string (only the `oauth_*` params do), per X's spec.
