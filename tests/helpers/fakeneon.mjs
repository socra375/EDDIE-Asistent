// A fake Neon HTTP endpoint: `handlers` is a list of [regex, (params, sql) => rows|{rows}] tried in order.
export function installNeon(handlers, log = []) {
  process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('neon.tech/sql')) return real(url, init);
    const body = JSON.parse(init.body);
    const q = body.query.replace(/\s+/g, ' ').trim();
    log.push({ q, params: body.params });
    for (const [re, fn] of handlers) {
      if (re.test(q)) {
        const out = fn(body.params, q);
        const rows = Array.isArray(out) ? out : out?.rows || [];
        const names = rows[0] ? Object.keys(rows[0]) : [];
        const typeOf = (v) => (typeof v === 'number' ? 23 : typeof v === 'boolean' ? 16 : v && typeof v === 'object' ? 3802 : 25);
        return new Response(JSON.stringify({
          command: 'SELECT', rowCount: rows.length,
          fields: names.map((name) => ({ name, dataTypeID: typeOf(rows[0][name]), tableID: 0, columnID: 0, dataTypeSize: -1, dataTypeModifier: -1, format: 'text' })),
          rows: rows.map((r) => names.map((k) => (r[k] === null ? null : typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k])))),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ message: `no fake for: ${q}` }), { status: 400 });
  };
  return () => { globalThis.fetch = real; };
}
