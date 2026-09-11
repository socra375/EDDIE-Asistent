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
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Eddie — asistente virtual de IA para estudiantes: tutor, programación, voz, tareas y documentos." />
    <title>Eddie · Asistente de estudio</title>
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
- **`<link rel="icon">`**: favicon en SVG (`public/favicon.svg`), servido
  como archivo estático por Vite desde `public/`.
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
└── .app-shell                 (grid: sidebar | contenido)
    ├── nav.sidebar             (Sidebar.jsx)
    │   ├── .sidebar__brand
    │   └── ul.sidebar__list    (un <li>/<button> por módulo)
    ├── .app-main
    │   ├── header.topbar       (TopBar.jsx: título + estado + tema)
    │   └── .app-content        (aquí se monta el panel activo:
    │                            ChatPanel, StudyPanel, CodePanel,
    │                            TasksPanel, DocumentsPanel o
    │                            SettingsPanel)
    └── (AutoReadBridge: componente sin salida visual, solo efectos)
```

Cada panel de módulo es dueño de su propio HTML interno (formularios,
listas, botones); no hay plantillas HTML compartidas fuera de las clases
utilitarias definidas en `src/index.css` (`.glass-panel`, `.btn`, `.input`,
etc. — ver `docs/css.md`).

## `public/`

Todo lo que se coloca en `public/` se copia tal cual a la raíz del build
(`dist/`) sin pasar por el bundler. Actualmente contiene:

- `favicon.svg` — el icono de la pestaña del navegador, referenciado desde
  `index.html`.

## Accesibilidad básica

- El núcleo animado de Eddie (`EddieCore`) usa `role="img"` y
  `aria-label` dinámico según su estado (`Eddie: Escuchando`,
  `Eddie: Analizando tu solicitud…`, etc.) para que un lector de pantalla
  anuncie el estado del asistente.
- Los iconos puramente decorativos (emoji en el sidebar, botones) llevan
  `aria-hidden="true"` cuando van acompañados de texto visible.
- Los formularios usan `<label>` asociados a sus campos en vez de solo
  `placeholder`.
