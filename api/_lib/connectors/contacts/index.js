// The address book Eddie reads and writes: Contactos. He looks a client up by name
// (number, Instagram, notes), saves who the user tells him about, and prepares a
// message for them — WhatsApp, SMS or Instagram — with the number already filled
// in. A message is never sent from here: the user opens the draft and presses
// send. The user's own number is one of the contacts (marked "tú"), which is
// where Eddie will reach him when he has to call. The screen is Contactos.
import { cleanContact, matchContacts, sameName, MAX_CONTACTS } from '../../../../src/services/contactsCore.js';
import { countContacts, createContact, deleteContact, listContacts, updateContact } from '../../contacts/store.js';
import { normalizePhone, whatsappUrl } from '../whatsapp/index.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para usar tus contactos inicia sesión con Google (Configuración → Cuenta de Google).';
const MAX_TEXT = 1000;
const MAX_URL = 3500;
const CHANNELS = { whatsapp: 'WhatsApp', sms: 'SMS', instagram: 'Instagram' };

const getUser = async (context) => context.getUser?.();

const view = (c) => ({
  name: c.name,
  phone: c.phone || null,
  whatsapp_number: c.phone ? normalizePhone(c.phone) && `+${normalizePhone(c.phone)}` : null,
  instagram: c.instagram || null,
  email: c.email || null,
  notes: c.notes || null,
  is_user_himself: c.self,
});

// One contact for a name: the exact match, or the only match, or an error that lists the candidates.
function pick(contacts, name) {
  const found = matchContacts(contacts, name, { limit: 5 });
  if (!found.length) return { error: `No tengo a «${clip(name, 60)}» en Contactos. Pregúntale al usuario el número y guárdalo con save_contact.` };
  const exact = found.find((c) => c.name.toLowerCase() === String(name).trim().toLowerCase());
  if (exact) return { contact: exact };
  if (found.length === 1) return { contact: found[0] };
  return { error: `Hay varios contactos que encajan: ${found.map((c) => `«${c.name}»`).join(', ')}. Pregúntale al usuario cuál.` };
}

async function find(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const contacts = await listContacts(user.id);
  if (args.mine) {
    const me = contacts.find((c) => c.self);
    return me ? { count: 1, items: [view(me)] } : { count: 0, note: 'El usuario todavía no ha marcado su propio número en Contactos. Pídeselo y guárdalo con save_contact (mine: true).' };
  }
  if (!String(args.query ?? '').trim()) return { count: contacts.length, items: contacts.slice(0, 20).map((c) => ({ name: c.name, phone: c.phone || null })) };
  const found = matchContacts(contacts, args.query, { limit: 5 });
  if (!found.length) return { count: 0, note: 'No hay nadie así en Contactos. Si es un cliente, pregunta el número y guárdalo con save_contact.' };
  return { count: found.length, items: found.map(view) };
}

async function save(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const given = { name: args.name, phone: args.phone, instagram: args.instagram, email: args.email, notes: args.notes };
  const contacts = await listContacts(user.id);
  // A save only updates the contact with exactly that name; "Ana" never overwrites "Ana Pérez".
  const existing = args.mine ? contacts.find((c) => c.self) : contacts.find((c) => sameName(c.name, args.name));
  if (args.mine && !String(args.phone ?? '').trim() && !existing?.phone) return { error: 'Dime el número del usuario para guardarlo como el suyo.' };
  // Only what he said replaces what is there; the rest stays.
  const merged = existing
    ? { ...{ name: existing.name, phone: existing.phone, instagram: existing.instagram, email: existing.email, notes: existing.notes }, ...Object.fromEntries(Object.entries(given).filter(([, v]) => String(v ?? '').trim())) }
    : given;
  const cleaned = cleanContact(merged);
  if (cleaned.error) return { error: cleaned.error };
  if (cleaned.fields.phone && !normalizePhone(cleaned.fields.phone)) return { error: 'No entendí ese número. Pídelo completo, con código de país (por ejemplo +1 809 555 1234).' };
  let item;
  if (existing) item = await updateContact(user.id, existing.id, cleaned.fields, args.mine ? { self: true } : {});
  else {
    if ((await countContacts(user.id)) >= MAX_CONTACTS) return { error: `Contactos está lleno (${MAX_CONTACTS}). Pídele al usuario que borre alguno.` };
    item = await createContact(user.id, cleaned.fields, { self: Boolean(args.mine) });
  }
  context.emit?.({ type: 'contact_saved', id: item.id, name: item.name });
  return {
    saved: true,
    created: !existing,
    contact: view(item),
    summary: `${existing ? 'Actualicé' : 'Guardé'} a ${clip(item.name, 60)} en Contactos`,
    note: 'Dilo en una frase corta. Si el número no tiene código de país, avisa que se asumió el de República Dominicana para 809, 829 y 849.',
  };
}

