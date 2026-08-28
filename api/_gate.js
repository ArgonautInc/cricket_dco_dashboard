// ── The shared sign-in cookie, verify side ────────────────────────────
// DCO does not run its own login any more. The whole site signs in once on
// the splash page of the parent project (crk-creative-dashboard), which mints
// a signed HttpOnly `crk_access` cookie carrying the resolved access map —
// see that repo's lib/gateToken.ts (the signing side) and api/session.js.
//
// This is a verify-only copy of that module, translated to Node's built-in
// crypto (this project has no build step / npm deps, and these functions run
// on Vercel's Node runtime, not Edge). It is duplicated rather than imported
// because this is a separate Vercel project with its own Root Directory — the
// wire format below MUST stay byte-compatible with the signer.
//
// Requires CRK_SESSION_SECRET — the same value the parent project signs with.

const crypto = require('crypto');

const GATE_COOKIE = 'crk_access';

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest();
}

// Returns the payload, or null for anything wrong — bad signature, malformed
// token, expired. Callers treat null as "not signed in"; there is deliberately
// no way to distinguish the failure modes from outside.
function verifyGateToken(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const expected = hmac(secret, body);
    const actual = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || !payload.apps) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Minimal cookie-header parser — enough for reading one known key.
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// "chris.greco" → "Chris Greco". The access map carries no real name (it is
// keyed by email), and there is no user table to join, so the handle is the
// best display name available. Ported verbatim from clcc-web/lib/identity.ts.
function displayName(handle) {
  return (handle || '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = { GATE_COOKIE, verifyGateToken, readCookie, displayName };
