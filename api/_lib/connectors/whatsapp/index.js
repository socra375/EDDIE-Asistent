// WhatsApp the safe way: Eddie writes the message and gives the user a wa.me link.
// Opening it starts WhatsApp with the contact and the text already filled in; the
// user only has to press send. Nothing is ever sent from here, no account is
// linked, no key is needed and it costs nothing (it is just a web address).
//
// What it cannot do: read the user's chats. To answer a message, the user pastes
// the text or a screenshot into the chat and Eddie writes the reply options.
import { clip } from '../http.js';

const MAX_TEXT = 1000; // characters of the message (a link that is too long stops working)
const MAX_URL = 3500;
const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164

// Dominican Republic area codes (the user's own country: 10 digits that start with these are +1 numbers).
const DR_AREA = /^(809|829|849)\d{7}$/;

// "+1 (809) 555-1234", "00 34 600 000 000", "8095551234" → digits with the country code, or null.
export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  const explicit = digits.startsWith('+') || digits.startsWith('00');
  digits = digits.replace(/^\+/, '').replace(/\+/g, '').replace(/^00/, '');
  if (!explicit && DR_AREA.test(digits)) digits = `1${digits}`;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS || digits.startsWith('0')) return null;
  return digits;
}

// Only a plain wa.me address may become a button (Telegram and the app both check this).
export function safeWhatsappUrl(value) {
  const url = String(value || '');
  return /^https:\/\/wa\.me\/(\d{8,15})?\?text=[^\s]+$/.test(url) && url.length <= MAX_URL ? url : null;
}

export function whatsappUrl({ phone, text }) {
  const query = `text=${encodeURIComponent(text)}`;
  return phone ? `https://wa.me/${phone}?${query}` : `https://wa.me/?${query}`;
}

function prepare(args) {
  const text = String(args.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'No hay mensaje que preparar: dime qué quieres decir.' };
  if (text.length > MAX_TEXT) return { error: `El mensaje es demasiado largo para un enlace de WhatsApp (${text.length} de ${MAX_TEXT} caracteres): acórtalo o divídelo en dos.` };
  let phone = null;
  if (String(args.phone ?? '').trim()) {
    phone = normalizePhone(args.phone);
    if (!phone) return { error: 'No entendí ese número. Dame el número completo con el código del país (por ejemplo +1 809 555 1234 o +34 600 000 000).' };
  }
  const url = whatsappUrl({ phone, text });
  if (url.length > MAX_URL) return { error: 'El mensaje es demasiado largo para un enlace de WhatsApp: acórtalo.' };
  return { phone, text, url, label: clip(args.contact || '', 60) };
}

export default {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Eddie te redacta el mensaje y te lo deja listo en WhatsApp: un botón abre el chat con el texto escrito y tú solo pulsas enviar. También te propone qué responder a un mensaje si lo pegas o mandas una captura. No lee tus chats ni envía nada solo.',
  icon: 'send',
  category: 'comunicacion',
  // Offered when the conversation is about messaging someone.
  route: /whats?\s?app|wasap|guasap|\bwa\.me|m[aá]ndale|escr[ií]bele|resp[oó]ndele|cont[eé]stale|resp[oó]nd(e|er)\s+(a\s+)?(este|ese|el|ella|[eé]l)?\s*mensaje|redacta(le)? (un )?mensaje|mensaje (para|a) /i,
  auth: null,
  requiredEnv: [],
  note: 'Sin claves ni cuentas ni coste: usa enlaces wa.me. El mensaje nunca se envía solo; WhatsApp se abre con el texto listo y tú pulsas enviar. Para escribirle a un contacto por su nombre, Eddie busca su número en tu memoria (guárdalo con «recuerda que el número de Ana es +1 809 …»).',
  tools: [
    {
      label: 'Preparar un mensaje de WhatsApp',
      activity: 'Preparando el mensaje…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'prepare_whatsapp',
        description:
          'Deja LISTO un mensaje de WhatsApp: el usuario verá el texto y un botón que abre WhatsApp con el chat y el mensaje ya escritos; NUNCA se envía solo, él pulsa enviar. Úsala cuando pida «mándale un WhatsApp a…», «escríbele a… por WhatsApp», «responde a este mensaje». Redacta el texto completo, en el tono de sus preferencias, listo para enviar. Si nombra a un contacto, busca su número en la memoria (recall); si no lo tienes, pide el número con código de país o prepáralo sin número (WhatsApp deja elegir el contacto). Para dar varias opciones de respuesta, llámala una vez por opción (máximo 3).',
        parameters: {
          type: 'OBJECT',
          properties: {
            text: { type: 'STRING', description: 'El mensaje, completo y listo para enviar (máx. 1000 caracteres).' },
            phone: { type: 'STRING', description: 'Número del destinatario con código de país, por ejemplo +1 809 555 1234. Opcional: sin él, WhatsApp deja elegir el contacto.' },
            contact: { type: 'STRING', description: 'Nombre de la persona, solo para rotular el botón (opcional).' },
          },
          required: ['text'],
        },
      },
      run: (args, context) => {
        const draft = prepare(args);
        if (draft.error) return draft;
        context.emit?.({ type: 'whatsapp_draft', phone: draft.phone, text: draft.text, url: draft.url, label: draft.label });
        const who = draft.label ? ` para ${draft.label}` : draft.phone ? ` para +${draft.phone}` : '';
        return {
          prepared: true,
          has_number: Boolean(draft.phone),
          summary: `Mensaje de WhatsApp listo${who}`,
          note: 'El usuario ya ve el mensaje con un botón «Abrir en WhatsApp» (y en Telegram, con un botón que lo abre); tú no ves WhatsApp. Dile en una frase que está listo y que solo debe pulsar enviar en WhatsApp; nunca digas que ya se envió. No repitas el texto completo en tu respuesta.',
        };
      },
    },
  ],
};
