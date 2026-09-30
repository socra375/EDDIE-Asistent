# HTML — estructura de la aplicación

Eddie es una SPA (Single Page Application) construida con Vite + React, así
que existe un único archivo HTML real en el repositorio: **`index.html`**,
en la raíz del proyecto. Todo lo demás que ves en pantalla es DOM generado
por React a partir de los componentes en `src/`.

## `index.html`

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#020b10" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Eddie, tu asistente personal por voz y texto: agenda, tareas, clima, estudio y más." />
    <meta property="og:title" content="Eddie · Asistente personal" />
    <meta property="og:description" content="Eddie, tu asistente personal por voz y texto." />
    <meta property="og:image" content="/eddie-logo.png" />
    <title>Eddie · Asistente personal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Punto por punto:

- **`lang="es"`**: el idioma por defecto de la interfaz es español (el
  usuario puede cambiarlo desde Configuración; esto no traduce el HTML
  estático, solo las respuestas de Eddie y el propio texto de los
  componentes, que ya están escritos en español).
- **`<link rel="icon">`**: favicon en SVG (`public/favicon.svg`, el logo
  de Eddie simplificado para que se lea a 16 px), servido como archivo
  estático por Vite desde `public/`.
- **`apple-touch-icon`, `manifest` y `theme-color`**: el ícono al guardar
  Eddie en la pantalla de inicio del celular y los datos para instalarlo
  como app (nombre, colores, íconos de 192 y 512 px).
- **`og:*`**: título, descripción e imagen (`eddie-logo.png`) que se
  muestran al compartir el enlace.
- **`<meta name="viewport">`**: obligatorio para que el diseño responsive
  (grid de sidebar/contenido que se reordena en móvil) funcione en
  teléfonos y tablets.
- **`<meta name="description">`**: usada por buscadores y al compartir el
  enlace.
- **`<div id="root">`**: el único nodo del DOM que Vite/React necesita.
  React monta aquí toda la aplicación mediante `createRoot` (ver
  `src/main.jsx`, documentado en `docs/javascript.md`).
- **`<script type="module" src="/src/main.jsx">`**: punto de entrada de
  Vite. En desarrollo, Vite sirve este módulo con recarga en caliente; en
  producción (`npm run build`), Vite reescribe esta etiqueta para apuntar
  al bundle final generado en `dist/`.

## No hay más archivos `.html`

No existen otras páginas HTML (`about.html`, `login.html`, etc.). La
navegación entre módulos (Chat, Estudio, Programación, Tareas,
Documentos, Configuración) **no cambia de página**: es un simple cambio de
estado de React (`activeModule` en `src/App.jsx`) que decide qué componente
renderizar dentro del mismo `<div id="root">`. Esto es lo que hace posible
que el estado de la conversación, la voz y el tema persistan al cambiar de
módulo sin recargar la página.

## Estructura del DOM en tiempo de ejecución

Una vez montada, la app renderiza aproximadamente esta jerarquía (simplificada):

```
#root
└── .app-shell                 (grid: rail | mis chats | principal)
    ├── .hud-fx                 (layout/HudFx.jsx: rejilla, escaneo, viñeta
    │                            y marco; decorativo, aria-hidden)
    ├── nav.rail                (layout/IconRail.jsx: un botón por módulo)
    ├── aside.chatlist          (layout/ChatList.jsx: nueva, buscar, historial)
    ├── .app-main
    │   ├── header.header       (layout/Header.jsx: chips de reloj, red y
    │   │                        GPS | "EDDIE" + módulo | chips de cuenta,
    │   │                        VOZ ON/OFF y tema)
    │   └── main.app-content    (aquí se monta el panel activo:
    │                            HomePanel (por defecto), ChatPanel,
    │                            StudyPanel, CodePanel,
    │                            TasksPanel, DocumentsPanel o
    │                            SettingsPanel)
    └── (AutoReadBridge: componente sin salida visual, solo efectos)
```

`HomePanel` (`src/home/`) arma su propia rejilla: `section.home` con dos
columnas de `section.hud-panel` (TIEMPO, UBICACIÓN, CLIMA | SISTEMA,
TAREAS) y en el centro el anillo de Eddie: un `<button>` que envuelve un
`<svg>` de 600×600 y un `<p role="status">` con el estado. Debajo van la
transcripción en vivo o la última respuesta (`aria-live="polite"`), los
botones flotantes de micrófono y chat, y el panel lateral
`aside.home__chat` con el `ChatPanel` de siempre.

Cada panel de módulo es dueño de su propio HTML interno (formularios,
listas, botones); no hay plantillas HTML compartidas fuera de las clases
utilitarias definidas en `src/index.css` (`.glass-panel`, `.btn`, `.input`,
etc. — ver `docs/css.md`).

## `public/`

Todo lo que se coloca en `public/` se copia tal cual a la raíz del build
(`dist/`) sin pasar por el bundler. Actualmente contiene:

- `favicon.svg` — el icono de la pestaña del navegador, referenciado desde
  `index.html`.
- `eddie-icon-512.png`, `eddie-icon-192.png` — el logo oficial (ícono) para
  el manifiesto de instalación.
- `apple-touch-icon.png` — el mismo ícono a 180 px con fondo sólido para
  iOS.
- `eddie-logo.png` — el logo completo (ícono + "EDDIE"), usado como imagen
  al compartir el enlace.
- `manifest.webmanifest` — nombre, colores y los íconos de la app
  instalable.

## Accesibilidad básica

- El núcleo animado de Eddie (`EddieCore`) usa `role="img"` y
  `aria-label` dinámico según su estado (`Eddie: Escuchando`,
  `Eddie: Analizando tu solicitud…`, etc.) para que un lector de pantalla
  anuncie el estado del asistente.
- Los iconos puramente decorativos (emoji en el sidebar, botones) llevan
  `aria-hidden="true"` cuando van acompañados de texto visible.
- Los formularios usan `<label>` asociados a sus campos en vez de solo
  `placeholder`.
