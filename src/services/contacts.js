// The calls the Contactos screen makes to /api/connectors/contacts.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/contacts${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data || {};
}

export const listContacts = () => call('');
// → { item }; with `id` it edits that contact, without it adds a new one.
export const saveContact = (fields) => call('/save', { method: 'POST', body: fields });
export const deleteContact = (id) => call('/delete', { method: 'POST', body: { id } });

// Android Chrome can hand over contacts the person picks; nothing else (iPhone, desktop) can.
export const canPickContacts = () => typeof navigator !== 'undefined' && 'contacts' in navigator && typeof window !== 'undefined' && 'ContactsManager' in window;

// → [{ name, phone }] for the contacts the person chose; [] if they closed the picker.
export async function pickContacts() {
  const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
  return picked.map((p) => ({ name: String(p.name?.[0] || '').trim(), phone: String(p.tel?.[0] || '').trim() })).filter((p) => p.name);
}
