// GET /api/gcs-fetch?name=reports%2Ffoo.csv
//   -> raw object bytes, Content-Type set by extension     200
//
// Server-side replacement for the client's old gcsFetchObject(), which used
// the browser's live GCS OAuth token. The client keeps deciding res.text()
// vs res.arrayBuffer() by extension, same as before — this just returns the
// same bytes the object actually contains.

const { verifyCaller } = require('./_auth');
const { getServiceAccountToken } = require('./_gcp');

const GCS_BUCKET = 'crk-dco-bucket-daily-performance';
const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const MAX_NAME_LEN = 1024;

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

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

  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!name || name.length > MAX_NAME_LEN) {
    res.status(400).json({ error: 'Missing or invalid name' });
    return;
  }

  let token;
  try {
    token = await getServiceAccountToken(GCS_SCOPE);
  } catch (e) {
    res.status(500).json({ error: 'GCP auth failed: ' + e.message });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${encodeURIComponent(name)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e) {
    res.status(502).json({ error: 'Cloud Storage unreachable: ' + e.message });
    return;
  }
  if (!upstream.ok) {
    res.status(upstream.status).json({ error: `Cloud Storage fetch failed (${upstream.status})` });
    return;
  }

  const ext = name.split('.').pop().toLowerCase();
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(buf);
};
