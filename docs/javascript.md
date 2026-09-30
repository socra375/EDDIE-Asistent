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
  (lee el body como stream)        server/dev-server.js (local)
                                         │
                                         ▼
                                  api/_lib/chatStream.js (abre el stream,
                                         │                encuadra los eventos)
                                         ▼
                                  api/_lib/handler.js  (valida)
                                         │
                                         ▼
                                  api/_lib/providers.js (Gemini/Claude,
                                                          emite chunks)
```

La respuesta se transmite en vivo (streaming) en vez de esperar a que el
proveedor termine de generar todo el texto: `api/chat.js` responde con un
cuerpo NDJSON (una línea JSON por evento) que va escribiendo a medida que
`providers.js` invoca su callback `onChunk`. Esto es lo que hace que el
Chat muestre la respuesta palabra por palabra en vez de aparecer de golpe
al final — ver "Flujo completo de un mensaje de chat" más abajo para el
detalle del protocolo.

## Backend (`api/`, `server/`)

- **`api/_lib/providers.js`** — un adaptador por proveedor
  (`callGemini`, `callClaude`, `callGroq`), cada uno traduce el formato interno
  `{ system, messages }` a la petición REST de esa API con `stream: true`
  (Gemini: `:streamGenerateContent?alt=sse`; Claude: `stream: true` en el
  body) y va llamando a `onChunk(texto)` con cada fragmento a medida que
  llega, en vez de esperar la respuesta completa. `callProvider` elige
  cuál llamar según `provider` y, si falla antes de enviar texto y existe
  `GROQ_API_KEY`, reintenta con Groq (devuelve `fallbackFrom` con el
  proveedor original, que llega al chat en el evento `done`). No hay
  respaldo si ya se mostró texto (se mezclarían dos respuestas), si la
  petición era inválida, o si ya pasaron 40 s (no alcanzaría el límite de
  60 s de Vercel). Si Groq también falla, el error incluye ambos motivos.
  Aquí, y solo aquí, se leen `process.env.GEMINI_API_KEY`,
  `process.env.ANTHROPIC_API_KEY` y `process.env.GROQ_API_KEY`.
  `callGroq` usa la API compatible con OpenAI de Groq y las mismas
  herramientas de hora y clima: convierte el esquema de Gemini a JSON
  Schema estándar (`toJsonSchema`) y junta las llamadas a herramientas que
  llegan en fragmentos por el stream antes de ejecutarlas. Su modelo
  predeterminado es `openai/gpt-oss-120b` (Groq retiró
  `llama-3.3-70b-versatile` de su plan gratuito el 16 de agosto de 2026),
  con `reasoning_effort: 'low'` solo para modelos gpt-oss. Si Groq responde
  que el modelo no existe, `findAvailableGroqModel` pide la lista de modelos
  vigentes (`/openai/v1/models`), elige el mejor según
  `GROQ_MODEL_PREFERENCES`, reintenta una vez y recuerda el reemplazo.
  `fitToGroqBudget` recorta los mensajes más antiguos para que la petición
  (prompt + `max_tokens`) quepa en los 8K tokens por minuto del plan
  gratuito.
  `callGemini` además declara `tools` (las de los conectores activos, ver
  `api/_lib/connectors/` más abajo) y corre un
  bucle de hasta `MAX_TOOL_ROUNDS` rondas: si Gemini responde con una
  `functionCall` en vez de texto, ejecuta la herramienta localmente y le
  devuelve el resultado como un turno `role: 'user'` antes de volver a
  preguntarle (la documentación de Google muestra `role: 'function'` para
  este turno, pero la API en producción lo rechaza con "Role 'function' is
  not supported"; `'user'` sí es válido) — los chunks de una ronda con
  `functionCall` nunca se reenvían al usuario, solo los de la ronda final
  con texto. Claude no recibe `tools` todavía (ver más abajo). Al llegar a
  `MAX_TOOL_ROUNDS` rondas de herramientas, la siguiente petición ya no
  declara `tools` en absoluto — así se fuerza una respuesta en texto en
  vez de dejar que Gemini siga "pidiendo" una herramienta que nunca se va
  a ejecutar y terminar sin nada que mostrar.

  Los modelos `-latest` de Gemini llevan "thinking" interno que consume
  tokens de `maxOutputTokens` — con un presupuesto corto, ese razonamiento
  invisible puede comerse todo el límite antes de producir texto visible,
  dejando `finishReason: MAX_TOKENS` y una respuesta vacía (el error
  "Gemini no devolvió contenido utilizable."). Lo ideal sería desactivar
  el thinking (`thinkingConfig.thinkingBudget: 0`), pero el nombre/forma
  exacto de ese campo no es estable entre los distintos snapshots detrás
  del alias "-latest" — se probó y, con la versión del modelo vigente en
  ese momento, Gemini rechazaba toda petición con "Request contains an
  invalid argument" (peor que el bug original). Por eso, en su lugar,
  `generationConfig.maxOutputTokens` se subió a un valor generoso (8192)
  para todos los modelos — se observó en producción que 4096 no bastaba
  para una respuesta explicativa/técnica (p. ej. "qué es HTML" bajo el
  modo "Explicativo", que le pide a Gemini razonar paso a paso y por lo
  tanto consume más tokens de thinking que un simple saludo). Si aun así
  la respuesta llega vacía (sin `functionCall` ni texto), se reintenta
  automáticamente una vez con la misma petición exacta antes de rendirse
  — se observó en producción que una respuesta vacía a veces se resuelve
  con un simple reintento — y el detalle (`finishReason`, `blockReason`,
  `safetyRatings` de Gemini) se registra con `console.error` en los logs
  del servidor para poder diagnosticar el próximo caso sin adivinar. Si
  el reintento también llega vacío, el mensaje de error final distingue
  la causa real (bloqueo por políticas de contenido vs. límite de tokens
  agotado) en vez del genérico de antes.

  Sumar el reintento y la ronda final forzada sin herramientas eleva el
  máximo teórico a 4 intentos HTTP por petición de chat (2 rondas de
  herramientas + 1 ronda final en texto, más 1 reintento gastado en la
  que llegue vacía primero) — a `STREAM_HARD_TIMEOUT_MS` cada uno, ese
  peor caso supera el `maxDuration` de 60s de Vercel (`vercel.json`).
  Por eso `callGemini` controla también un presupuesto de tiempo total
  (`OVERALL_TIME_BUDGET_MS`, 45s): al superarlo, falla con su propio
  mensaje claro en vez de dejar que Vercel mate la función primero con un
  504 opaco.

  Cada intento de conexión (a Gemini, a Claude, y a Open-Meteo dentro del
  conector de clima) tiene un límite de tiempo — sin eso, una conexión colgada no
  tenía techo y podía consumir todo el tiempo de la función serverless,
  apareciendo en el navegador como un opaco "error (504)" en vez de un
  mensaje claro. Como ahora la respuesta se transmite en vivo, un único
  plazo fijo cortaría también una respuesta larga pero sana, así que
  `createStreamAbort()` combina dos límites independientes por intento:
  aborta si no llega ningún dato nuevo en `STREAM_IDLE_TIMEOUT_MS`
  (conexión realmente muerta), o si el intento entero supera
  `STREAM_HARD_TIMEOUT_MS` sin importar la actividad (techo de seguridad).
- **`api/_lib/chatStream.js`** — capa compartida entre `api/chat.js`
  (Vercel) y `server/dev-server.js` (Express) que abre la respuesta en
  streaming la primera vez que hay un chunk que enviar, y la va
  escribiendo como NDJSON (`{"type":"chunk","text":"…"}\n`, terminando con
  `{"type":"done",...}` o, si algo falla después de haber empezado a
  transmitir, `{"type":"error","message":"…"}`). Cualquier fallo *antes*
  de ese primer chunk (validación, falta la clave, cuota excedida, el
  primer intento fallando por completo) todavía responde con el código de
  estado HTTP y el JSON de error de siempre — streaming no cambió ese
  camino en absoluto, solo se le agregó el camino de éxito en vivo.
- **`api/_lib/connectors/`** — los conectores de Eddie, cada uno en su
  carpeta con el contrato de `docs/eddie-2-arquitectura.md` (id, nombre,
  descripción, ícono, autorización, variables de entorno requeridas y
  herramientas):
  - `clock/`: `get_current_datetime` (hora/fecha real según el `timezone`
    del navegador).
  - `weather/`: `get_current_weather` (clima real vía Open-Meteo, gratuito
    y sin API key; geocodifica el nombre de ciudad si se da uno, o usa las
    coordenadas de `context.location` si no). Sus llamadas usan el
    `fetchWithRetry` compartido para reintentar una vez ante un fallo de
    red transitorio.
  - `tasks/`: `create_task` y `complete_task`. No escriben nada: validan
    contra las tareas que el navegador manda en `context.tasks` (búsqueda
    aproximada sin acentos, aviso si hay varias parecidas o si ya existe),
    entienden fechas como "mañana" o "el viernes" en la zona horaria del
    usuario y emiten una acción (`context.emit`) que la app aplica al
    terminar la respuesta (`src/services/taskActions.js`).
  - `websearch/`: `search_web` con Tavily (resumen + fuentes). Sin clave
    usa el modo "keyless" de Tavily (límite bajo); `TAVILY_API_KEY` (gratis,
    1.000 búsquedas al mes) lo amplía. Su `note` en el hub depende de eso.
  - `news/`: `get_news` con los RSS públicos de Google Noticias, en español
    y del país del usuario (deducido del `timezone`), o de un tema de los
    últimos 3 días.
  - `wikipedia/`: `search_wikipedia` (busca en la Wikipedia en español y,
    si no hay artículo, en la inglesa; devuelve resumen y enlace).
  - `currency/`: `convert_currency` con open.er-api.com (tasa diaria, sin
    clave), acepta "dólares", "pesos" o "euros" además de códigos ISO.
  - `http.js`: `fetchJson`/`fetchText` para las herramientas (un reintento,
    timeout corto, nunca lanza) y `clip` para acortar lo que vuelve al
    modelo (cuenta contra el límite de tokens de Groq).
  - `google/`: la cuenta de Google del login (Calendario desde Tareas y
    Drive desde el chat); todavía sin herramientas para la IA (llegan en
    la sesión 12). `auth.isConnected(user)` mira si hay credenciales
    guardadas.
  - `planned.js`: solo metadatos de los conectores que llegan en próximas
    sesiones (Gmail, Telegram, Spotify, Notion, WhatsApp y el
    Chromebook), para mostrarlos en el hub.
  - `registry.js`: `createToolset({ disabled, context })` arma, para cada
    petición de chat, las declaraciones a ofrecer (solo conectores
    configurados en el servidor y no apagados por el usuario) y un
    `execute(name, args)` que nunca deja escapar una excepción: una
    herramienta desconocida o apagada, argumentos inválidos (lo valida
    `validate.js` contra los `parameters` declarados: tipos, requeridos,
    sin argumentos desconocidos, valores de `enum`) o un fallo interno se convierten en un
    `{ error }` que vuelve al modelo como cualquier resultado. Las
    herramientas `sensitive` (enviar, borrar…) nunca se ejecutan hasta que
    exista la confirmación en el chat (sesión 8).
    Las acciones que emiten las herramientas se juntan en
    `toolset.actions`; `callProvider` las devuelve con la respuesta (y las
    descarta si pasa al respaldo de Groq, que empieza de cero) y
    `chatStream.js` las manda en el evento `done`. Si el modelo pide varias
    herramientas a la vez, Gemini y Groq las ejecutan en paralelo (hasta 3
    rondas por respuesta).
    `describeConnectors({ user })` da la vista pública para el hub con un
    estado por conector: `ready`, `connected`, `needs_account`,
    `needs_setup` (con los nombres de las variables que faltan, nunca sus
    valores) o `planned`.
- **`api/_lib/connectorsHandlers.js`** + **`api/connectors.js`**
  — `GET /api/connectors` devuelve esa lista (funciona con o sin sesión).
  Es una sola función (`vercel.json` reescribe `/api/connectors/<id>/...`
  a `/api/connectors?path=<id>/...`) para que el OAuth y los webhooks de los
  próximos conectores (Telegram, WhatsApp) quepan sin superar el límite
  de 12 funciones del plan Hobby de Vercel (hoy hay 11).
- **`api/_lib/fetchWithRetry.js`** — wrapper genérico de reintento con
  backoff alrededor de `fetch`, usado tanto por `providers.js` (Gemini,
  Claude y Groq) como por los conectores (Open-Meteo). Acepta `options` como objeto
  o como función `() => options`; la forma de función se usa quien pase
  un `AbortSignal.timeout(...)` (una señal de un solo uso que empieza a
  contar al crearse), para que cada intento reciba una señal nueva en vez
  de reutilizar una que ya pudo haber expirado en el intento anterior.
- **`api/_lib/handler.js`** — valida la petición entrante antes de
  reenviarla: proveedor permitido, número y tamaño de mensajes, longitud
  del system prompt, y sanea el `context` opcional (`timezone` como
  string corta, `location` como `{ latitude, longitude }` numéricos y en
  rango) que llega desde el navegador — nunca se confía en él tal cual,
  ya que lo controla el cliente. Si algo no cuadra, lanza un error que
  `errorToResponse` traduce a un código HTTP (400 validación, 503
  proveedor sin clave, 502 error del proveedor).
  También sanea `disabledConnectors` (lista de ids de conectores que el
  usuario apagó en el hub: solo strings cortas en minúsculas, máximo 50),
  que `callProvider` usa para no ofrecer esas herramientas.
- **`api/chat.js`** / **`api/health.js`** — funciones serverless de
  Vercel; son wrappers finos sobre `handler.js` con las cabeceras CORS.
  `api/chat.js` también atiende `POST /api/chat?action=transcribe` (voz a
  texto) y `?action=speak` (texto a voz) para no gastar otras de las 12
  funciones del plan Hobby.
- **`api/_lib/speech.js`** — texto a voz con ElevenLabs
  (`/v1/text-to-speech/{voz}/stream`, MP3 a 64 kbps que se reenvía al
  navegador tal como llega). Voz `bUQeiO7gn4ehGuSnZf26` (o
  `ELEVENLABS_VOICE_ID`), modelo `eleven_flash_v2_5` (o `ELEVENLABS_MODEL`)
  con `language_code` del idioma de la app. Máximo 600 caracteres por
  petición y solo desde la propia app (`Sec-Fetch-Site`), para que otro
  sitio no gaste los créditos. Traduce los errores de ElevenLabs: sin
  créditos, clave inválida, voz de biblioteca en plan gratis (402) y voz
  inexistente.
- **`api/_lib/transcribe.js`** — voz a texto con Whisper en Groq
  (`/openai/v1/audio/transcriptions`, multipart, `temperature: 0`,
  `response_format: verbose_json`). Modelo `whisper-large-v3-turbo` (o
  `GROQ_STT_MODEL`), con `whisper-large-v3` como reserva si Groq retira el
  configurado. Con los segmentos de `verbose_json` descarta lo que Whisper
  marca como "probablemente no es voz" y las alucinaciones típicas del
  silencio ("Gracias por ver el video", "Subtítulos… Amara.org").
  Acepta hasta 4 MB (Vercel corta en 4,5 MB) y responde
  `{ text, model, language, duration }`.
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
      <AppShell />       {/* IconRail + ChatList + Header + panel activo */}
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
- **`VoiceContext.jsx`** — elige el motor de reconocimiento
  (`sttEngine`): `useWhisperRecognition` (Whisper en Groq) cuando el
  servidor tiene `GROQ_API_KEY` (`/api/health` → `groq`) y el navegador
  puede grabar, salvo que el usuario elija "El del navegador"
  (`settings.voice.stt`); si no, `useSpeechRecognition`. Expone la misma
  interfaz para ambos: `listening` sigue en `true` hasta que llega el texto
  final (con Whisper incluye la subida), y `recording`/`transcribing`
  separan las dos fases (el anillo muestra "TRANSCRIBIENDO"). También
  envuelve `useSpeechSynthesis` (TTS) y añade `speakWithSettings(texto)`,
  que usa el idioma activo y el motor de voz (`ttsEngine`: ElevenLabs si
  el servidor tiene la clave y el usuario no eligió una voz del navegador
  en `settings.voice.tts`/`voiceURI`). Los valores del contexto se nombran explícitamente
  (`sttSupported`/`ttsSupported`, `stop`/`stopSpeaking`, etc.) en vez de
  hacer `{ ...recognition, ...synthesis }` — ambos hooks devuelven una
  clave `supported` (y `synthesis` también `stop`), así que un spread
  plano dejaba que los valores de `synthesis` taparan silenciosamente a
  los de `recognition`.
- **`ChatContext.jsx`** — el más importante: mantiene el array de
  `messages`, el `status` (`idle | processing | responding | error`, que
  es lo que anima `EddieCore`), y la función
  `sendMessage(texto, { mode, display, tag, skill, title })` que:
  1. añade el mensaje del usuario al historial;
  2. prueba primero `getLocalAnswer` (ver `services/localAnswers.js`
     más abajo) — si el mensaje es small talk o trivia que Eddie puede
     responder por sí mismo, responde al instante y retorna sin tocar la
     red ni al proveedor de IA;
  3. si no hubo respuesta local, construye el system prompt con `buildSystemPrompt` (ver
     `services/personality.js`), inyectando el modo elegido, el idioma,
     la memoria si está activada y las tareas pendientes (`getTasks()`);
  4. llama a `sendChatMessage` (`services/api.js`) con los últimos
     `MAX_HISTORY_SENT` mensajes y un `context` con el `timezone` del
     navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`) y la
     `location` de `useLocation()`, si existe — es lo que el backend pasa
     a las herramientas de Gemini;
  5. le pasa un `onChunk(textoCompletoHastaAhora)` que, en cuanto llega el
     primer fragmento, agrega el mensaje del asistente al historial y pone
     `status` en `responding`; cada fragmento siguiente actualiza ese mismo
     mensaje por `id` — así la burbuja de Eddie crece en vivo en vez de
     aparecer completa al final. Si la conexión falla después de haber
     empezado a mostrar texto, ese texto se conserva y se le agrega una
     nota de error en vez de reemplazarlo por un mensaje aparte.

  Las habilidades del chat (`services/skills.js`) mandan una plantilla
  completa como `texto`, pero guardan en el mensaje `display` (lo que el
  usuario escribió, que es lo que muestra la burbuja) y `tag` (p. ej.
  "Estudio · Cuestionario · básico"). `skill` y `title` viajan a la
  respuesta para poder exportarla. Los mensajes con `tag` nunca pasan por
  `getLocalAnswer`.

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

