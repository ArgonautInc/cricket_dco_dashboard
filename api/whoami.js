// GET /api/whoami
//   -> { email, handle, name }              200, signed in
//   -> { error, next }                      401, not signed in
//
// Called once on page load in place of the old Google Sign-In flow. The
// `next` URL points back at the parent project's splash page — relative,
// since DCO is reached same-origin through the parent's rewrite, so there is
// no domain to hardcode. middleware.js normally blocks this page from ever
// loading unauthenticated in the first place; this only matters if the
// cookie expires mid-session.

const { GATE_COOKIE, verifyGateToken, readCookie, displayName } = require('./_gate');

const APP_ID = 'dco';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  const secret = process.env.CRK_SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRK_SESSION_SECRET not configured' });
    return;
  }

  const token = readCookie(req.headers.cookie, GATE_COOKIE);
  const payload = verifyGateToken(token, secret);
  if (!payload || !payload.apps || !payload.apps[APP_ID]) {
    res.status(401).json({ error: 'Not signed in', next: '/?denied=dco&next=/dco' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    email: payload.email,
    handle: payload.handle,
    name: displayName(payload.handle) || payload.email,
  });
};
