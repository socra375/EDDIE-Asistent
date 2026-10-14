// Database side of Cuentas del negocio (see db/migrations/0032_ledger.sql). Dates
// travel as YYYY-MM-DD text (to_char) and money as cents, so nothing depends on
// the server's time zone or on floating point.
import { getDb } from '../db.js';
import { MAX_ENTRIES } from '../../../src/services/ledger.js';

const shape = (row) => ({
  id: String(row.id),
  kind: row.kind,
  amountCents: Number(row.amount_cents),
  currency: row.currency || '',
  concept: row.concept,
  category: row.category || '',
  client: row.client || '',
  date: row.entry_date,
  status: row.status,
  dueDate: row.due_date || null,
  paidDate: row.paid_date || null,
  note: row.note || '',
  createdAt: new Date(row.created_at).toISOString(),
});

export async function listEntries(userId) {
  const sql = getDb();
  const rows = await sql`
    select id, kind, amount_cents, currency, concept, category, client,
      to_char(entry_date, 'YYYY-MM-DD') as entry_date, status,
      to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(paid_date, 'YYYY-MM-DD') as paid_date, note, created_at
    from ledger_entries where user_id = ${userId}
    order by entry_date desc, created_at desc limit ${MAX_ENTRIES}
  `;
  return rows.map(shape);
}

export async function countEntries(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from ledger_entries where user_id = ${userId}`;
  return Number(rows[0]?.n || 0);
}

export async function addEntry(userId, e) {
  const sql = getDb();
  const rows = await sql`
    insert into ledger_entries (user_id, kind, amount_cents, currency, concept, category, client, entry_date, status, due_date, paid_date, note)
    values (${userId}, ${e.kind}, ${e.amountCents}, ${e.currency}, ${e.concept}, ${e.category}, ${e.client}, ${e.date}, ${e.status}, ${e.dueDate}, ${e.paidDate}, ${e.note})
    returning id, kind, amount_cents, currency, concept, category, client,
      to_char(entry_date, 'YYYY-MM-DD') as entry_date, status,
      to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(paid_date, 'YYYY-MM-DD') as paid_date, note, created_at
  `;
  return shape(rows[0]);
}

// `e` is the complete entry (the caller merges what changed); → the saved entry or null if it is not the user's.
export async function updateEntry(userId, id, e) {
  const sql = getDb();
  const rows = await sql`
    update ledger_entries set
      amount_cents = ${e.amountCents}, currency = ${e.currency}, concept = ${e.concept}, category = ${e.category},
      client = ${e.client}, entry_date = ${e.date}, status = ${e.status}, due_date = ${e.dueDate}, paid_date = ${e.paidDate},
      note = ${e.note}, updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning id, kind, amount_cents, currency, concept, category, client,
      to_char(entry_date, 'YYYY-MM-DD') as entry_date, status,
      to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(paid_date, 'YYYY-MM-DD') as paid_date, note, created_at
  `;
  return rows[0] ? shape(rows[0]) : null;
}

export async function deleteEntry(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from ledger_entries where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}