- **`useWhisperRecognition.js`** — graba con `MediaRecorder` (Opus/WebM)
  y detecta el final de la frase por volumen (`AnalyserNode`): mide el
  ruido del cuarto 300 ms, marca como voz lo que lo supera claramente y
  corta tras 1,4 s de silencio (8 s sin hablar = "no se detectó voz",
  máximo 60 s). Sube el audio a `POST /api/chat?action=transcribe` como
  `application/octet-stream` con el tipo real en `X-Audio-Type`, y deja el
  texto en `transcript`. No hay texto en vivo: Whisper transcribe el clip
  completo.
- **`useSpeechRecognition.js`** — envuelve la Web Speech API
  (`SpeechRecognition`/`webkitSpeechRecognition`). Expone
  `listening`, `transcript`, `interimTranscript` (lo que se está
  transcribiendo en vivo), `start`, `stop`, `error`. Detecta si el
  navegador no soporta la API y lo señala en vez de fallar en silencio.
- **`useSpeechSynthesis.js`** — `speak(texto, { lang, voiceURI, engine,
  onEnd })` / `stop()` con dos motores. `engine: 'elevenlabs'` (la voz de
  Eddie, por defecto cuando `/api/health` dice `elevenlabs: true`) pide el
  audio a `POST /api/chat?action=speak` por partes (`splitForCloud`: una
  primera corta de 160 caracteres para empezar a hablar antes y luego de
  hasta 450) y descarga la siguiente mientras suena la actual; si una
  falla, termina la respuesta con la voz del navegador y deja el motivo en
  `cloudError` (sin clave, sin créditos o voz no permitida la desactivan
  hasta recargar). `engine: 'browser'` usa `window.speechSynthesis`. Elige la voz más
  natural disponible para el idioma (prefiere las "Natural"/"Online" y las
  de Google sobre las locales tipo eSpeak) o la que el usuario eligió en
  Configuración; quita el Markdown (`speakableText`) y lee las respuestas
  largas por frases de hasta 220 caracteres (`splitForSpeech`), porque
  Chrome corta las locuciones de más de ~15 s. (Groq no ofrece voces en
  español —su TTS solo tiene inglés y árabe—, por eso la voz propia va
  con ElevenLabs.)
