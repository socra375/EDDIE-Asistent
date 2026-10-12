// Database side of Contactos (see db/migrations/0029_contacts.sql).
import { getDb } from '../db.js';
import { MAX_CONTACTS } from '../../../src/services/contactsCore.js';

const shape = (row) => ({
  id: String(row.id),
  name: row.name,
  phone: row.phone || '',
  instagram: row.instagram || '',
  email: row.email || '',
  notes: row.notes || '',
  self: Boolean(row.is_self),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listContacts(userId) {
  const sql = getDb();
  const rows = await sql`
    select id, name, phone, instagram, email, notes, is_self, updated_at
    from contacts where user_id = ${userId}
    order by is_self desc, lower(name) asc limit ${MAX_CONTACTS}
  `;
  return rows.map(shape);
}

export async function getContact(userId, id) {
  const sql = getDb();
  const rows = await sql`
    select id, name, phone, instagram, email, notes, is_self, updated_at
    from contacts where user_id = ${userId} and id = ${id}
  `;
  return rows[0] ? shape(rows[0]) : null;
}

export async function countContacts(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from contacts where user_id = ${userId}`;
  return Number(rows[0].n);
}

// `self: true` makes this contact the user's own number (the previous one stops being it).
export async function createContact(userId, fields, { self = false } = {}) {
  const sql = getDb();
  if (self) await sql`update contacts set is_self = false where user_id = ${userId} and is_self`;
  const rows = await sql`
    insert into contacts (user_id, name, phone, instagram, email, notes, is_self)
    values (${userId}, ${fields.name}, ${fields.phone}, ${fields.instagram}, ${fields.email}, ${fields.notes}, ${self})
    returning id, name, phone, instagram, email, notes, is_self, updated_at
  `;
  return shape(rows[0]);
}

export async function updateContact(userId, id, fields, { self } = {}) {
  const sql = getDb();
  if (self === true) await sql`update contacts set is_self = false where user_id = ${userId} and is_self and id <> ${id}`;
  const rows = await sql`
    update contacts set
      name = ${fields.name}, phone = ${fields.phone}, instagram = ${fields.instagram},
      email = ${fields.email}, notes = ${fields.notes},
      is_self = coalesce(${self === undefined ? null : self}::boolean, is_self),
      updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning id, name, phone, instagram, email, notes, is_self, updated_at
  `;
  return rows[0] ? shape(rows[0]) : null;
}

export async function deleteContact(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from contacts where user_id = ${userId} and id = ${id} returning id`;
  return rows.length > 0;
}
