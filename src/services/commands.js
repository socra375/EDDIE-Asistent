// Spoken/typed commands Eddie handles by himself, without asking an AI:
// "Modo Vigilancia" turns the camera analysis on and off, "¿qué ves?"
// asks about the camera while it is on, "Activa sistema" / "Desactiva
// sistema" show and hide the info panels and "Dame los datos de hoy" shows
// them one by one while Eddie reads the day out. Pure helpers (no browser APIs).
// Only a whole message counts, so talking *about* surveillance ("me gusta la
// vigilancia", "vigilancia del barrio") does nothing. The wake word (or
// "Eddie") may come first, "por favor" / "ya" last.
import { DEFAULT_WAKE_WORD, wakePhrases } from './wakeWord.js';
import { parseDuration } from './dictation.js';

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

// The info panels (clima, tareas, sistema, tiempo activo) are off the home
// screen until asked for.
const HUD_THING = '(?:el |los |la |las |mi |mis |tu |tus )?(?:sistemas?|panel(?:es)?|interfaz|hud)(?: lateral(?:es)?| de informacion)?';
const HUD_SHOW = new RegExp(`^(?:activa|activar|activame|active|enciende|encender|prende|prender|muestra|mostrar|muestrame|ensename|abre|abrir|pon|poner|despliega|desplegar) ${HUD_THING}$`);
const HUD_HIDE = new RegExp(`^(?:desactiva|desactivar|desactivame|desactive|apaga|apagar|apagame|oculta|ocultar|ocultame|esconde|esconder|quita|quitar|cierra|cerrar|retira|retirar|guarda|guardar) ${HUD_THING}$`);
const HUD_TODAY = /^(?:(?:dame|dime|muestrame|ensename|quiero ver|quiero saber|ver|pasame) )?(?:los |mis |el )?(?:datos|resumen|informacion|estado)(?: de| del| para)? (?:hoy|dia|el dia)$/;

// 'show' | 'hide' | 'today' | null
export function parseHudCommand(text, word) {
  const t = core(text, word);
  if (!t) return null;
  if (HUD_TODAY.test(t)) return 'today';
  if (HUD_SHOW.test(t)) return 'show';
  if (HUD_HIDE.test(t)) return 'hide';
  return null;
}

// ---- Notas ----------------------------------------------------------------
// "Toma notas durante 10 minutos", "termina la nota", "abre mis notas". Only
// whole messages: "toma nota de que mañana tengo examen" is not a command.
const NOTE_THING = '(?:una |unas |la |las |mis |mi |el |un )?(?:notas?|apuntes|dictado)(?: de voz| nuevas?)?';
const NOTES_START = new RegExp(
  `^(?:(?:toma|tomar|tomame|apunta|apuntame|anota|anotame|dicta|dictame|empieza a tomar|comienza a tomar|empieza a apuntar|comienza a apuntar|quiero tomar|voy a tomar|vamos a tomar|necesito tomar|haz|hazme|crea|crear|ponme|inicia|iniciar) ${NOTE_THING}|nueva nota|(?:(?:activa|activar|enciende|encender|inicia|iniciar|entra en|entrar en|pon|poner) (?:el )?)?modo (?:de )?(?:notas?|dictado)|voy a dictar(?:te)?)(?: (.+))?$`,
);
const NOTES_STOP =
  /^(?:(?:termina|terminar|finaliza|finalizar|deten|detener|cierra|cerrar|para|parar|cancela|cancelar) (?:de tomar |la |las |el |mi |mis )?(?:notas?|dictado|apuntes)|deja de tomar notas?|dejar de tomar notas?|ya no tomes notas?|fin de(?:l)? (?:la |el )?(?:nota|dictado|notas))$/;
const NOTES_OPEN = /^(?:abre|abrir|muestra|mostrar|muestrame|ensename|ve a|ir a|quiero ver|ver) (?:mis |las |la |mi )?(?:notas?|libreta|hoja de notas)$/;
const TAIL = /^(?:(?:durante|por|de|con|que dure|que duren|con una duracion de|de duracion|por un tiempo de|por espacio de|por unos) )?(.+)$/;

// { action: 'start', minutes: number | null } | { action: 'stop' } | { action: 'open' } | null
export function parseNotesCommand(text, word) {
  const t = core(text, word);
  if (!t) return null;
  if (NOTES_STOP.test(t)) return { action: 'stop' };
  if (NOTES_OPEN.test(t)) return { action: 'open' };
  const m = NOTES_START.exec(t);
  if (!m) return null;
  if (!m[1]) return { action: 'start', minutes: null };
  const minutes = parseDuration(TAIL.exec(m[1])[1]);
  return minutes === null ? null : { action: 'start', minutes };
}

// "Investiga y aprende X": the second brain's command. Returns the topic (as
// said, accents and all) or null. Only a whole message counts, so talking
// about learning ("quiero aprender inglés", "aprende rápido") does nothing.
const LEARN_VERB = '(?:investig[aá]r?|averigu[aá]|estudi[aá])\\s+y\\s+aprend[eé](?:me)?';
const LEARN_ABOUT = '(?:todo\\s+)?(?:sobre|acerca\\s+de)';
export function parseLearnCommand(text, word) {
  const names = [...new Set([...wakePhrases(word || DEFAULT_WAKE_WORD), ...wakePhrases(DEFAULT_WAKE_WORD)])].map((p) => escapeRe(p).replace(/ /g, '\\s+'));
  const lead = `^\\s*(?:(?:${FILLERS.join('|')})[,\\s]+)?(?:(?:${names.join('|')})[,\\s]+)?(?:por\\s+favor[,\\s]+)?`;
  const tail = '(.{2,}?)(?:[,\\s]+por\\s+favor)?[\\s.!?¡¿]*$';
  const forms = [`${LEARN_VERB}\\s+(?:(?:${LEARN_ABOUT}|de(?:l)?|a)\\s+)?`, `aprend[eé]\\s+${LEARN_ABOUT}\\s+`];
  for (const form of forms) {
    const m = new RegExp(`${lead}${form}${tail}`, 'i').exec(String(text || ''));
    const topic = m?.[1]?.trim();
    if (topic && topic.length >= 2) return topic;
  }
  return null;
}