- **`useProviderHealth.js`** — hace `fetch('/api/health')` una vez al
  montar y devuelve `{ gemini: bool, claude: bool }`, usado en
  Configuración para mostrar si cada proveedor tiene su clave puesta en
  el servidor.

### Servicios (`src/services/`)

- **`api.js`** — único punto de contacto con el backend
  (`sendChatMessage`), que además del `system` y los `messages` envía el
  `context` (timezone/ubicación) para las herramientas en tiempo real. Lee
  el cuerpo de la respuesta como stream (`res.body.getReader()`), parsea
  cada línea NDJSON y llama a `onChunk(textoAcumulado)` por cada
  `{"type":"chunk",...}` — ver `api/_lib/chatStream.js` para el formato
  exacto. Lanza `EddieApiError` con un mensaje ya en español y listo para
  mostrar en la interfaz si algo falla (red caída, backend con error,
  proveedor sin configurar, o un `{"type":"error",...}` a mitad de la
  transmisión).
- **`localAnswers.js`** — la "memoria propia" de Eddie: `getLocalAnswer(texto, { timezone, language })`
  reconoce small talk y trivia autorreferencial (cómo estás, qué día/hora
  es, quién eres, gracias) por patrones de texto normalizado (sin
  mayúsculas, acentos ni signos de puntuación) y devuelve la respuesta ya
  lista, o `null` si el mensaje no coincide con ninguno — en ese caso
  `ChatContext` sigue con el flujo normal hacia el proveedor de IA. Solo
  actúa cuando `language === 'es'`, para no forzar una respuesta en
  español dentro de una conversación en otro idioma. Estas respuestas
  nunca fallan por una caída o límite de cuota del proveedor de IA, porque
  nunca lo contactan.
