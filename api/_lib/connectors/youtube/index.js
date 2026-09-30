// Opens YouTube in the user's browser: the home page, a search ("ponme
// música de Shakira" opens the results for it) or a YouTube link they gave.
// The tool writes nothing and calls no API: it emits an `open_url` action
// that the app carries out in the browser (see applyBrowserActions), or that
// the Telegram bot sends as a link. Only YouTube addresses are ever built or
// accepted, so the model can't be talked into opening something else.

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const MAX_QUERY = 200;

// A clean https YouTube address, or null. Credentials, fragments and other
// hosts (youtube.com.evil.com, javascript:, data:…) are refused.
export function safeYoutubeUrl(value) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!HOSTS.has(u.hostname.toLowerCase())) return null;
  u.protocol = 'https:';
  u.username = '';
  u.password = '';
  u.port = '';
  u.hash = '';
  return u.toString();
}

export function searchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function openYoutube(args, context) {
  const link = String(args.url || '').trim();
  if (link) {
    const url = safeYoutubeUrl(link);
    if (!url) return { error: 'Solo puedo abrir direcciones de YouTube (youtube.com, music.youtube.com o youtu.be).' };
    context.emit?.({ type: 'open_url', url, label: 'YouTube' });
    return { opened: true, url, summary: 'Abrí el enlace de YouTube.' };
  }
  // eslint-disable-next-line no-control-regex
  const query = String(args.query || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  if (!query) {
    context.emit?.({ type: 'open_url', url: 'https://www.youtube.com/', label: 'YouTube' });
    return { opened: true, url: 'https://www.youtube.com/', summary: 'Abrí YouTube.' };
  }
  const url = searchUrl(query);
  context.emit?.({ type: 'open_url', url, label: `YouTube: ${query}` });
  return {
    opened: true,
    url,
    summary: `Abrí YouTube con la búsqueda "${query}".`,
    note: 'Se abre la lista de resultados para que el usuario elija el video; no puedes elegir ni reproducir uno tú mismo. Si su navegador bloquea la ventana, verá un botón para abrirla.',
  };
}

export default {
  id: 'youtube',
  name: 'YouTube',
  description: 'Eddie abre YouTube en tu navegador, o busca ahí lo que le digas ("ponme música de…", "busca un tutorial de…").',
  icon: 'play',
  category: 'multimedia',
  // Offered to the model only when the conversation touches the topic.
  route: /youtube|you tube|\byt\b|v[ií]deos?|canci[oó]n|canciones|m[uú]sica|tutorial|tr[aá]iler|trailer|videoclip|reproduc|escuchar/i,
  auth: null,
  requiredEnv: [],
  note: 'Abre una pestaña nueva; si tu navegador la bloquea, Eddie deja un botón para abrirla (o permite las ventanas emergentes de este sitio). Elegir el video lo haces tú en la lista.',
  tools: [
    {
      label: 'Abrir YouTube o buscar en él',
      activity: 'Abriendo YouTube…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'open_youtube',
        description:
          'Abre YouTube en el navegador del usuario: la página principal (sin argumentos), una búsqueda (query) o un enlace de YouTube que te dio (url). Úsala cuando pida abrir YouTube o poner/buscar un video, canción o tutorial; abre la lista de resultados, no reproduce un video concreto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Qué buscar en YouTube, en pocas palabras (p. ej. "canciones de salsa", "tutorial de React").' },
            url: { type: 'STRING', description: 'Un enlace de youtube.com, music.youtube.com o youtu.be que el usuario dio, para abrirlo tal cual.' },
          },
        },
      },
      run: (args, context) => openYoutube(args, context),
    },
  ],
  webhook: null,
};
