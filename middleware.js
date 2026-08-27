// ── Edge gate, closing the "bare vercel.app is public" gap ────────────
// The parent project (crk-creative-dashboard) already gates /dco at its own
// edge (middleware.ts) before its rewrite ever reaches this deployment. That
// is NOT redundant with this file: that gate only sees traffic arriving on
// the main domain, and this deployment's own *.vercel.app hostname is public
// (Vercel Deployment Protection is off so the rewrite can reach it) — this is
// the only thing standing on that path. Same reasoning as clcc-web/proxy.ts
// in the parent repo, which closed the identical gap for CLCC.
//
// Verifies the same signed `crk_access` cookie the parent project mints on
// its splash page (lib/gateToken.ts there, api/_gate.js here — a verify-only,
// wire-compatible copy). WebCrypto rather than Node's crypto module: this
// runs on Vercel's Edge runtime, which only has the former.
//
// Requires CRK_SESSION_SECRET in this project's Vercel env, same value the
// parent project signs with. No npm dependencies — this project has no
// package.json/build step, so this deliberately avoids @vercel/edge and uses
// only the standard Request/Response Web APIs.

const GATE_COOKIE = 'crk_access';
const APP_ID = 'dco';

// Where the one login lives. Every sign-in happens on the parent project's
// splash page. Overridable so a preview deploy can point at a preview splash.
// Matches clcc-web/lib/identity.ts's LOGIN_ORIGIN exactly — same parent site.
function loginOrigin() {
  return (typeof process !== 'undefined' && process.env.CRK_LOGIN_ORIGIN) ||
    'https://crk.argocreativetools.com';
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};

export default async function middleware(request) {
  const url = new URL(request.url);

  const secret = ENV_SECRET();
  if (!secret) {
    console.error('[middleware] CRK_SESSION_SECRET is not set — denying', url.pathname);
    return deny(url);
  }

  const token = readCookie(request.headers.get('cookie'), GATE_COOKIE);
  const payload = await verifyGateToken(token, secret);
  if (!payload || !payload.apps || !payload.apps[APP_ID]) {
    return deny(url);
  }

  // No return value = continue to the requested resource.
}

function ENV_SECRET() {
  // Edge Middleware exposes env vars via `process.env`, same as Node
  // functions, once set in the Vercel project — no special access needed.
  return typeof process !== 'undefined' ? process.env.CRK_SESSION_SECRET : undefined;
}

// Always an ABSOLUTE redirect to the parent site, never relative. This must
// work correctly even when the request hit this deployment's own public
// *.vercel.app hostname directly — a relative "/" would resolve on that same
// host, which is also gated, and loop forever instead of ever reaching a
// real login page.
function deny(url) {
  const to = new URL('/', loginOrigin());
  to.searchParams.set('denied', APP_ID);
  to.searchParams.set('next', '/dco' + url.pathname + url.search);
  return Response.redirect(to.toString(), 307);
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function verifyGateToken(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload || typeof payload.exp !== 'number' || !payload.apps) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