- **`personality.js`** — define la personalidad de Eddie como asistente
  personal (`CORE_PERSONALITY`: eficiente, proactivo con criterio,
  honesto sobre lo que todavía no puede hacer, frases que suenen bien en
  voz alta) y los siete modos de respuesta (`MODES`: asistente, el modo
  por defecto `DEFAULT_MODE`, más rápido, explicativo, tutor, técnico,
  investigación y creativo).
  `buildSystemPrompt({ mode, language, memory, tasks })` combina todo eso
  en el texto que se envía como `system` a la API, con hasta 1200
  caracteres de memoria y las 8 tareas pendientes más prioritarias. En el
  peor caso queda por debajo de los 6000 caracteres que acepta el backend
  (`MAX_SYSTEM_LENGTH` en `api/_lib/handler.js`). `CORE_PERSONALITY` incluye
  una instrucción de formato explícita: nada de asteriscos, guiones de
  viñeta ni almohadillas (la interfaz no interpreta Markdown, así que se
  verían como caracteres sueltos), y separar ideas en párrafos con línea
  en blanco entre ellos — ver `RichText.jsx` para cómo se renderiza eso.
- **`skills.js`** — las habilidades del chat, que reemplazan a las viejas
  pantallas de Estudio, Programación y Documentos. Cada habilidad (`SKILLS`)
  define su modo, sus acciones (plantillas `build(texto, opción)`), una
  opción extra (nivel o lenguaje) y el placeholder del input.
  `buildSkillRequest(skill, acción, texto, opción)` devuelve el `prompt` a
  enviar, el `tag` de la burbuja, un `title` para exportar y el `mode`.
  La habilidad General envía el texto tal cual.

