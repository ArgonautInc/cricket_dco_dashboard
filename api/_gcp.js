// ── GCP service-account auth ────────────────────────────────────────
// Used by api/bq-query.js and api/gcs-list.js / api/gcs-fetch.js so the
// browser never needs a live Google OAuth token: the server holds a service
// account and mints its own scoped access tokens via the standard JWT-bearer
// flow (RFC 7523), signed with Node's built-in crypto — no npm deps, matching
// the rest of this project.
//
// Requires GCP_SERVICE_ACCOUNT_KEY: the full JSON key for a service account
// granted BigQuery Data Viewer + Job User, and Storage Object Viewer on
// crk-dco-bucket-daily-performance.

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const EXP_SEC = 3600;
const REFRESH_SKEW_SEC = 60;  // refresh this long before actual expiry

// Cached per scope string (space-joined) — Vercel reuses instances between
// invocations, so this saves a token-mint round trip on warm requests.
const cache = new Map();

function loadKey() {
  const raw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GCP_SERVICE_ACCOUNT_KEY is not configured');
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is missing client_email/private_key');
  }
  return key;
}

function b64url(buf) {
  return buf.toString('base64url');
}

function signJwt(key, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + EXP_SEC,
  };
  const signingInput =
    b64url(Buffer.from(JSON.stringify(header))) + '.' +
    b64url(Buffer.from(JSON.stringify(claims)));

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(key.private_key));

  return signingInput + '.' + signature;
}

async function getServiceAccountToken(scopes) {
  const scope = (Array.isArray(scopes) ? scopes : [scopes]).join(' ');

  const hit = cache.get(scope);
  if (hit && hit.expires > Date.now()) return hit.token;

  const key = loadKey();
  const jwt = signJwt(key, scope);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('GCP token exchange failed: ' + (data.error_description || data.error || res.status));
  }

  const expiresInSec = Number(data.expires_in) || EXP_SEC;
  cache.set(scope, {
    token: data.access_token,
    expires: Date.now() + (expiresInSec - REFRESH_SKEW_SEC) * 1000,
  });
  return data.access_token;
}

module.exports = { getServiceAccountToken };
