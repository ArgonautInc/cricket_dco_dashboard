// GET /api/gcs-list?prefix=reports/
//   -> [ { name, updated, ... }, ... ]      200, .csv/.xlsx/.xls only, newest first
//
// Server-side replacement for the client's old gcsListObjects(), which used
// the browser's live GCS OAuth token. Same filter/sort behavior, now backed
// by the DCO service account.

const { verifyCaller } = require('./_auth');
const { getServiceAccountToken } = require('./_gcp');

const GCS_BUCKET = 'crk-dco-bucket-daily-performance';
const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

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

  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';

  let token;
  try {
    token = await getServiceAccountToken(GCS_SCOPE);
  } catch (e) {
    res.status(500).json({ error: 'GCP auth failed: ' + e.message });
    return;
  }

  const url = `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o?maxResults=500` +
    (prefix ? `&prefix=${encodeURIComponent(prefix)}` : '');

  let data;
  try {
    const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    data = await upstream.json();
  } catch (e) {
    res.status(502).json({ error: 'Cloud Storage unreachable: ' + e.message });
    return;
  }

  if (data.error) {
    res.status(400).json({ error: data.error.message || 'Cloud Storage list failed' });
    return;
  }

  const items = (data.items || [])
    .filter(o => /\.(csv|xlsx|xls)$/i.test(o.name))
    .sort((a, b) => new Date(b.updated) - new Date(a.updated));

  res.status(200).json(items);
};
