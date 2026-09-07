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
- **`api/_lib/handler.js`** — valida la petición entrante antes de
  reenviarla: proveedor permitido, número y tamaño de mensajes, longitud
  del system prompt. Si algo no cuadra, lanza un error que
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
     `MAX_HISTORY_SENT` mensajes como contexto;
  4. añade la respuesta (o un mensaje de error legible) al historial y
     actualiza `status`.

  Cualquier módulo (Study, Code, Documents) reutiliza `sendMessage` desde
  `useChat()` para "preguntarle algo a Eddie" con un modo distinto, sin
  duplicar lógica de llamada a la API.

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
  (`sendChatMessage`). Lanza `EddieApiError` con un mensaje ya en español
  y listo para mostrar en la interfaz si algo falla (red caída, backend
  con error, proveedor sin configurar).
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
  `state` y `compact`, no sabe nada de chat ni de voz.
- **`Layout/`** — `Sidebar.jsx` (lista de módulos) y `TopBar.jsx` (título +
  estado + botón de tema), usados una sola vez desde `App.jsx`.
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
