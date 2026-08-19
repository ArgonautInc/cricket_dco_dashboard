// GET /api/cf-images?per_page=200&continuation_token=<token>
//   -> the Cloudflare Images v2 list response, passed through unchanged
//
// Exists because the Cloudflare API can't be called from the browser: it needs
// CLOUDFLARE_API_TOKEN, which can list, upload and delete every asset on the
// account. That token stays server-side.

const { verifyCaller } = require('./_auth');

const MAX_PER_PAGE = 200;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  const auth = await verifyCaller(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const account = process.env.CF_ACCOUNT_ID;
  const token   = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    res.status(500).json({ error: 'CF_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not configured' });
    return;
  }

  const perPage = Math.min(Number(req.query.per_page) || MAX_PER_PAGE, MAX_PER_PAGE);
  const cont    = req.query.continuation_token;

  let url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`
          + `/images/v2?per_page=${perPage}`;
  if (cont) url += `&continuation_token=${encodeURIComponent(cont)}`;

  try {
    const upstream = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Cloudflare API unreachable: ' + e.message });
  }
};