### Utilidades (`src/utils/`)

- **`storage.js`** — envoltorio de `localStorage` con lectura/escritura
  protegidas por `try/catch` (si el storage está lleno o deshabilitado, la
  app sigue funcionando como si no hubiera memoria guardada). Aquí viven
  `DEFAULT_SETTINGS` y las funciones para tareas, memoria y conversación.
- **`export.js`** — genera y descarga documentos en TXT, `.doc`
  (HTML válido con esa extensión, que Word/LibreOffice abren igual) y PDF
  (abre una ventana de impresión y llama a `window.print()`, para no
  añadir una librería solo para generar PDFs).

### Componentes (`src/components/`)

Organizados por módulo (`Chat/`, `Tasks/`, `Settings/`), más dos carpetas
transversales:

- **`Chat/ChatPanel.jsx`** — arriba, la fila de habilidades (General,
  Estudio, Código, Documentos) y un botón de conversación nueva; debajo,
  los selectores de la habilidad activa (qué necesitas y nivel/lenguaje, o
  el estilo de respuesta en General). El input es un `textarea` que crece
  con el contenido: Enter envía y Shift+Enter agrega una línea. En espacios
  angostos (el panel lateral de Inicio, el celular) una container query
  compacta la barra.
- **`Chat/MessageActions.jsx`** — debajo de cada respuesta: Copiar y, si
  vino de la habilidad Documentos o es larga (600+ caracteres), TXT, DOC,
  PDF y Drive (con sesión iniciada). El nombre del archivo sale del título
  sin acentos, porque algunos navegadores descartan el nombre si los tiene.

