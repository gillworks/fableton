#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Post a tweet to X (Twitter) with an optional attached image, from a
// headless heartbeat. This is the @FabletonWorld Narrator's media path
// (FABA-35): screenshots taken during a heartbeat can be attached to a
// post instead of being dropped.
//
//   node scripts/x-post.mjs --text "the orchard at dusk" --image /tmp/shot.png
//   node scripts/x-post.mjs --text "text-only is fine too"
//   node scripts/x-post.mjs --selftest        # offline OAuth signature check
//   node scripts/x-post.mjs --dry-run --text "..." --image /tmp/shot.png
//
// Flow (X API v2, OAuth 1.0a user context — required for media upload):
//   1. POST <media upload>  (multipart) -> media id
//   2. POST /2/tweets       (json)      -> tweet id, with media_ids: [id]
//
// Zero runtime dependencies: Node >= 20 built-ins only (global fetch,
// FormData, Blob, node:crypto, node:fs). No `twitter-api-v2`, no `oauth`.
//
// Credentials (X developer app, OAuth 1.0a — bring-your-own-keys via env):
//   X_API_KEY               consumer/API key
//   X_API_SECRET            consumer/API secret
//   X_ACCESS_TOKEN          user access token   (must have write scope)
//   X_ACCESS_TOKEN_SECRET   user access token secret
// Optional endpoint overrides (if X moves the routes):
//   X_MEDIA_UPLOAD_URL      default https://api.x.com/2/media/upload
//   X_TWEETS_URL            default https://api.x.com/2/tweets

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MEDIA_UPLOAD_URL = process.env.X_MEDIA_UPLOAD_URL || 'https://api.x.com/2/media/upload';
const TWEETS_URL = process.env.X_TWEETS_URL || 'https://api.x.com/2/tweets';

// RFC 3986 percent-encoding. encodeURIComponent leaves !*'() alone but they
// must be encoded; it leaves ~ alone, which is correct (unreserved).
const pe = (s) =>
  encodeURIComponent(String(s)).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

// Build an OAuth 1.0a Authorization header for `method` + `url`.
// `bodyParams` are only the request parameters that participate in the
// signature base string, i.e. application/x-www-form-urlencoded fields and
// URL query params. Multipart form fields and raw JSON bodies are NOT signed,
// so callers of the media-upload (multipart) and /2/tweets (json) routes pass
// bodyParams: {} — exactly per X's spec.
export function oauthHeader({
  method,
  url,
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  bodyParams = {},
  nonce,
  timestamp,
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp || Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = { ...bodyParams, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pe(k)}=${pe(all[k])}`)
    .join('&');
  const baseString = [method.toUpperCase(), pe(url), pe(paramString)].join('&');
  const signingKey = `${pe(consumerSecret)}&${pe(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauth.oauth_signature = signature;
  const header =
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pe(k)}="${pe(oauth[k])}"`)
      .join(', ');
  return { header, baseString, signature };
}

function readCreds() {
  const c = {
    consumerKey: process.env.X_API_KEY,
    consumerSecret: process.env.X_API_SECRET,
    token: process.env.X_ACCESS_TOKEN,
    tokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  const missing = Object.entries({
    X_API_KEY: c.consumerKey,
    X_API_SECRET: c.consumerSecret,
    X_ACCESS_TOKEN: c.token,
    X_ACCESS_TOKEN_SECRET: c.tokenSecret,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { creds: c, missing };
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Upload one image, return its media id string.
export async function uploadMedia({ imagePath, creds, fetchImpl = fetch }) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const { header } = oauthHeader({
    method: 'POST',
    url: MEDIA_UPLOAD_URL,
    ...creds,
    bodyParams: {}, // multipart body is not part of the signature base string
  });
  const form = new FormData();
  form.append('media', new Blob([buf], { type }), path.basename(imagePath));
  form.append('media_category', 'tweet_image');
  const res = await fetchImpl(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: header },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`media/upload ${res.status}: ${text}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`media/upload: non-JSON response: ${text}`);
  }
  // v2 returns { data: { id } }; tolerate older { media_id_string }.
  const id = json?.data?.id || json?.id || json?.media_id_string;
  if (!id) throw new Error(`media/upload: no media id in response: ${text}`);
  return String(id);
}

