// What the user can say during a call, handled by Eddie himself (no AI needed to
// understand it): «cuelga», «toma nota de…», «responde esta llamada del cliente con
// los datos» and, to go back to talking himself, «ya está». Pure helpers.
import { core, parseNotesCommand } from './commands.js';
import { DEFAULT_WAKE_WORD, wakePhrases } from './wakeWord.js';

const HANGUP = /^(?:cuelga|cuelgo|colgar|cuelga la llamada|colgar la llamada|termina la llamada|terminar la llamada|finaliza la llamada|finalizar la llamada|fin de la llamada|adios|hasta luego|chao|chau)$/;
const ANSWER_CLIENT = /^(?:responde|responder|respondele|contesta|contestar|contestale|atiende|atender|atiendele)(?: esta| la| mi)?(?: llamada)?(?: (?:del|de el|a este|al|a) cliente)?(?: de este cliente)?(?: con (?:los |mis |tus )?datos| con la informacion| con la info)?$/;
const ANSWER_CLIENT_HINT = /llamada|cliente/;
const BACK_TO_ME = /^(?:ya|listo|ya esta|ya estuvo|fin|ya termine|yo sigo|sigo yo|vuelvo yo|deja de responder|deja de contestar|termina la respuesta|termina de responder|gracias eddie)$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Toma nota de comprar tinta" → "comprar tinta" (the note keeps what was said, accents and all).
function noteText(text, word) {
  const names = [...new Set([...wakePhrases(word || DEFAULT_WAKE_WORD), ...wakePhrases(DEFAULT_WAKE_WORD)])].map((p) => escapeRe(p).replace(/ /g, '\\s+'));
  const lead = `^\\s*(?:(?:hey|oye|ey|hola|ok|okay)[,\\s]+)?(?:(?:${names.join('|')})[,\\s]+)?(?:por\\s+favor[,\\s]+)?`;
  const tail = '(.{2,}?)(?:[,\\s]+por\\s+favor)?[\\s.!?¡¿]*$';
  const forms = [
    `(?:toma(?:me)?|anota(?:me)?|apunta(?:me)?|guarda(?:me)?)\\s+(?:una\\s+)?notas?[:,\\s]+(?:(?:de|que|sobre|acerca\\s+de)\\s+)?${tail}`,
    `(?:anota(?:me)?|apunta(?:me)?)[:,\\s]+(?:que\\s+)?${tail}`,
  ];
  for (const form of forms) {
    const m = new RegExp(`${lead}${form}`, 'i').exec(String(text || ''));
    const body = m?.[1]?.trim();
    if (body && body.length >= 2) return body;
  }
  return null;
}

// { action: 'hangup' } | { action: 'note', text } | { action: 'answer' } | { action: 'back' } | null
export function parseCallCommand(text, word) {
  const t = core(text, word);
  if (!t) return null;
  if (HANGUP.test(t)) return { action: 'hangup' };
  // «Toma notas durante 10 minutos» is the dictation command: the chat handles it.
  if (parseNotesCommand(text, word)) return null;
  const note = noteText(text, word);
  if (note) return { action: 'note', text: note };
  if (ANSWER_CLIENT.test(t) && ANSWER_CLIENT_HINT.test(t)) return { action: 'answer' };
  if (BACK_TO_ME.test(t)) return { action: 'back' };
  return null;
}

// What goes to the AI when Eddie is answering for the user: the client's words plus the rules for the answer.
export const clientPrompt = (said) =>
  `Estás atendiendo por teléfono, en voz alta, a un cliente del usuario. El cliente acaba de decir: «${said}». Contéstale tú directamente, en 1 o 2 frases habladas, SOLO con datos que encuentres: busca primero en contactos (find_contact), negocios (recall_business), segundo cerebro (search_knowledge) y memoria (recall). No inventes precios, fechas ni promesas. Si no tienes el dato, dile que lo confirmas y que se lo hace llegar el usuario.`;