- **`Core/EddieCore.jsx`** — el núcleo visual animado; solo recibe
  `state` y `compact`, no sabe nada de chat ni de voz. Para `listening` y
  `processing` renderiza además `eddie-core__waves`: 16 barras dispuestas
  en círculo (una por `<span className="wave-spoke">`, rotada por
  `transform: rotate(...)` vía JS) que pulsan como un ecualizador de
  audio alrededor del núcleo — con el ícono de micrófono (`Icon`) en el
  centro para `listening`. El resto de estados conservan sus animaciones propias
  (respiración, giro, flash, etc.), todas puramente en CSS.
- **`src/layout/`** — el marco de la app, inspirado en JARVIS-HRZ, usado
  una sola vez desde `App.jsx`:
  - `IconRail.jsx`: barra vertical de íconos, uno por módulo con su propio
    color (lista en `modules.js`), Configuración abajo y un botón arriba
    para mostrar u ocultar "Mis chats". Los íconos son SVG de `Icon.jsx`.
  - `ChatList.jsx`: columna "Mis chats" con nueva conversación, buscador
    por título e historial ordenado por fecha; abrir un chat lleva al
    módulo Chat. Usa `conversations`, `loadConversation`,
    `deleteConversation` y `resetConversation` de `ChatContext`.
  - `Header.jsx`: encabezado HUD con "EDDIE" centrado y chips a los lados:
    reloj (`LiveClock.jsx`), RED (eventos `online`/`offline`), GPS (estado
    de `LocationContext`), cuenta de Google, "VOZ · ON/OFF" (el mismo
    ajuste `voice.autoRead` de Configuración; al apagarlo corta la voz en
    curso) y tema.
  - `HudFx.jsx`: capa decorativa de fondo (rejilla, escaneo, viñeta, marco).
  - `EddieLogo.jsx`: el logo oficial redibujado en SVG a partir de los PNG
    de `public/`. `EddieMark` es el ícono (anillo + "E"; va arriba en la
    barra de íconos y lleva a Inicio) y `EddieWordmark` el logo completo
    con "EDDIE" y la línea de pulso (va en el encabezado). Sus colores
    salen de `--logo-ring`, `--logo-letter` y `--logo-amber`, que el tema
    claro redefine.
  - `Layout.css`: grid de tres columnas; la columna de chats se colapsa a
    ancho 0 en vez de desmontarse (arranca cerrada). Bajo 1100px pasa a ser
    un panel deslizable (`App.jsx` lo cierra al elegir un chat o módulo, con
    Escape o tocando el fondo `.chatlist-backdrop`), y bajo 860px la barra
    de íconos pasa abajo.