async function prepareForget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const picked = pick(await listContacts(user.id), args.name);
  if (picked.error) return { error: picked.error };
  const c = picked.contact;
  return {
    args: { id: c.id },
    preview: {
      title: 'Borrar un contacto',
      confirmLabel: 'Borrar',
      danger: true,
      fields: [
        { key: 'name', label: 'Quién', value: c.name },
        ...(c.phone ? [{ key: 'phone', label: 'Teléfono', value: c.phone }] : []),
      ],
    },
  };
}

async function forget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  return (await deleteContact(user.id, String(args.id || ''))) ? { deleted: true, summary: 'Borré el contacto' } : { error: 'Ese contacto ya no está.' };
}

// WhatsApp reuses the draft the chat and Telegram already know; SMS and Instagram have their own.
async function message(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const text = String(args.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'No hay mensaje que preparar: dime qué quieres decir.' };
  if (text.length > MAX_TEXT) return { error: `El mensaje es demasiado largo (${text.length} de ${MAX_TEXT} caracteres): acórtalo.` };
  const channel = String(args.channel || 'whatsapp').toLowerCase();
  if (!CHANNELS[channel]) return { error: 'Canal no válido: usa whatsapp, sms o instagram.' };
  const picked = pick(await listContacts(user.id), args.contact);
  if (picked.error) return { error: picked.error };
  const c = picked.contact;
  let url;
  if (channel === 'instagram') {
    if (!c.instagram) return { error: `${c.name} no tiene usuario de Instagram en Contactos. Pídeselo al usuario y guárdalo con save_contact.` };
    url = `https://ig.me/m/${encodeURIComponent(c.instagram)}`;
  } else {
    const phone = normalizePhone(c.phone);
    if (!phone) return { error: `${c.name} no tiene un teléfono válido en Contactos. Pídeselo al usuario y guárdalo con save_contact.` };
    url = channel === 'sms' ? `sms:+${phone}?&body=${encodeURIComponent(text)}` : whatsappUrl({ phone, text });
  }
  if (url.length > MAX_URL) return { error: 'El mensaje es demasiado largo para el enlace: acórtalo.' };
  context.emit?.(
    channel === 'whatsapp'
      ? { type: 'whatsapp_draft', phone: normalizePhone(c.phone), text, url, label: c.name }
      : { type: 'message_draft', channel, text, url, label: c.name, phone: normalizePhone(c.phone) || '' },
  );
  return {
    prepared: true,
    channel: CHANNELS[channel],
    to: c.name,
    summary: `Mensaje de ${CHANNELS[channel]} listo para ${clip(c.name, 60)}`,
    note: channel === 'instagram'
      ? 'El usuario ya ve el mensaje con un botón que copia el texto y abre el chat de Instagram: tendrá que pegarlo y enviarlo. Dilo en una frase; nunca digas que ya se envió. No repitas el texto completo.'
      : 'El usuario ya ve el mensaje con un botón que abre la aplicación con el texto escrito: solo debe pulsar enviar. Dilo en una frase; nunca digas que ya se envió. No repitas el texto completo.',
  };
}

