// Shared caller verification for the Cloudflare Images proxy routes.
//
// The dashboard signs in with Google and holds an OAuth *access* token
// (index.html:3296, scope includes `email profile`). We hand that token back to
// Google to find out who it belongs to rather than trusting anything the client
// claims, then gate on the email domain.
//
// This is what makes signed image URLs mean anything: without it, /api/cf-sign-images
// would mint valid URLs for any caller and the signing requirement would be
// decorative.
//
// Replacing this with the shared Supabase check later touches verifyCaller() only —
// the routes don't care how the caller was identified.

const ALLOWED_DOMAIN = '@argonautinc.com';

// Google's userinfo endpoint is rate-limited and every image render would hit it,
// so cache positive lookups briefly. Serverless instances are reused between
// invocations, which is enough for this to help.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function verifyCaller(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token' };

  const hit = cache.get(token);
  if (hit && hit.expires > Date.now()) return decide(hit.email);

  let info;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return { ok: false, status: 401, error: 'Token rejected by Google' };
    info = await res.json();
  } catch (e) {
    return { ok: false, status: 502, error: 'Could not reach Google to verify token' };
  }

  const email = String(info.email || '').toLowerCase();
  if (!email || info.email_verified === false) {
    return { ok: false, status: 403, error: 'Account has no verified email' };
  }

  cache.set(token, { email, expires: Date.now() + CACHE_TTL_MS });
  return decide(email);
}

function decide(email) {
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return { ok: false, status: 403, error: 'Account not permitted' };
  }
  return { ok: true, email };
}

module.exports = { verifyCaller, ALLOWED_DOMAIN };
