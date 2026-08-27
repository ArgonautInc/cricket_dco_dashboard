// Shared caller verification for every DCO API route.
//
// The whole site signs in once on the parent project's splash page, which
// mints a signed HttpOnly `crk_access` cookie carrying the resolved access
// map (see api/_gate.js). This just verifies that cookie and requires a
// `dco` grant — any role, since dco/clcc/spec run their own internal levels
// once through the site-wide gate (lib/appAccess.ts in the parent repo).
//
// This used to verify a Google OAuth bearer token instead (the routes handed
// back the browser's live BigQuery/GCS token). That's gone now that
// bq-query.js / gcs-list.js / gcs-fetch.js proxy through a service account —
// replacing it only touched this function, as anticipated when it was
// written: the routes don't care how the caller was identified.

const { GATE_COOKIE, verifyGateToken, readCookie } = require('./_gate');

const APP_ID = 'dco';

async function verifyCaller(req) {
  const secret = process.env.CRK_SESSION_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: 'CRK_SESSION_SECRET not configured' };
  }

  const token = readCookie(req.headers.cookie, GATE_COOKIE);
  const payload = verifyGateToken(token, secret);
  if (!payload || !payload.apps || !payload.apps[APP_ID]) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }

  return { ok: true, email: payload.email, handle: payload.handle };
}

module.exports = { verifyCaller };
