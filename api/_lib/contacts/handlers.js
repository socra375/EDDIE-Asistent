// /api/connectors/contacts — the address book, for the Contactos screen:
//   GET  contacts                         every contact (the user's own number first)
//   POST contacts/save { id?, name, phone, instagram, email, notes, self? }   adds one, or edits it when `id` is given
//   POST contacts/delete { id }
import { requireUser } from '../session.js';
import { MAX_CONTACTS, cleanContact } from '../../../src/services/contactsCore.js';
import { countContacts, createContact, deleteContact, getContact, listContacts, updateContact } from './store.js';

const UUID = /^[0-9a-f-]{36}$/i;
const noStore = { 'Cache-Control': 'private, no-store' };
const bad = (status, error) => ({ status, json: { error } });

export async function handleContactsRoute({ method, path = [], cookies = {}, body }) {
  if (!process.env.DATABASE_URL) return { status: 200, json: { configured: false, items: [] } };
  const user = await requireUser(cookies);
  const sub = path[1];

  if (!sub && method === 'GET') return { status: 200, headers: noStore, json: { configured: true, items: await listContacts(user.id), max: MAX_CONTACTS } };

  if (sub === 'save' && method === 'POST') {
    const cleaned = cleanContact(body);
    if (cleaned.error) return bad(400, cleaned.error);
    const self = body?.self === undefined ? undefined : Boolean(body.self);
    if (self && !cleaned.fields.phone) return bad(400, 'Para marcar este contacto como tu número, escribe el teléfono.');
    if (body?.id) {
      if (!UUID.test(String(body.id))) return bad(400, 'Contacto no válido.');
      const item = await updateContact(user.id, body.id, cleaned.fields, { self });
      return item ? { status: 200, json: { item } } : bad(404, 'Ese contacto ya no existe.');
    }
    if ((await countContacts(user.id)) >= MAX_CONTACTS) return bad(409, `Ya tienes ${MAX_CONTACTS} contactos. Borra alguno para hacer espacio.`);
    return { status: 200, json: { item: await createContact(user.id, cleaned.fields, { self: Boolean(self) }) } };
  }

  if (sub === 'delete' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return bad(400, 'Contacto no válido.');
    if (!(await getContact(user.id, body.id))) return bad(404, 'Ese contacto ya no existe.');
    await deleteContact(user.id, body.id);
    return { status: 200, json: { ok: true } };
  }
  return bad(404, 'Esa acción de Contactos no existe.');
}
