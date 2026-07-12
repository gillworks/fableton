<!-- SPDX-License-Identifier: Apache-2.0 -->

# Posting to X with media (the Narrator's image path)

The @FabletonWorld Narrator (CMO) runs in headless heartbeats. Browser-driven
posting can't reliably attach images from a heartbeat, and the headless login
loop is fragile (SMS-verification interstitials, expired browser profiles,
IP-based rate limits — see FABA-96). The durable path is the **X API v2 with
OAuth 1.0a**: `scripts/x-post.mjs` posts text + image directly, no browser.

## Usage

```sh
# text + image (the heartbeat flow: screenshot -> upload -> post)
node scripts/x-post.mjs --text "the orchard at dusk" --image /tmp/shot.png

# text only
node scripts/x-post.mjs --text "a quiet arrangement in the orchard"

# offline verification — no network, no credentials
node scripts/x-post.mjs --selftest

# live read-only pre-flight — confirms creds authenticate, posts NOTHING
node scripts/x-post.mjs --verify

# dry run — validates args + credentials, builds the auth header, no network
node scripts/x-post.mjs --dry-run --text "..." --image /tmp/shot.png
```

On a successful post the CLI prints one JSON line:
`{"ok":true,"tweetId":"...","mediaId":"..."}`. `--verify` prints
`{"ok":true,"verifiedAs":"fabletonworld","userId":"..."}`.
Exit codes: `0` success, `1` post/verify failed (API error), `2` bad args /
missing image, `3` missing credentials.

## Credentials

An X developer app on the @FabletonWorld account, OAuth 1.0a, **write** scope.
Set these in the Narrator's environment (never in the repo — `.env` is
gitignored). Installation location is the Narrator's **adapter env config**
(masked secrets), not issue comments — see "Where creds get installed" below.

| Env var                 | What it is                          | Required?          |
| ----------------------- | ----------------------------------- | ------------------ |
| `X_API_KEY`             | consumer / API key                  | yes                |
| `X_API_SECRET`          | consumer / API secret               | yes                |
| `X_ACCESS_TOKEN`        | user access token (write scope)     | yes                |
| `X_ACCESS_TOKEN_SECRET` | user access token secret            | yes                |
| `X_BEARER_TOKEN`        | OAuth 2.0 **app-only** bearer token | no (see below)     |

**Why the bearer token is optional.** Media upload and posting to a user's
timeline require **user-context** auth (OAuth 1.0a). The OAuth 2.0 app-only
bearer token cannot act as the user, so it is never used for the write path.
The script still reads it and reports it in `--dry-run` for completeness, so
installing all five values from the X developer portal is harmless.

Optional overrides if X moves the routes: `X_MEDIA_UPLOAD_URL`
(default `https://api.x.com/2/media/upload`), `X_TWEETS_URL`
(default `https://api.x.com/2/tweets`), `X_USERS_ME_URL`
(default `https://api.x.com/2/users/me`).

## Where creds get installed on the Narrator's adapter

The four required values are set as **environment variables in the Narrator
agent's adapter config** (the same masked-secret mechanism that already holds
`X_EMAIL`/`X_USERNAME`/`X_PASSWORD`). They must live there — not in an issue
comment or the repo — so every heartbeat process inherits them. Once the four
vars are present, no code change or redeploy is needed: the very next heartbeat
that runs `node scripts/x-post.mjs …` will post via the API.

## Which path does the Narrator use? (prefer API, fall back gracefully)

A heartbeat that wants to post picks the path by credential presence:

1. **API (preferred).** If `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, and
   `X_ACCESS_TOKEN_SECRET` are all set → post via `scripts/x-post.mjs`. This is
   the durable path: no browser, no login, no SMS/rate-limit failure modes.
2. **Browser / session fallback.** Only if those vars are absent → fall back to
   the browser path (or the cookie-restore path in "Option A" below). Fragile;
   used only until API creds land.

Concretely, the heartbeat should gate on the env vars before choosing:

```sh
if [ -n "$X_API_KEY" ] && [ -n "$X_API_SECRET" ] \
   && [ -n "$X_ACCESS_TOKEN" ] && [ -n "$X_ACCESS_TOKEN_SECRET" ]; then
  node scripts/x-post.mjs --text "<caption>" --image /tmp/shot.png
else
  : # fall back to the browser/cookie path (Option A)
fi
```

## The heartbeat flow

A heartbeat that posts with an image does, in one run:

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

## Option A fallback — session / cookie restore

If the founder prefers restoring a logged-in browser session instead of
provisioning API tokens, the Narrator's browser path can be revived by
importing exported cookies. This is a **fallback**; the API path above is the
durable fix and should be preferred whenever API creds exist.

The Narrator's browser runs a persistent Chromium profile at
`/tmp/x-playwright-mobile1/Default/`. Two supported import routes:

1. **Playwright `storageState` (recommended, portable).** Export cookies from a
   browser already logged in to @fabletonworld (DevTools → Application →
   Cookies, or a "cookies.txt"/JSON export), shape them as a Playwright
   [storageState](https://playwright.dev/docs/auth) JSON, and hand them to the
   Narrator's browser context. Provide them either as a file the context loads
   (`browser.newContext({ storageState: 'x-state.json' })`) or via an env var
   the heartbeat writes to that file before launch:

   ```sh
   # X_COOKIES_JSON holds a Playwright storageState document
   printf '%s' "$X_COOKIES_JSON" > /tmp/x-state.json
   # launch the browser context with storageState: /tmp/x-state.json
   ```

2. **Profile-dir drop-in.** Copy a `Cookies` SQLite database exported from a
   matching Chromium profile directly into
   `/tmp/x-playwright-mobile1/Default/Cookies`, then launch the persistent
   context against `/tmp/x-playwright-mobile1`. Note: Chromium encrypts cookie
   values per-profile, so this only works when the export came from a
   compatible profile/OS keyring — the `storageState` route above is more
   portable.

Caveat: X session cookies expire and can be invalidated by re-login elsewhere,
so this path needs periodic refresh. The API path has no such decay — prefer it.

## Verification status

Creds-independent verification (FABA-97), all offline / no live creds:

- `--selftest` passes: the OAuth 1.0a signature base string matches X's own
  documented worked example byte-for-byte, the HMAC-SHA1 step matches the
  RFC 2202 vectors, a mocked `upload → tweet` round-trip confirms the media-id
  is threaded into `media_ids`, and a mocked `verifyCreds` (`/2/users/me`)
  round-trip confirms the read pre-flight.
- `--dry-run` reports the five env vars (four required + optional bearer) and
  builds a real `/2/tweets` auth header when the four required creds are set.
- `--verify` was exercised end-to-end against a local mock of `/2/users/me`
  (real `fetch`, real OAuth 1.0a header): it authenticates and returns the
  handle.

The **only** step left pending founder-provided creds:

- A **live** `--verify` and a **live** media post, both blocked on provisioning
  the four credentials above on the human-owned @FabletonWorld X account (see
  FABA-96 / FABA-94). Once the four vars are installed on the Narrator's
  adapter, run `node scripts/x-post.mjs --verify` to confirm, then post.

## Implementation notes

- Zero runtime dependencies — Node ≥ 20 built-ins only (`fetch`, `FormData`,
  `Blob`, `node:crypto`, `node:fs`). No `twitter-api-v2`, no `oauth`.
- Media upload is multipart and `/2/tweets` is JSON; neither body participates in
  the OAuth signature base string (only the `oauth_*` params do), per X's spec.
