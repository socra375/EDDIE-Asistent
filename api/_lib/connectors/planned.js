// Connectors coming in later sessions of the Eddie 2.0 plan (see
// docs/eddie-2-arquitectura.md). Metadata only, for the hub: once one is
// built it moves to its own folder with real tools and leaves this list.
// `due` is the latest planned date; work running ahead can land sooner.
export const PLANNED_CONNECTORS = [
  { id: 'gmail', name: 'Gmail', icon: 'mail', description: 'Buscar, leer y resumir tus correos, y enviarlos con tu confirmación.', session: 9, due: '13 oct' },
  { id: 'websearch', name: 'Búsqueda web', icon: 'search', description: 'Información actual de internet, con las fuentes citadas.', session: 13, due: '20 oct' },
  { id: 'telegram', name: 'Telegram', icon: 'send', description: 'Hablar con Eddie y recibir tus avisos desde Telegram.', session: 17, due: '27 oct' },
  { id: 'spotify', name: 'Spotify', icon: 'music', description: 'Reproducir, pausar y buscar música por voz (requiere Spotify Premium).', session: 23, due: '7 nov' },
  { id: 'notion', name: 'Notion', icon: 'doc', description: 'Buscar y leer tus páginas, y crear notas desde el chat.', session: 25, due: '10 nov' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'phone', description: 'Hablar con Eddie y recibir avisos por WhatsApp.', session: 27, due: '14 nov' },
  { id: 'chromebook', name: 'Chromebook (EDDIE Prime)', icon: 'monitor', description: 'Abrir apps y archivos de Linux en tu Chromebook, también desde Telegram.', session: 32, due: '22 nov' },
];