// Create a tweet, optionally with media ids. Returns the tweet id.
export async function createTweet({ text, mediaIds = [], creds, fetchImpl = fetch }) {
  const { header } = oauthHeader({
    method: 'POST',
    url: TWEETS_URL,
    ...creds,
    bodyParams: {}, // JSON body is not part of the signature base string
  });
  const payload = { text };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const res = await fetchImpl(TWEETS_URL, {
    method: 'POST',
    headers: { Authorization: header, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`/2/tweets ${res.status}: ${body}`);
  const json = JSON.parse(body);
  const id = json?.data?.id;
  if (!id) throw new Error(`/2/tweets: no tweet id in response: ${body}`);
  return id;
}

// take image path (optional) + text -> post. Returns { tweetId, mediaId }.
export async function postToX({ text, imagePath, creds, fetchImpl = fetch }) {
  let mediaId;
  if (imagePath) mediaId = await uploadMedia({ imagePath, creds, fetchImpl });
  const tweetId = await createTweet({
    text,
    mediaIds: mediaId ? [mediaId] : [],
    creds,
    fetchImpl,
  });
  return { tweetId, mediaId };
}

// --- Offline self-test -----------------------------------------------------
// Two independent, authoritative checks prove the signer is correct without
// any network access or live credentials:
//
//   1. Signature base string == X's official worked example, byte-for-byte.
//      https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
//      This is the OAuth-specific part that is easy to get wrong: RFC 3986
//      percent-encoding, parameter collection, sorting, and base-string
//      assembly. Matching X's own reference proves all of it.
//
//   2. HMAC-SHA1 wiring == RFC 2202 test vectors. The signing step itself is
//      Node's stdlib; RFC 2202 is the canonical HMAC-SHA1 test suite, so this
//      pins the crypto path independently of any (misremembered) vendor
//      signature constant.
async function selftest() {
  let ok = true;

  // (1) OAuth base string vs X's documented example.
  const { header, baseString, signature } = oauthHeader({
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json',
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7iA',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: '1318622958',
    bodyParams: {
      status: 'Hello Ladies + Gentlemen, a signal was received',
      include_entities: 'true',
    },
  });
  const expectedBase =
    'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&' +
    'include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26' +
    'oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26' +
    'oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26' +
    'oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26' +
    'oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signal%2520was%2520received';
  const okBase = baseString === expectedBase;
  ok = ok && okBase;
  console.log('[1] OAuth base string vs X reference:', okBase ? 'OK' : 'MISMATCH');
  if (!okBase) {
    console.log('    expected:', expectedBase);
    console.log('    actual:  ', baseString);
  }

  // (2) HMAC-SHA1 wiring vs RFC 2202 vectors.
  const rfc2202 = [
    {
      key: Buffer.alloc(20, 0x0b),
      data: Buffer.from('Hi There'),
      mac: 'b617318655057264e28bc0b6fb378c8ef146be00',
    },
    {
      key: Buffer.from('Jefe'),
      data: Buffer.from('what do ya want for nothing?'),
      mac: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    },
  ];
  for (const [i, v] of rfc2202.entries()) {
    const got = crypto.createHmac('sha1', v.key).update(v.data).digest('hex');
    const good = got === v.mac;
    ok = ok && good;
    console.log(`[2] HMAC-SHA1 RFC 2202 case ${i + 1}:`, good ? 'OK' : `MISMATCH (${got})`);
  }

  // (3) End-to-end orchestration with a mocked fetch: proves upload -> tweet
  // wiring (media-id extraction, media_ids payload, auth header on both hops)
  // without touching the network.
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });
    const isUpload = url === MEDIA_UPLOAD_URL;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(isUpload ? { data: { id: 'MEDIA123' } } : { data: { id: 'TWEET456' } }),
    };
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', 'x-post-selftest.png');
  fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a', 'hex'));
  let okFlow = false;
  try {
    const res = await postToX({
      text: 'selftest',
      imagePath: tmp,
      creds: { consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts' },
      fetchImpl: mockFetch,
    });
    const tweetCall = calls.find((c) => c.url === TWEETS_URL);
    const body = JSON.parse(tweetCall.opts.body);
    okFlow =
      res.mediaId === 'MEDIA123' &&
      res.tweetId === 'TWEET456' &&
      body.media.media_ids[0] === 'MEDIA123' &&
      calls.every((c) => String(c.opts.headers.Authorization).startsWith('OAuth '));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  ok = ok && okFlow;
  console.log('[3] mocked upload->tweet flow:', okFlow ? 'OK' : 'MISMATCH');

  console.log('    (X example signature computed as:', signature + ')');
  console.log('    (auth header:', header.slice(0, 48) + '...)');
  if (ok) {
    console.log('\nSELFTEST PASSED — OAuth 1.0a base string + HMAC-SHA1 verified offline.');
    return 0;
  }
  console.error('\nSELFTEST FAILED');
  return 1;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--selftest') a.selftest = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--text') a.text = argv[++i];
    else if (t === '--image') a.image = argv[++i];
    else a._.push(t);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) process.exit(await selftest());

  if (!args.text) {
    console.error('error: --text is required (use --selftest for the offline check)');
    process.exit(2);
  }
  if (args.image && !fs.existsSync(args.image)) {
    console.error(`error: image not found: ${args.image}`);
    process.exit(2);
  }

  const { creds, missing } = readCreds();

  if (args.dryRun) {
    console.log('DRY RUN — no network calls will be made.');
    console.log('  text :', JSON.stringify(args.text));
    console.log('  image:', args.image || '(none)');
    console.log('  media upload url:', MEDIA_UPLOAD_URL);
    console.log('  tweets url      :', TWEETS_URL);
    console.log('  credentials     :', missing.length ? `MISSING (${missing.join(', ')})` : 'present');
    if (!missing.length) {
      const { header } = oauthHeader({ method: 'POST', url: TWEETS_URL, ...creds });
      console.log('  sample /2/tweets auth header builds OK:', header.slice(0, 24) + '...');
    }
    process.exit(0);
  }

  if (missing.length) {
    console.error(
      `error: missing X API credentials: ${missing.join(', ')}.\n` +
        'Set X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET ' +
        '(X developer app, OAuth 1.0a, write scope).',
    );
    process.exit(3);
  }

  try {
    const { tweetId, mediaId } = await postToX({
      text: args.text,
      imagePath: args.image,
      creds,
    });
    console.log(JSON.stringify({ ok: true, tweetId, mediaId: mediaId || null }));
  } catch (err) {
    console.error('post failed:', err.message);
    process.exit(1);
  }
}

// Run main() only as a CLI, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
