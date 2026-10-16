// Eddie keeps you company while a long request runs: a joke, a fact, a tip — about what he is doing when there is a line for
// it — so you are never left staring at "trabajando…". The lines are written here (no AI call: it must work when the providers
// are the slow part, cost nothing, and can be tested). Pure: no browser APIs.
//
// Rhythm: the first line after FIRST_MS of waiting, then one every EVERY_MS (a little longer each time), at most MAX_LINES per
// request; the next one waits for the last to be read (see AutoReadBridge). A turn alternates: a line about what he is
// doing (when there is one), then a joke, a fact or a tip in turn. A line is never repeated within a request.
export const FIRST_MS = 7000;
export const EVERY_MS = 13000;
export const MAX_LINES = 8;

export const JOKES = [
  '¿Por qué los programadores confunden Halloween con Navidad? Porque 31 de octubre es igual a 25 de diciembre.',
  'Un SQL entra en un bar, ve dos mesas y pregunta: ¿puedo unirme?',
  '¿Cómo se despiden los químicos? Ácido un placer.',
  '¿Qué hace una abeja en el gimnasio? Zum-ba.',
  '¿Por qué estaba triste el libro de matemáticas? Porque tenía muchos problemas.',
  '¿Cuál es el café más peligroso del mundo? El ex-preso.',
  'Yo no procrastino: hago trabajo en segundo plano, como ahora mismo.',
  'Dicen que el tiempo es dinero. Entonces las reuniones largas son una quiebra.',
  '¿Qué le dice un bit a otro? Nos vemos en el bus.',
  'El mayor cementerio de ideas se llama «lo haré mañana».',
];

export const FACTS = [
  'Dato: la miel casi no se echa a perder; se han encontrado tarros de miles de años todavía comestibles.',
  'Dato: los pulpos tienen tres corazones.',
  'Dato: en Venus un día dura más que su año.',
  'Dato: el primer «bug» fue una polilla real atrapada en un relé de la computadora Harvard Mark II, en 1947.',
  'Dato: botánicamente, el plátano es una baya y la fresa no.',
  'Dato: las nutrias de mar se agarran de las patas al dormir para no separarse.',
  'Dato: un rayo puede ser unas cinco veces más caliente que la superficie del Sol.',
  'Dato: la Torre Eiffel crece hasta unos 15 centímetros en verano por la dilatación del hierro.',
  'Dato: el cerebro adulto pesa cerca de 1,4 kilos y gasta alrededor del 20 % de la energía del cuerpo.',
  'Dato: la Gran Mancha Roja de Júpiter es una tormenta más grande que la Tierra y lleva siglos activa.',
  'Dato: los koalas tienen huellas dactilares casi idénticas a las humanas.',
  'Dato: el sonido viaja más de cuatro veces más rápido en el agua que en el aire.',
];

export const TIPS = [
  'Consejo: la regla 20-20-20: cada 20 minutos mira algo a unos 6 metros durante 20 segundos para descansar la vista.',
  'Consejo: aprovecha y toma un vaso de agua mientras yo trabajo.',
  'Consejo: estira el cuello y los hombros un momento. Yo sigo con lo mío.',
  'Consejo: si algo te importa, ponle fecha; sin fecha es solo una intención.',
  'Consejo: guarda lo importante en dos sitios, aunque uno sea la nube.',
  'Consejo: una tarea difícil se vuelve fácil si la partes en pasos de diez minutos.',
  'Consejo: dormir bien rinde más que una hora extra de estudio.',
  'Consejo: respira hondo tres veces; sirve más de lo que parece.',
  'Consejo: apunta lo primero que harás mañana y arrancarás sin pensar.',
  'Consejo: revisa dos veces los números importantes antes de enviarlos.',
];

