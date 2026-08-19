// POST /api/cf-sign-images
//   body: { ids: string[], variant?: string, ttl?: number }
//   ->    { signed: { [id]: signedUrl }, exp: <unix seconds> }
//
// Mirrors the route the paid-media dashboard already calls (cloudflare.js:42-49)
// so the client contract is identical. The signing key and API token stay in
// Vercel env vars and never reach the browser.

const crypto = require('crypto');
const { verifyCaller } = require('./_auth');

const DEFAULT_VARIANT = 'public';
const DEFAULT_TTL_SEC = 7200;   // 2h — outlives the client's 1h session cache
const MIN_TTL_SEC     = 60;
const MAX_TTL_SEC     = 86400;
const MAX_IDS         = 500;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const auth = await verifyCaller(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const hash = process.env.CF_IMAGES_HASH;
  const key  = process.env.CF_IMAGES_SIGNING_KEY;
  if (!hash || !key) {
    res.status(500).json({ error: 'CF_IMAGES_HASH / CF_IMAGES_SIGNING_KEY not configured' });
    return;
  }

  const body    = req.body || {};
  const ids     = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, MAX_IDS) : [];
  const variant = typeof body.variant === 'string' && body.variant ? body.variant : DEFAULT_VARIANT;
  const ttl     = clamp(Number(body.ttl) || DEFAULT_TTL_SEC, MIN_TTL_SEC, MAX_TTL_SEC);

  if (!ids.length) {
    res.status(200).json({ signed: {}, exp: 0 });
    return;
  }

  // One expiry for the whole batch keeps the client's cache reasoning simple.
  const exp = Math.floor(Date.now() / 1000) + ttl;

  const signed = {};
  for (const id of ids) signed[id] = signUrl(hash, key, String(id), variant, exp);

  res.status(200).json({ signed, exp });
};

// Cloudflare Images signature: HMAC-SHA256 over "<path>?<query-with-exp>",
// hex-encoded, appended as `sig`. The signature covers the query string, so
// nothing may be added to the URL afterwards without re-signing.
//
// Two details are load-bearing and both are copied from the paid-media
// dashboard's production route rather than inferred:
//   - the key is used as raw UTF-8 bytes; it is NOT base64- or hex-decoded
//   - path segments are interpolated raw, with no percent-encoding
// Encoding the segments would change the signed string for any id containing
// a character encodeURIComponent escapes, and CF would reject the URL.
function signUrl(hash, key, id, variant, exp) {
  const pathname    = `/${hash}/${id}/${variant}`;
  const queryString = `exp=${exp}`;
  const sig = crypto.createHmac('sha256', key)
    .update(pathname + '?' + queryString)
    .digest('hex');
  return `https://imagedelivery.net${pathname}?${queryString}&sig=${sig}`;
}

function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }
