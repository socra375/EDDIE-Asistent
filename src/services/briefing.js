// "Dame los datos de hoy": what Eddie says, piece by piece, and which panel
// goes with each piece. Pure (no browser APIs) so it can be tested in Node;
// the texts are written to be heard (no symbols), see speakableText.

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function spokenTime(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const h12 = h % 12 || 12;
  const part = h < 6 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
  const hour = `${h12 === 1 ? 'la' : 'las'} ${h12}`;
  return m === 0 ? `${hour} en punto ${part}` : `${hour} y ${m} ${part}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function weatherPiece(weather, place) {
  if (!weather) return 'Todavía no tengo el clima. Activa la ubicación del navegador y vuelve a pedírmelo.';
  const where = place ? `En ${place}` : 'Afuera';
  return `${where} hay ${weather.temperature} grados, ${String(weather.condition).toLowerCase()}, con ${weather.humidity} por ciento de humedad y viento de ${weather.wind} kilómetros por hora.`;
}

const RANK = { alta: 3, media: 2, baja: 1 };

function tasksPiece(tasks) {
  const pending = tasks.filter((t) => !t.done).sort((a, b) => (RANK[b.priority] || 0) - (RANK[a.priority] || 0));
  if (tasks.length === 0) return 'No tienes tareas registradas.';
  if (pending.length === 0) return 'Todas tus tareas están al día.';
  const high = pending.filter((t) => t.priority === 'alta').length;
  const top = pending.slice(0, 2).map((t) => t.title).join(' y ');
  return `Tienes ${plural(pending.length, 'tarea pendiente', 'tareas pendientes')}${high ? `, ${high} de prioridad alta` : ''}. Lo primero: ${top}.`;
}

function systemPiece(system) {
  const parts = [];
  if (system.battery) parts.push(`la batería está al ${system.battery.level} por ciento${system.battery.charging ? ' y se está cargando' : ''}`);
  parts.push(system.online === false ? 'no hay conexión a internet' : 'la conexión a internet funciona');
  if (system.cores) parts.push(`el equipo tiene ${system.cores} núcleos`);
  const text = parts.join(', ');
  return `En tu equipo ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

function uptimePiece(session) {
  const minutes = Math.max(0, Math.round((session.seconds || 0) / 60));
  const commands = session.commands || 0;
  return `Llevamos ${minutes < 1 ? 'menos de un minuto' : plural(minutes, 'minuto', 'minutos')} de sesión y ${plural(commands, 'comando', 'comandos')}.`;
}

// → [{ panel: 'weather' | 'tasks' | 'system' | 'uptime' | null, text }]
export function buildBriefing({ now = new Date(), weather = null, place = '', tasks = [], system = {}, session = {} } = {}) {
  return [
    { panel: null, text: `Claro. Hoy es ${WEEKDAYS[now.getDay()]} ${now.getDate()} de ${MONTHS[now.getMonth()]}, y son ${spokenTime(now)}.` },
    { panel: 'weather', text: weatherPiece(weather, place) },
    { panel: 'tasks', text: tasksPiece(tasks) },
    { panel: 'system', text: systemPiece(system) },
    { panel: 'uptime', text: uptimePiece(session) },
    { panel: null, text: 'Eso es todo por ahora.' },
  ];
}
