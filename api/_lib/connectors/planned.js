// Connectors coming in later sessions of the Eddie 2.0 plan (see
// docs/eddie-2-arquitectura.md). Metadata only, for the hub: once one is
// built it moves to its own folder with real tools and leaves this list.
// `due` is the latest planned date; work running ahead can land sooner.
export const PLANNED_CONNECTORS = [
  { id: 'spotify', name: 'Spotify', icon: 'music', description: 'Reproducir, pausar y buscar música por voz (requiere Spotify Premium).', session: 23, due: '7 nov' },
  { id: 'chromebook', name: 'Chromebook (EDDIE Prime)', icon: 'monitor', description: 'Abrir apps y archivos de Linux en tu Chromebook, también desde Telegram.', session: 32, due: '22 nov' },
];