// Lines about what he is doing right now, by the words in the activity / the step labels.
export const TOPICAL = [
  { topic: 'busqueda', match: /busc|internet|web|investig|noticia|wikipedia/i, lines: ['Mientras busco: cruzo varias fuentes antes de fiarme de un dato, sobre todo si es un número.', 'Si un dato parece demasiado bueno para ser cierto, lo compruebo dos veces.'] },
  { topic: 'correo', match: /correo|gmail|mail|bandeja/i, lines: ['Tip de correo: un asunto claro vale más que un párrafo largo.', 'Tip de correo: si puedes responder en dos minutos, hazlo ya y quítatelo de encima.'] },
  { topic: 'agenda', match: /agenda|calendar|evento|reuni|cita/i, lines: ['Tip de agenda: bloquea una hora al día sin reuniones para concentrarte.', 'Tip de agenda: pon un recordatorio antes de las citas importantes, no solo a la hora.'] },
  { topic: 'documentos', match: /document|hoja|drive|archivo|presentaci|slides|docs/i, lines: ['Tip: ponle la fecha al nombre de tus archivos (2026-10-16) y siempre sabrás cuál es el último.', 'Tip: un documento corto y claro se lee; uno largo se guarda.'] },
  { topic: 'video', match: /video|ffmpeg|reel|editando|editar/i, lines: ['Tip de video: los primeros tres segundos deciden si alguien se queda mirando.', 'Tip de video: el sonido limpio importa más que la imagen perfecta.'] },
  { topic: 'tareas', match: /tarea|recordatorio|rutina/i, lines: ['Tip: tres tareas importantes al día rinden más que treinta pendientes.'] },
  { topic: 'codigo', match: /github|c[oó]digo|repositorio|commit/i, lines: ['Tip de código: commits pequeños y frecuentes te salvan cuando algo se rompe.'] },
  { topic: 'cuentas', match: /cuenta|gasto|ingreso|cobro|pago|factura|libro/i, lines: ['Tip de cuentas: anota cada gasto el mismo día; a la semana ya nadie se acuerda.'] },
  { topic: 'clima', match: /clima|lluvia|temperatura/i, lines: ['Dato: la humedad hace que el calor se sienta más fuerte de lo que marca el termómetro.'] },
  { topic: 'musica', match: /m[uú]sica|youtube|canci/i, lines: ['Tip: la música sin letra ayuda a concentrarse cuando estudias.'] },
  { topic: 'navegador', match: /navegador|p[aá]gina|formulario|plataforma/i, lines: ['Mientras trabajo en la página puedes seguir con lo tuyo; te aviso cuando termine.'] },
  { topic: 'mensajes', match: /whatsapp|telegram|mensaje|contacto/i, lines: ['Tip: antes de enviar un mensaje importante, léelo en voz alta; encuentras los errores.'] },
  { topic: 'memoria', match: /memoria|recuerd|nota/i, lines: ['Yo también tomo nota de lo importante para no preguntarte lo mismo dos veces.'] },
];

const ROTATION = [['broma', JOKES], ['dato', FACTS], ['consejo', TIPS]];
export const ALL_LINES = [...JOKES, ...FACTS, ...TIPS, ...TOPICAL.flatMap((t) => t.lines)];

// How long to wait before line number `count` (0 = the first).
export const delayFor = (count) => (count === 0 ? FIRST_MS : EVERY_MS + Math.min(count, 4) * 2000);

// The line to say now, or null when there is nothing left. `used` is the set of lines already said in this request;
// `count` how many have been said. `context` is the text of what he is doing (activity and step labels).
export function pickLine({ context = '', used = new Set(), count = 0, rand = Math.random } = {}) {
  const pick = (list) => {
    const fresh = list.filter((line) => !used.has(line));
    return fresh.length ? fresh[Math.floor(rand() * fresh.length) % fresh.length] : null;
  };
  const text = String(context || '');
  // Even turns: about what he is doing, if he has something for it.
  if (count % 2 === 0 && text) {
    const topical = pick(TOPICAL.filter((t) => t.match.test(text)).flatMap((t) => t.lines));
    if (topical) return { text: topical, kind: 'tema' };
  }
  for (let i = 0; i < ROTATION.length; i += 1) {
    const [kind, list] = ROTATION[(count + i) % ROTATION.length];
    const line = pick(list);
    if (line) return { text: line, kind };
  }
  return null;
}