export default {
  id: 'contacts',
  name: 'Contactos',
  description: 'Tu agenda dentro de Eddie: teléfonos, Instagram y notas de clientes y personas, y tu propio número. Eddie los consulta cuando hace falta y, al decirle «crea un mensaje para Ana», busca su número y te deja el mensaje listo en WhatsApp, SMS o Instagram: tú solo pulsas enviar.',
  icon: 'contacts',
  category: 'comunicacion',
  // Offered when the conversation is about someone's number or writing to someone.
  route: /contact|n[uú]mero|tel[eé]fono|celular|tel\b|llam[aá]|whats?\s?app|wasap|\bsms\b|instagram|\big\b|\bdm\b|m[aá]ndale|escr[ií]bele|resp[oó]ndele|cont[eé]stale|mensaje (para|a)|redacta(le)? (un )?mensaje|crea(le)? (un )?mensaje|agenda de|client/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Solo con sesión iniciada. Los contactos se ven y se editan en la pantalla Contactos (también se instala en el teléfono desde Configuración). Eddie nunca envía nada solo: prepara el mensaje y tú lo envías.',
  details: async (user) => ({ items: await countContacts(user.id) }),
  tools: [
    {
      label: 'Buscar en contactos',
      activity: 'Buscando en tus contactos…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result.count ? `${result.count} en contactos` : 'No está en contactos'),
      declaration: {
        name: 'find_contact',
        description:
          'Busca en los CONTACTOS del usuario (su agenda dentro de Eddie): teléfono, WhatsApp, Instagram, correo y notas de un cliente o persona. Úsala cuando pregunte por el número de alguien o antes de contestar sobre un cliente. Con mine=true devuelve el número del propio usuario. Sin query lista los primeros contactos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Nombre (o parte) de la persona o cliente.' },
            mine: { type: 'BOOLEAN', description: 'true para obtener el número del propio usuario.' },
          },
        },
      },
      run: (args, context) => find(args, context),
    },
    {
      label: 'Guardar un contacto',
      activity: 'Guardando el contacto…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'save_contact',
        description:
          'Guarda o actualiza un contacto en la agenda del usuario (Contactos). Úsala cuando te dé el número, Instagram o correo de alguien («guarda a Ana, su número es +1 809 555 1234») o cuando diga cuál es SU número (mine=true). Si ya existe, solo cambia lo que él diga. No inventes datos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nombre del contacto (obligatorio salvo con mine=true, que usa «Yo»).' },
            phone: { type: 'STRING', description: 'Teléfono con código de país, por ejemplo +1 809 555 1234.' },
            instagram: { type: 'STRING', description: 'Usuario de Instagram, con o sin @.' },
            email: { type: 'STRING', description: 'Correo electrónico.' },
            notes: { type: 'STRING', description: 'Nota corta (quién es, cómo se conocieron).' },
            mine: { type: 'BOOLEAN', description: 'true si este es el número del propio usuario (el que usarás para llamarlo).' },
          },
        },
      },
      run: (args, context) => save({ ...args, name: args.mine && !args.name ? 'Yo' : args.name }, context),
    },
    {
      label: 'Preparar un mensaje para un contacto',
      activity: 'Preparando el mensaje…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'prepare_message',
        description:
          'Deja LISTO un mensaje para una persona de Contactos: busca su número (o su Instagram) y le da al usuario un botón que abre WhatsApp, SMS o el chat de Instagram con el texto ya escrito; NUNCA se envía solo, él pulsa enviar. Úsala con «crea un mensaje para Ana», «mándale a Luis por WhatsApp», «escríbele por Instagram a…». Redacta el texto completo y listo, en el tono de sus preferencias. Canal por defecto: whatsapp. Para varias opciones de texto, llámala una vez por opción (máximo 3).',
        parameters: {
          type: 'OBJECT',
          properties: {
            contact: { type: 'STRING', description: 'Nombre de la persona en Contactos.' },
            text: { type: 'STRING', description: 'El mensaje completo y listo para enviar (máx. 1000 caracteres).' },
            channel: { type: 'STRING', enum: ['whatsapp', 'sms', 'instagram'], description: 'Por dónde enviarlo. Si no lo dice, whatsapp.' },
          },
          required: ['contact', 'text'],
        },
      },
      run: (args, context) => message(args, context),
    },
    {
      label: 'Borrar un contacto',
      activity: 'Preparando la confirmación…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'forget_contact',
        description: 'Borra un contacto de la agenda del usuario. Siempre pide confirmación con una tarjeta; tú solo la propones.',
        parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Nombre (o parte) del contacto a borrar.' } }, required: ['name'] },
      },
      prepare: (args, context) => prepareForget(args, context),
      run: (args, context) => forget(args, context),
    },
  ],
  webhook: null,
};
