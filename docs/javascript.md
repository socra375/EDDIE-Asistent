# JavaScript — arquitectura de la aplicación

Eddie tiene dos mitades de JavaScript que conviene distinguir desde el
principio:

1. **Frontend** (`src/`): React + Vite, se ejecuta en el navegador.
2. **Backend** (`api/`, `server/`): Node.js, se ejecuta como función
   serverless en Vercel (producción) o como servidor Express local
   (desarrollo). Es el único sitio que conoce las claves de Gemini/Claude.

Nunca se mezclan: el frontend solo le habla al backend mediante
`fetch('/api/chat')`, nunca directamente a Gemini o Claude.

```
Navegador                          Servidor
─────────────────────────         ─────────────────────────
src/services/api.js  ──fetch──▶  api/chat.js (Vercel) o
                                   server/dev-server.js (local)
                                         │
                                         ▼
                                  api/_lib/handler.js  (valida)
                                         │
                                         ▼
                                  api/_lib/providers.js (Gemini/Claude)
```

## Backend (`api/`, `server/`)

- **`api/_lib/providers.js`** — un adaptador por proveedor
  (`callGemini`, `callClaude`), cada uno traduce el formato interno
  `{ system, messages }` a la petición REST específica de esa API y
  normaliza la respuesta a `{ content, provider, model }`. `callProvider`
  elige cuál llamar según `provider`. Aquí, y solo aquí, se leen
  `process.env.GEMINI_API_KEY` / `process.env.ANTHROPIC_API_KEY`.
  `callGemini` además declara `tools` (ver `api/_lib/tools.js`) y corre un
  bucle de hasta `MAX_TOOL_ROUNDS` rondas: si Gemini responde con una
  `functionCall` en vez de texto, ejecuta la herramienta localmente y le
  devuelve el resultado como un turno `role: 'user'` antes de volver a
  preguntarle (la documentación de Google muestra `role: 'function'` para
  este turno, pero la API en producción lo rechaza con "Role 'function' is
  not supported"; `'user'` sí es válido). Claude no recibe `tools` todavía
  (ver más abajo). Cada llamada HTTP (a Gemini, a Claude, y a Open-Meteo
  dentro de `tools.js`) lleva un `AbortSignal.timeout` — sin eso, una
  conexión colgada no tenía techo y podía consumir todo el tiempo de la
  función serverless, apareciendo en el navegador como un opaco "error
  (504)" en vez de un mensaje claro.
- **`api/_lib/tools.js`** — las "herramientas" en tiempo real que Gemini
  puede invocar: `get_current_datetime` (hora/fecha real según el
  `timezone` del navegador) y `get_current_weather` (clima real vía
  Open-Meteo, gratuito y sin API key; geocodifica el nombre de ciudad si
  se da uno, o usa las coordenadas de `context.location` si no). Existen
  para que Eddie nunca tenga que inventar la hora o el clima a partir de
  su entrenamiento.
- **`api/_lib/handler.js`** — valida la petición entrante antes de
  reenviarla: proveedor permitido, número y tamaño de mensajes, longitud
  del system prompt, y sanea el `context` opcional (`timezone` como
  string corta, `location` como `{ latitude, longitude }` numéricos y en
  rango) que llega desde el navegador — nunca se confía en él tal cual,
  ya que lo controla el cliente. Si algo no cuadra, lanza un error que
  `errorToResponse` traduce a un código HTTP (400 validación, 503
  proveedor sin clave, 502 error del proveedor).
- **`api/chat.js`** / **`api/health.js`** — funciones serverless de
  Vercel; son wrappers finos sobre `handler.js` con las cabeceras CORS.
- **`server/dev-server.js`** — un servidor Express que expone las mismas
  rutas (`/api/chat`, `/api/health`) usando la misma lógica de
  `api/_lib/`, para poder desarrollar con `npm run dev:full` sin instalar
  la CLI de Vercel. Vite proxea `/api` hacia este servidor en desarrollo
  (`vite.config.js`).

## Frontend (`src/`)

### Punto de entrada

`src/main.jsx` monta `<App />` en `#root` con `createRoot` (React 19) y
carga `index.css`. `src/App.jsx` envuelve todo en tres *providers*
anidados y decide qué panel de módulo mostrar:

```jsx
<SettingsProvider>
  <VoiceProvider>
    <ChatProvider>
      <AppShell />       {/* Sidebar + TopBar + panel activo */}
    </ChatProvider>
  </VoiceProvider>
</SettingsProvider>
```

El orden importa: `VoiceProvider` y `ChatProvider` leen `settings` de
`SettingsContext`, así que `SettingsProvider` tiene que estar más arriba.

### Contextos (`src/context/`)

Los tres contextos son el "estado global" de la app — no hay Redux ni
otra librería de estado, solo React Context + `useState`/`useMemo`.

- **`SettingsContext.jsx`** — proveedor de IA, modelo, idioma, tema,
  configuración de voz y la "memoria" (hechos que Eddie recuerda entre
  sesiones). Persiste todo en `localStorage` a través de `utils/storage.js`
  cada vez que cambia. Expone `updateSettings`, `updateVoiceSettings`,
  `rememberFact`, `forgetFact`, `forgetEverything`.
- **`LocationContext.jsx`** — pide el permiso de geolocalización del
  navegador (`navigator.geolocation`) una vez al montar la app y expone
  `{ location, status, requestLocation }`. Si el usuario lo deniega o el
  navegador no lo soporta, `location` queda en `null` y Eddie simplemente
  le pregunta la ciudad en vez de asumir una (ver `personality.js`).
- **`VoiceContext.jsx`** — envuelve los hooks `useSpeechRecognition` y
  `useSpeechSynthesis` en una sola instancia compartida (el micrófono del
  navegador solo admite un reconocedor activo a la vez), y añade
  `speakWithSettings(texto)` que aplica automáticamente la voz/velocidad/
  tono/volumen guardados en `SettingsContext`.
- **`ChatContext.jsx`** — el más importante: mantiene el array de
  `messages`, el `status` (`idle | processing | responding | error`, que
  es lo que anima `EddieCore`), y la función `sendMessage(texto, {mode})`
  que:
  1. añade el mensaje del usuario al historial;
  2. construye el system prompt con `buildSystemPrompt` (ver
     `services/personality.js`), inyectando el modo elegido, el idioma y
     la memoria si está activada;
  3. llama a `sendChatMessage` (`services/api.js`) con los últimos
     `MAX_HISTORY_SENT` mensajes y un `context` con el `timezone` del
     navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`) y la
     `location` de `useLocation()`, si existe — es lo que el backend pasa
     a las herramientas de Gemini;
  4. añade la respuesta (o un mensaje de error legible) al historial y
     actualiza `status`.

  Cualquier módulo (Study, Code, Documents) reutiliza `sendMessage` desde
  `useChat()` para "preguntarle algo a Eddie" con un modo distinto, sin
  duplicar lógica de llamada a la API.

  También gestiona el **historial de conversaciones**: cada conversación
  vive en `conversations` (`{ id, title, messages, createdAt, updatedAt }`,
  persistido en `localStorage` vía `utils/storage.js`), identificada por
  `conversationId`. En cuanto una conversación tiene al menos un mensaje,
  un efecto la guarda/actualiza dentro de `conversations` — así nunca se
  pierde al cambiar de conversación. `resetConversation()` empieza una
  nueva (vacía) sin borrar la anterior; `loadConversation(id)` la vuelve
  activa; `deleteConversation(id)`/`clearAllConversations()` la(s)
  eliminan. `SettingsPanel.jsx` usa estas cuatro funciones para la sección
  "Historial de conversaciones", incluyendo migración automática de la
  única conversación que la app guardaba antes de esta función.

### Hooks (`src/hooks/`)

- **`useSpeechRecognition.js`** — envuelve la Web Speech API
  (`SpeechRecognition`/`webkitSpeechRecognition`). Expone
  `listening`, `transcript`, `interimTranscript` (lo que se está
  transcribiendo en vivo), `start`, `stop`, `error`. Detecta si el
  navegador no soporta la API y lo señala en vez de fallar en silencio.
- **`useSpeechSynthesis.js`** — envuelve `window.speechSynthesis`. Expone
  la lista real de `voices` instaladas en el navegador/SO (nunca asume que
  existe una voz concreta), y `speak(texto, opciones)` / `stop()`.
- **`useProviderHealth.js`** — hace `fetch('/api/health')` una vez al
  montar y devuelve `{ gemini: bool, claude: bool }`, usado en
  Configuración para mostrar si cada proveedor tiene su clave puesta en
  el servidor.

### Servicios (`src/services/`)

- **`api.js`** — único punto de contacto con el backend
  (`sendChatMessage`), que además del `system` y los `messages` envía el
  `context` (timezone/ubicación) para las herramientas en tiempo real.
  Lanza `EddieApiError` con un mensaje ya en español y listo para mostrar
  en la interfaz si algo falla (red caída, backend con error, proveedor
  sin configurar).
- **`personality.js`** — define la personalidad fija de Eddie
  (`CORE_PERSONALITY`) y los seis modos de respuesta (`MODES`: rápido,
  explicativo, tutor, técnico, investigación, creativo).
  `buildSystemPrompt({ mode, language, memory })` combina todo eso en el
  texto que se envía como `system` a la API.

### Utilidades (`src/utils/`)

- **`storage.js`** — envoltorio de `localStorage` con lectura/escritura
  protegidas por `try/catch` (si el storage está lleno o deshabilitado, la
  app sigue funcionando como si no hubiera memoria guardada). Aquí viven
  `DEFAULT_SETTINGS` y las funciones para tareas, memoria y conversación.
- **`export.js`** — genera y descarga documentos en TXT, CSV, `.doc`
  (HTML válido con esa extensión, que Word/LibreOffice abren igual) y PDF
  (abre una ventana de impresión y llama a `window.print()`, para no
  añadir una librería solo para generar PDFs).

### Componentes (`src/components/`)

Organizados por módulo (`Chat/`, `Voice/`, `Study/`, `Code/`, `Tasks/`,
`Documents/`, `Settings/`), más dos carpetas transversales:

- **`Core/EddieCore.jsx`** — el núcleo visual animado; solo recibe
  `state` y `compact`, no sabe nada de chat ni de voz. Para `listening` y
  `processing` renderiza además `eddie-core__waves`: 16 barras dispuestas
  en círculo (una por `<span className="wave-spoke">`, rotada por
  `transform: rotate(...)` vía JS) que pulsan como un ecualizador de
  audio alrededor del núcleo — con micrófono 🎙️ en el centro para
  `listening`. El resto de estados conservan sus animaciones propias
  (respiración, giro, flash, etc.), todas puramente en CSS.
- **`Layout/`** — `Sidebar.jsx` (lista de módulos, con `EddieLogo.jsx` como
  marca) y `TopBar.jsx` (título + reloj en vivo + estado + botón de tema),
  usados una sola vez desde `App.jsx`. `LiveClock.jsx` actualiza la hora
  cada segundo con `setInterval` y la formatea con `Intl.DateTimeFormat`
  según el idioma elegido en Configuración. `EddieLogo.jsx` es un SVG puro
  (sin imagen que empaquetar) — un glifo "E" con dos anillos orbitando a
  distinta velocidad alrededor, animado con CSS.
- **`Shared/RichText.jsx`** — parte cualquier respuesta de texto en
  párrafos y bloques ` ```código``` `, renderizando estos últimos en
  `<pre><code>` con estilo monoespaciado. Lo usan `ChatPanel`,
  `StudyPanel`, `CodePanel` y `DocumentsPanel` para no reimplementar el
  mismo parseo cuatro veces.

Cada panel de módulo sigue el mismo patrón: estado local con `useState`
para el formulario, `useChat().sendMessage(...)` para preguntarle a Eddie,
y `RichText` para mostrar el resultado. `TasksPanel` es la excepción: no
llama a la IA, es un CRUD puro sobre `localStorage` vía `utils/storage.js`.

## Flujo completo de un mensaje de chat

1. El usuario escribe en `ChatPanel` (o dicta por voz — el hook de STT
   rellena el mismo campo de texto) y pulsa "Enviar".
2. `ChatPanel` llama a `sendMessage(texto, { mode })` de `ChatContext`.
3. `ChatContext` arma el system prompt (`personality.js`) y llama a
   `sendChatMessage` (`services/api.js`), que hace `POST /api/chat`.
4. `api/chat.js` (o `server/dev-server.js` en local) valida con
   `handler.js` y llama a `providers.js`, que contacta a Gemini o Claude
   con la clave del servidor.
5. La respuesta normalizada vuelve al frontend; `ChatContext` la añade al
   historial y cambia `status` a `responding` (lo que anima `EddieCore`).
6. Si `settings.voice.autoRead` está activado, `App.jsx`
   (`AutoReadBridge`) detecta el nuevo mensaje y lo lee en voz alta con
   `speakWithSettings` de `VoiceContext`.
7. El historial se guarda en `localStorage` automáticamente (efecto en
   `ChatContext`), así que sobrevive a un refresco de página.

## Cuenta de Google, sincronización y Calendar/Drive

Esta capa es opcional (ver `README.md`) y se añadió sin tocar el
funcionamiento local-only existente: si no hay sesión, todo sigue igual
que antes.

### Backend

Los mismos principios que el resto de la API: cada endpoint es un archivo
delgado en `api/**.js` que delega en una función de `api/_lib/*Handlers.js`
platform-agnóstica (recibe `cookies`/`body` planos, devuelve
`{ status, json, redirect, setCookie }`), aplicada al `res` real por
`api/_lib/respond.js`. Esto es lo que permite que `server/dev-server.js`
(Express) y las funciones de Vercel compartan exactamente la misma lógica
sin duplicarla — el mismo patrón que ya usaba `/api/chat`.

El plan gratuito de Vercel limita a 12 funciones serverless por
despliegue, así que endpoints relacionados de bajo tráfico comparten
archivo en `api/`: `auth/session.js` sirve `GET`/`POST`/`DELETE` para
me/logout/eliminar cuenta, y `tasks/[[...id]].js` (ruta "catch-all"
opcional de Vercel) sirve tanto `/api/tasks` como `/api/tasks/<id>` según
haya o no un id y el método HTTP. En Express (`server/dev-server.js`) esto
no hace falta —no tiene ese límite—, así que ahí cada ruta sigue siendo
explícita.

- **`api/_lib/db.js`** — cliente Postgres vía `@neondatabase/serverless`
  (HTTP, sin pool de conexiones persistente — encaja bien con funciones
  serverless). `DATABASE_URL` nunca sale de aquí.
- **`api/_lib/google.js`** — construye la URL de autorización de Google,
  intercambia el `code` por tokens y los refresca. REST puro con `fetch`,
  sin SDK de Google.
- **`api/_lib/session.js`** — sesiones opacas: la cookie solo lleva un id
  aleatorio, que se resuelve contra la tabla `sessions`. `requireUser(cookies)`
  lanza un error `UNAUTHORIZED` (→ 401) si no hay sesión válida; lo usan
  todos los endpoints que requieren estar logueado.
- **`api/_lib/googleCredentials.js`** — guarda los tokens de Calendar/Drive
  por usuario y los renueva automáticamente con el `refresh_token` cuando
  están por expirar (`getValidAccessToken`).
- **`api/_lib/authHandlers.js`** — el flujo OAuth completo: `startGoogleLogin`
  (genera `state`, redirige a Google), `handleGoogleCallback` (valida
  `state`, intercambia tokens, upsert de `users`, crea sesión), `logout`,
  `me`, `deleteAccount`.
- **`api/_lib/calendarHandlers.js`** / **`driveHandlers.js`** — llaman a la
  REST API de Google Calendar/Drive con el token válido del usuario.
- **`api/_lib/tasksHandlers.js`** / **`settingsHandlers.js`** /
  **`memoryHandlers.js`** — CRUD sobre las tablas `tasks`, `settings`,
  `memory`, siempre filtrando por el `user_id` de la sesión (nunca por un
  id que mande el cliente).

El esquema vive en `db/migrations/0001_eddie_accounts.sql` (usuarios,
sesiones, credenciales de Google, tareas, settings, memory). El frontend
nunca se conecta a la base de datos directamente: todo pasa por estos
endpoints.

### Frontend

- **`context/AuthContext.jsx`** — no hace el baile OAuth (eso es una
  navegación de página completa, no algo que se pueda hacer con `fetch`);
  solo sabe quién está logueado (`GET /api/auth/session` al montar) y
  expone `login()` (redirige a `/api/auth/google/start`), `logout()`
  (`POST /api/auth/session`), `deleteAccount()` (`DELETE /api/auth/session`).
- **`services/remote.js`** — wrapper de `fetch` para
  `/api/tasks`, `/api/settings`, `/api/memory`, `/api/calendar/events`,
  `/api/drive/save`, todas con `credentials: 'include'` para mandar la
  cookie de sesión. Si el backend responde 401 (no logueado), devuelve
  `null` en vez de lanzar, para que el que llama pueda caer de vuelta a
  `localStorage` sin manejar un caso de error especial.
- **`components/Tasks/TasksPanel.jsx`** — sigue leyendo/escribiendo
  `localStorage` como caché instantánea. Si hay sesión, además: al iniciar
  sesión adopta las tareas del servidor (o, si el servidor no tiene
  ninguna todavía, sube las locales una sola vez como migración inicial);
  cada alta/edición/baja se refleja también en el backend.
- **`components/Shared/SettingsSyncBridge.jsx`** — el mismo patrón que
  `TasksPanel`, pero para `settings` y `memory` de `SettingsContext`: sin
  salida visual, solo efectos que reconcilian con `/api/settings` y
  `/api/memory` cuando hay sesión.
- **Botón "A Calendar" en Tareas** — llama a `remoteCalendar.createEventFromTask`,
  guarda el `googleEventId` devuelto en la tarea (local y remoto) para no
  volver a crear el evento dos veces.
- **Botón "Guardar en Drive" en Documentos** — llama a `remoteDrive.save`
  con el contenido generado por Eddie y muestra el enlace del archivo
  creado.