- **`src/home/`** — la pantalla de Inicio, el módulo por defecto:
  - `HomePanel.jsx`: une voz y chat. El estado visual del anillo sale de
    `useVoice()` y `useChat().status`, con esta prioridad: escuchando >
    procesando > respondiendo > hablando > error del chat > desactivado
    (voz OFF o navegador sin micrófono) > error del micrófono > en espera.
    Tocar el anillo empieza a escuchar (encendiendo la voz si estaba OFF);
    al terminar de escuchar envía la transcripción con `sendMessage`. Solo
    auto-envía una escucha iniciada desde el anillo (`ringListenRef`), para
    no duplicar lo que el micrófono del `ChatPanel` ya pone en su input.
    Sin reconocimiento de voz, el anillo abre el chat de texto.
  - `EddieRing.jsx`: el anillo central en SVG, inspirado en J.A.R.V.I.S.
    (banda segmentada, bisel de marcas, corchete ámbar y "E.D.D.I.E." en
    el núcleo). Sigue siendo un reloj: arco exterior de segundos, arco
    interior de minutos y un puntero ámbar que gira con los segundos; se
    actualizan cada 100 ms por `ref`, sin re-renderizar React.
  - `InfoPanels.jsx`: TIEMPO, UBICACIÓN + CLIMA (Open-Meteo y
    geocodificación inversa de BigDataCloud directo desde el navegador,
    sin clave, refrescando cada 10 min), SISTEMA (batería, red, núcleos,
    memoria y pantalla; `N/D` si el navegador no lo expone) y TAREAS
    (pendientes reales de `getTasks()` con barra de progreso).
  - `weather.js`: `fetchWeather` y `fetchPlaceName`, con la misma tabla de
    códigos de clima que `api/_lib/connectors/weather/index.js`.
  - `HudPanel.jsx`: `HudPanel` y `HudRow`, el panel con título sobre el
    borde que usan todos los paneles de Inicio.
