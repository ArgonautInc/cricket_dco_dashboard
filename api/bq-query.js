// POST /api/bq-query   { sql }
//   -> { rows: [...] }                     200
//   -> { error }                           400 (BigQuery rejected the query)
//
// Runs a readonly BigQuery query with the DCO service account, so the
// browser never holds a Google access token. Trust level is unchanged from
// the old client-side flow: any signed-in DCO user could already run
// arbitrary readonly SQL against BQ_PROJECT with their own OAuth token — this
// just relays it server-side instead. The row-shaping below (schema field
// names + row.f[].v) is exactly what the client used to do itself in
// bqQuery(); moving it here keeps the client function a thin fetch.

const { verifyCaller } = require('./_auth');
const { getServiceAccountToken } = require('./_gcp');

const BQ_PROJECT = 'crk-dco-dash';
const BQ_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';
const MAX_SQL_LEN = 20000;

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

  const sql = (req.body || {}).sql;
  if (typeof sql !== 'string' || !sql.trim()) {
    res.status(400).json({ error: 'Missing sql' });
    return;
  }
  if (sql.length > MAX_SQL_LEN) {
    res.status(400).json({ error: 'Query too long' });
    return;
  }

  let token;
  try {
    token = await getServiceAccountToken(BQ_SCOPE);
  } catch (e) {
    res.status(500).json({ error: 'GCP auth failed: ' + e.message });
    return;
  }

  let data;
  try {
    const upstream = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, useLegacySql: false, location: 'US', timeoutMs: 30000 }),
      },
    );
    data = await upstream.json();
  } catch (e) {
    res.status(502).json({ error: 'BigQuery unreachable: ' + e.message });
    return;
  }

  if (data.error) {
    res.status(400).json({ error: data.error.message || 'BigQuery query failed' });
    return;
  }
  if (!data.rows) {
    res.status(200).json({ rows: [] });
    return;
  }

  const fields = data.schema.fields.map(f => f.name);
  const rows = data.rows.map(row => {
    const obj = {};
    row.f.forEach((cell, i) => { obj[fields[i]] = cell.v; });
    return obj;
  });
  res.status(200).json({ rows });
};
