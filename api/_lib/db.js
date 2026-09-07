// Server-only Postgres access via Neon's serverless driver (HTTP-based,
// no persistent connection pool needed — a good fit for Vercel functions).
// DATABASE_URL must never be exposed to the frontend.
import { neon } from '@neondatabase/serverless';

let sql;

export function getDb() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      const err = new Error('La base de datos no está configurada (falta DATABASE_URL).');
      err.code = 'DB_UNAVAILABLE';
      throw err;
    }
    sql = neon(url);
  }
  return sql;
}