- **`Shared/RichText.jsx`** — parte cualquier respuesta de texto en
  bloques ` ```código``` ` y, dentro de cada bloque de texto, además en
  párrafos separados por línea en blanco (`splitParagraphs`) — cada uno
  como su propio `<p className="rich-text__paragraph">`, para que el
  `margin-bottom` de esa clase (`index.css`) separe visualmente cada
  párrafo en vez de que todo el texto quede en un solo bloque pegado. Los
  bloques de código se renderizan en `<pre><code>` con estilo
  monoespaciado. Lo usa `ChatPanel` para todas las respuestas.

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
4. `api/chat.js` (o `server/dev-server.js` en local) delega en
   `api/_lib/chatStream.js`, que valida con `handler.js` y llama a
   `providers.js`, que contacta a Gemini o Claude con la clave del
   servidor y pide la respuesta en streaming.
5. Cada fragmento que genera el proveedor sale de inmediato como una línea
   NDJSON hacia el frontend; `sendChatMessage` la parsea y llama a
   `onChunk`, y `ChatContext` va actualizando el mismo mensaje del
   asistente en el historial en cada llamada — `status` pasa a
   `responding` desde el primer fragmento (lo que anima `EddieCore`)
   y se mantiene así mientras el texto sigue llegando.
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
me/logout/eliminar cuenta, y `tasks.js` sirve tanto `/api/tasks` como `/api/tasks/<id>`
(`vercel.json` reescribe el segundo a `/api/tasks?id=<id>`) según
haya o no un id y el método HTTP. No se usan rutas "catch-all" opcionales
(`[[...id]].js`): fuera de Next.js, Vercel no les enviaba la ruta sin id y
la respondía la página de la app. En Express (`server/dev-server.js`) esto
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
- **Botón "Drive" en las respuestas del chat** (`MessageActions.jsx`) —
  llama a `remoteDrive.save` con el contenido de la respuesta y abre el
  archivo creado.
