// What a contact is and how to find one by name — shared by the Contactos screen
// and Eddie's tools (api/_lib/connectors/contacts) so both agree on the rules.
export const MAX_CONTACTS = 500;

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (value, max) => String(value ?? '').replace(/[\p{Cc}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const sameName = (a, b) => strip(clean(a, 80)) === strip(clean(b, 80));

// Phone numbers: keep what a person types ("+1 (809) 555-1234"), at most 25 characters.
export const cleanPhone = (value) => clean(value, 25).replace(/[^\d+()\-.\s]/g, '').trim();

// "@juan.perez", "instagram.com/juan.perez/" → "juan.perez"; anything else → ''.
export function cleanInstagram(value) {
  const raw = clean(value, 120).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(raw) ? raw : '';
}

export const cleanEmail = (value) => {
  const email = clean(value, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

// → { fields } with every field cleaned, or { error } in Spanish for the person.
export function cleanContact(input = {}) {
  const name = clean(input.name, 80);
  if (!name) return { error: 'Ponle un nombre al contacto.' };
  const instagramGiven = clean(input.instagram, 120);
  const instagram = cleanInstagram(instagramGiven);
  if (instagramGiven && !instagram) return { error: 'Ese usuario de Instagram no es válido (solo letras, números, puntos y guiones bajos).' };
  const emailGiven = clean(input.email, 120);
  const email = cleanEmail(emailGiven);
  if (emailGiven && !email) return { error: 'Ese correo no es válido.' };
  return { fields: { name, phone: cleanPhone(input.phone), instagram, email, notes: clean(input.notes, 500) } };
}

// Best matches first: the exact name, then names that start with the words, then
// names or notes that contain every word. Accents and case do not matter.
export function matchContacts(contacts, query, { limit = 5 } = {}) {
  const q = strip(clean(query, 120));
  if (!q) return [];
  const words = q.split(' ').filter(Boolean);
  const scored = [];
  for (const contact of contacts) {
    const name = strip(contact.name);
    const hay = `${name} ${strip(contact.notes)} ${strip(contact.instagram)}`;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (words.every((w) => name.split(' ').some((part) => part.startsWith(w)))) score = 70;
    else if (name.includes(q)) score = 60;
    else if (words.every((w) => hay.includes(w))) score = 30;
    if (score) scored.push({ contact, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.contact.name.localeCompare(b.contact.name, 'es')).slice(0, limit).map((s) => s.contact);
}

// "+1 (809) 555-1234", "00 34 600 000 000", "8095551234" → digits with the country code, or null.
// Dominican Republic area codes (809, 829, 849) without a country code are +1 numbers.
const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164
const DR_AREA = /^(809|829|849)\d{7}$/;

export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  const explicit = digits.startsWith('+') || digits.startsWith('00');
  digits = digits.replace(/^\+/, '').replace(/\+/g, '').replace(/^00/, '');
  if (!explicit && DR_AREA.test(digits)) digits = `1${digits}`;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS || digits.startsWith('0')) return null;
  return digits;
}

// Links that open an app with the message written. Nothing is sent: the person presses send.
export const whatsappLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone, text) => `sms:+${phone}${text ? `?&body=${encodeURIComponent(text)}` : ''}`;
export const instagramLink = (user) => `https://ig.me/m/${encodeURIComponent(user)}`;
