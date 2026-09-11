// Eddie's own "memory": small talk and self-referential trivia (how are
// you, what day/time is it, who are you) that Eddie answers by itself,
// instantly and without ever contacting Gemini/Claude. This means these
// never fail if the AI provider is down, rate-limited, or returns an empty
// response, and never spend AI quota on questions that don't need one.
// Only applies when Eddie is speaking Spanish — for any other language we
// let the AI provider answer, so nothing here forces a Spanish reply into
// a conversation happening in another language.

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .trim();
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const GREETING_RESPONSES = [
  '¡Muy bien, gracias por preguntar! ¿Y tú, cómo estás?',
  'Todo en orden por aquí, listo para ayudarte. ¿Cómo vas tú?',
  '¡Genial! Con energía para echarte una mano hoy. ¿Cómo estás tú?',
];

const IDENTITY_RESPONSES = [
  'Soy Eddie, tu asistente virtual. Estoy aquí para ayudarte con tus estudios, tareas y proyectos.',
];

const THANKS_RESPONSES = ['¡De nada! Aquí estoy si necesitas algo más.', 'Con gusto, para eso estoy.'];

function formatDate(timezone) {
  return new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: timezone }).format(new Date());
}

function formatTime(timezone) {
  return new Intl.DateTimeFormat('es', { timeStyle: 'short', timeZone: timezone }).format(new Date());
}

const RULES = [
  { pattern: /^(hola[, ]*)?(como estas|como te va|como andas|que tal estas|que tal)$/, respond: () => pick(GREETING_RESPONSES) },
  {
    pattern: /^(que dia es hoy|que dia es|que fecha es hoy|que fecha es|en que fecha estamos|a que dia estamos)$/,
    respond: ({ timezone }) => `Hoy es ${formatDate(timezone)}.`,
  },
  {
    pattern: /^(que hora es|me dices la hora|dime la hora|tienes la hora|sabes que hora es)$/,
    respond: ({ timezone }) => `Son las ${formatTime(timezone)}.`,
  },
  { pattern: /^(quien eres|que eres|como te llamas|cual es tu nombre)$/, respond: () => pick(IDENTITY_RESPONSES) },
  { pattern: /^(gracias|muchas gracias|te lo agradezco)$/, respond: () => pick(THANKS_RESPONSES) },
];

// Returns a canned answer string, or null when the message isn't one of
// these known small-talk/trivia patterns — the caller should fall back to
// the AI provider in that case.
export function getLocalAnswer(text, { timezone = 'UTC', language = 'es' } = {}) {
  if (language !== 'es') return null;
  const normalized = normalize(text);
  const rule = RULES.find((r) => r.pattern.test(normalized));
  return rule ? rule.respond({ timezone }) : null;
}
