// Spoken/typed commands Eddie handles by himself, without asking an AI:
// "Modo Vigilancia" turns the camera analysis on and off, and "¿qué ves?"
// asks about the camera while it is on. Pure helpers (no browser APIs).
// Only a whole message counts, so talking *about* surveillance ("me gusta la
// vigilancia", "vigilancia del barrio") does nothing. The wake word (or
// "Eddie") may come first, "por favor" / "ya" last.
import { DEFAULT_WAKE_WORD, wakePhrases } from './wakeWord.js';

const FILLERS = ['hey', 'oye', 'ey', 'hola', 'ok', 'okay', 'okey'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lower case, no accents, only letters/numbers/spaces; the wake word and the
// polite words around the command removed.
function core(text, word = DEFAULT_WAKE_WORD) {
  let t = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  const names = [...new Set([...wakePhrases(word), ...wakePhrases(DEFAULT_WAKE_WORD)])].map((p) => escapeRe(p).replace(/ /g, '\\s+'));
  const name = `(?:${names.join('|')})`;
  t = t
    .replace(new RegExp(`^(?:(?:${FILLERS.join('|')}) )?(?:${name} )?`), '')
    .replace(new RegExp(`(?: ${name})?(?: (?:por favor|ya|ahora|gracias))*$`), '')
    .trim();
  return t;
}

const ON_VERBS = 'activa|activar|activame|enciende|encender|inicia|iniciar|pon|poner|empieza|comienza|entra en|entrar en';
const OFF_VERBS = 'desactiva|desactivar|apaga|apagar|termina|terminar|deten|detener|para|parar|cancela|cancelar|finaliza|finalizar|quita|quitar';
const VIGILANCE_ON = new RegExp(`^(?:(?:${ON_VERBS}) (?:el |la )?(?:modo )?|modo )vigilancia$`);
const VIGILANCE_OFF = new RegExp(`^(?:(?:${OFF_VERBS}) (?:el |la |del |de la |de )?(?:modo )?vigilancia|sal(?:ir)? (?:del |de la |de )?(?:modo )?vigilancia|modo normal)$`);

// 'on' | 'off' | null
export function parseVigilanceCommand(text, word) {
  const t = core(text, word);
  if (!t) return null;
  if (VIGILANCE_ON.test(t)) return 'on';
  if (VIGILANCE_OFF.test(t)) return 'off';
  return null;
}

const SEE_QUESTION = /^(?:(?:y )?(?:que|qué) (?:ves|estas viendo|observas|detectas|hay en la camara|hay frente a mi|hay delante de mi|hay ahi|ve la camara|ves en la camara|ves ahi|ves ahora)|describe lo que ves|dime lo que ves|dime que ves|mira(?: y dime que ves)?|que hay)$/;

// "¿Qué ves?" and its everyday variants (whole message).
export function isSeeQuestion(text, word) {
  return SEE_QUESTION.test(core(text, word));
}
