# Eddie 2.0 — Estructura técnica

Guía de referencia para las 35 sesiones del plan de Eddie 2.0 (asistente personal, voz primero, conectores, luego app de escritorio). Define dónde vive cada pieza para que cada sesión sume sin reorganizar lo anterior.

## Principios

1. **Un solo cerebro en la nube.** La web, Telegram, WhatsApp y la app de escritorio hablan con el mismo backend (`api/`). Ningún canal tiene lógica propia de IA.
2. **Conectores como plugins.** Cada servicio externo (Gmail, Spotify, Notion…) es una carpeta autocontenida que declara su autorización y sus herramientas. Agregar uno nuevo no toca el resto.
3. **Nada irreversible sin confirmación.** Enviar, borrar, publicar o gastar pasa siempre por una confirmación explícita del usuario.
4. **Todo gratis por defecto.** Gemini como proveedor principal, Groq y OpenRouter como respaldo; cada conector usa el plan gratuito de su servicio.

## Estructura de carpetas (destino)

```
api/
  chat.js                      ← sin cambios: entrada del chat (streaming NDJSON)
  connectors.js                ← (sesión 7) lista para el hub; luego OAuth y webhooks de todos los conectores
  cron.js                      ← NUEVO: tareas programadas (resumen matutino, recordatorios)
  _lib/
    providers.js               ← Gemini + Claude + Groq + OpenRouter (respaldo automático)
    confirm.js                 ← (sesión 8) ejecuta la acción que el usuario confirmó (POST /api/chat?action=confirm)
    connectors/
      registry.js              ← (sesión 7) lista de conectores, herramientas activas por petición y estados del hub
      validate.js              ← (sesión 7) validación de argumentos compartida
      planned.js               ← (sesión 7) metadatos de los conectores que vienen, para el hub
      clock/                   ← (sesión 7) hora y fecha (antes en tools.js)
      weather/                 ← (sesión 7) clima con Open-Meteo (antes en tools.js)
      tasks/                   ← crear y completar tareas desde el chat (acciones que aplica la app)
      websearch/               ← búsqueda web con Tavily (sin clave o con TAVILY_API_KEY)
      news/                    ← titulares de Google Noticias (RSS, sin clave)
      wikipedia/               ← resúmenes de Wikipedia (sin clave)
      currency/                ← tasas de cambio de open.er-api.com (sin clave)
      gmail/                   ← (sesiones 9–11) buscar, leer y enviar/responder con confirmación (permisos incrementales)
      google/                  ← (sesión 12) Calendario: ver, crear, y mover/borrar con confirmación (+ Drive y Tareas → Calendario)
      telegram/
      whatsapp/
      spotify/
      notion/
    memory/                    ← NUEVO: memoria vectorial (pgvector)
src/
  layout/                      ← IconRail, ChatList, Header (reemplazan Sidebar y TopBar)
  core/                        ← Orbe central con estados + botones flotantes
  chat/                        ← panel de chat lateral + tarjetas de confirmación
  today/                       ← (sesiones 14–15) panel "Hoy": agenda, correos importantes, pendientes, clima y noticias
  connectors/                  ← (sesión 7) hub de conectores (tarjetas por estado e interruptores)
  skills/                      ← Estudio, Código, Documentos como habilidades del chat
desktop/                       ← NUEVO (semana 8): app Tauri que envuelve la web
```

**Límite de Vercel Hobby (12 funciones):** con `api/connectors.js` (sesión 7) hay 11 archivos en `api/`. Todos los conectores comparten esa función y todas las tareas programadas compartirán `api/cron.js`, con el mismo patrón que ya usan `api/tasks.js` y `api/connectors.js`: un archivo simple más una reescritura en `vercel.json` para las subrutas (las rutas comodín opcionales `[[...x]].js` no reciben la ruta base fuera de Next.js). Eso deja el total en 12.

## Contrato de un conector

Cada carpeta en `api/_lib/connectors/<id>/` exporta un objeto con esta forma (los de `clock/`, `weather/` y `google/` son ejemplos reales):

```js
export default {
  id: 'gmail',
  name: 'Gmail',
  description: 'Buscar, leer y resumir tus correos…',   // lo que ve el usuario en el hub
  icon: 'mail',                // nombre de ícono de src/layout/Icon.jsx
  category: 'comunicacion',    // asistente | informacion | comunicacion | agenda (agrupa y etiqueta en el hub)
  route: /correo|mail|gmail/i, // opcional: solo se ofrece cuando la conversación toca el tema (sin `route`, siempre)
  requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], // sin ellas: "falta configurar"
  auth: {                      // null si no necesita cuenta (ej. búsqueda web)
    type: 'oauth2',
    isConnected: async (user) => { … },  // ¿este usuario ya lo conectó?
    start(state) {},           // URL de autorización
    callback(query) {},        // intercambia el código y guarda tokens cifrados
  },
  note: null,                  // aviso opcional para el hub (texto, o función (env) => texto)
  tools: [
    {
      label: 'Buscar correos',  // cómo se muestra en el hub
      declaration: { name: 'gmail_search', description: '…', parameters: { … } },
      activity: 'Buscando correos…',  // lo que la app muestra mientras corre
      sensitive: false,        // true → requiere confirmación antes de ejecutarse
      risk: 'read',            // 'read' (por defecto) | 'write' (guarda algo reversible) — sensitive equivale a 'confirm'
      summarize: (result) => '…', // una línea para el recibo del paso (opcional)
      prepare: async (args, ctx) => { … },  // solo si sensitive: valida, completa y describe la tarjeta
      run: async (args, ctx) => { … },  // ctx: timezone, ubicación y tareas del usuario, y emit(acción) para cambios en la app
    },
  ],
  webhook: null,               // Telegram/WhatsApp: handler de mensajes entrantes
};
```

- Para agregar un conector: crear su carpeta e importarlo en `registry.js`. Si estaba en `planned.js`, se quita de ahí.
- `registry.js` reutiliza para todas las herramientas la validación de argumentos (`validate.js`), el aislamiento de fallos (todo error vuelve al modelo como `{ error }`) y los reintentos de `api/_lib/fetchWithRetry.js`.
- Solo se ofrecen a la IA las herramientas de los conectores configurados en el servidor y que el usuario no apagó en el hub (`settings.disabledConnectors`, que el chat envía como `disabledConnectors`).
- **Sistema de herramientas.** Cada conector tiene `category` y cada herramienta un riesgo (`toolRisk`): `read` (consulta), `write` (guarda un cambio reversible, como crear una tarea) o `confirm` (`sensitive`, pide tarjeta). El hub los muestra. El **enrutado por intención** ahorra tokens (el plan gratis de Groq da 8K por minuto) y le deja menos opciones equivocadas a un modelo pequeño: `createToolset({ intent })` recibe el texto de los últimos mensajes (`intentFromMessages`: los dos últimos del usuario y la última respuesta de Eddie, para que un "sí, mándalo" siga apuntando al correo) y solo ofrece los conectores sin `route` (planificador, hora, calculadora, tareas, búsqueda web) más los cuyo `route` coincide. Sin `intent` (el resumen de Hoy, la confirmación de tarjetas) se ofrece todo. `toolset.offered` lista los conectores ofrecidos.
- Estados que muestra el hub: `ready`, `connected`, `needs_account`, `needs_setup` y `planned`; "apagado" es la decisión del usuario y vive en sus ajustes.
- Una herramienta `sensitive` nunca se ejecuta desde la IA: pasa por el protocolo de confirmación (abajo).
- Los tokens se guardan cifrados en Postgres (AES-256-GCM con una clave derivada de `CONNECTOR_SECRET`, `api/_lib/secretBox.js`). Los de Google ya van así en `google_credentials` (sesión 9); los conectores con cuenta propia (Spotify, Notion) usarán una tabla `connector_credentials` con el mismo cifrado.

## Protocolo de confirmación

Implementado en la sesión 8.

1. Cuando la IA pide una herramienta marcada `sensitive: true`, `registry.js` no la ejecuta: llama a su `prepare(args, ctx)` (valida y completa la petición, p. ej. encuentra la tarea exacta) y guarda una tarjeta en `toolset.confirmations`. A la IA le devuelve `{ status: 'awaiting_confirmation', instruction }`, para que pida confirmación en vez de decir que ya lo hizo.
2. La tarjeta viaja en el evento final del stream:

```
{"type":"done", …, "confirmations":[{"id":"…","tool":"delete_task","label":"Borrar tareas","args":{"title":"Comprar pan"},
  "preview":{"title":"Borrar tarea","confirmLabel":"Borrar","danger":true,"fields":[{"key":"title","label":"Tarea","value":"Comprar pan"}]}}]}
```

3. La app la muestra bajo la respuesta (y en Inicio) con el botón de la acción ("Borrar", "Enviar"), **Editar** para los campos con `editable: true` y **Cancelar**. El usuario también puede decir o escribir "sí" / "no".
4. Al confirmar, la app llama a `POST /api/chat?action=confirm` con `{ tool, args, context }`. El servidor comprueba que la herramienta siga activa y sea `sensitive`, valida los argumentos (pueden venir editados), vuelve a correr `prepare` y luego `run`; responde `{ result, actions }` sin volver a llamar a la IA. Solo acepta peticiones de la propia app (`Sec-Fetch-Site`).
5. Si el proveedor falla y responde un respaldo (Groq u OpenRouter), las tarjetas del intento fallido se descartan.

Los canales Telegram y WhatsApp usarán botones del propio mensaje para lo mismo.

### Agente de varios pasos

Gemini puede encadenar hasta 5 rondas de herramientas por respuesta (Groq, 3, por su límite de tokens por minuto), con las llamadas de una misma ronda en paralelo. A los 30 s se dejan de ofrecer herramientas para que la respuesta final quepa en el tiempo de Vercel. Mientras trabaja, el stream emite un evento `{"type":"step","id":"s1","tool":"search_web","label":…,"activity":"Buscando en internet…","status":"running"}` por cada llamada (y otro, con el mismo `id`, cuando termina: `done`/`error`/`waiting`, con `summary`), y la app los muestra como un recibo en la burbuja de espera, en Inicio y en el mensaje final.

### Memoria estructurada

La memoria ya no es un mapa plano sino un documento v2 (`src/services/memory.js`): perfil, preferencias, proyectos (estado, stack, último cambio, próximo objetivo), decisiones, conocimientos y contexto temporal con vencimiento. Sigue guardándose como un solo `jsonb` en la tabla `memory` (sin migración de base de datos; el PUT rechaza más de 200 KB) y el mapa antiguo se migra al leerlo. Flujo: el navegador manda el mensaje y una lista plana `context.memory`; el system prompt lleva solo lo relevante para ese mensaje (presupuesto de 1400 caracteres); Eddie guarda lo nuevo con `remember`/`update_project` (acciones que aplica la app y que aparecen bajo la respuesta como "Recordé: …"), consulta con `recall` y olvida con `forget` (con tarjeta). Tareas y conversaciones siguen en sus módulos; los resúmenes de conversaciones y la búsqueda vectorial llegan con pgvector (sesiones 20–21).

### Telegram

`api/_lib/telegram/` (+ `connectors/telegram/` para la tarjeta del hub). Un solo webhook, `POST /api/connectors/telegram/webhook`, dentro de la función de conectores (vercel.json reescribe `/api/connectors/*` y le da 60 s; no suma función al tope de 12). Telegram firma cada llamada con `X-Telegram-Bot-Api-Secret-Token` (`TELEGRAM_WEBHOOK_SECRET`, comparado en tiempo constante); con el secreto válido siempre se responde 200 (un no-2xx hace que Telegram reintente) y cada `update_id` se procesa una sola vez (tabla `telegram_updates`).

- **Vincular**: la app (sesión de Google) pide `POST .../telegram/link`, que registra webhook, comandos y botón de menú (`ensureBotSetup`, idempotente) y crea un código de 8 caracteres válido 10 minutos; el usuario abre `t.me/<bot>?start=<código>` y el webhook lo canjea por el `chat_id` (`telegram_links`). Solo chats privados; sin vínculo el bot solo explica cómo vincular. Con `EDDIE_OWNER_EMAIL` definido solo el dueño vincula.
- **Mismo cerebro**: `runAssistant` arma el prompt con `buildSystemPrompt` (personalidad, memoria y tareas del usuario leídas de la base), llama a `callProvider` con los ajustes de la cuenta (proveedor, conectores apagados, memoria) y aplica en la base las acciones de Tareas y Memoria (`serverActions.js`, que comparte `applyActions` con la app). La conversación se guarda (12 mensajes) en `telegram_links.history`.
- **Voz**: nota de voz → descarga → Whisper (`transcribeAudio`, el mismo de la app) → respuesta; si el usuario habló (o activó `/voz on`) se añade la voz de ElevenLabs (`synthesizeSpeech`, hasta una frase completa dentro del tope de 600 caracteres) como nota de voz; el texto sale completo siempre. Sin clave de ElevenLabs queda solo texto.
- **Confirmaciones**: las herramientas sensibles guardan su acción en `telegram_pending` y llegan con botones ✅ / ✖ (`callback_data` = `ok:<id>` / `no:<id>`); un botón solo vale en el chat que lo recibió, una vez y dentro de 24 h. "Sí" / "no" escritos o dichos por voz responden a la última. Al confirmar corre `confirmTool` (con verificación) y se edita el mensaje con el resultado.
- **"Llamar"**: la API de bots no permite llamadas de teléfono. `/llamar` y el botón de menú abren la app de Eddie como Web App dentro de Telegram (necesita `APP_URL` con https; el micrófono depende del teléfono; la sesión de Google es la del navegador de Telegram, así que puede pedir iniciar sesión otra vez).
- Tablas en `db/migrations/0002_telegram.sql`. Los recordatorios y avisos que Eddie envía por su cuenta salen del trabajo programado (sección siguiente) usando `sendMessage` y `telegram_links`.

### WhatsApp (Meta Cloud API)

- **Cerebro compartido** (`api/_lib/channels/`): `brain.js#askEddie` (prompt, memoria, tareas, recuerdos de conversaciones, proveedor y acciones del usuario) y `runConfirmed` (ejecuta una tarjeta confirmada) más `common.js` (sí/no escrito, voz de Eddie, texto de las tarjetas, cierre de conversaciones frías) los usan Telegram y WhatsApp; cada canal solo pone su "nota de superficie", sus botones y su manera de enviar.
- **Webhook** (`/api/connectors/whatsapp/webhook`): `GET` verifica la dirección (`hub.verify_token` en tiempo constante; la respuesta es texto plano, `respond.js` admite `text`); `POST` exige `X-Hub-Signature-256` (HMAC-SHA256 con `WHATSAPP_APP_SECRET`). Meta firma los bytes exactos y Vercel parsea el JSON, así que `api/connectors.js` lee el cuerpo crudo solo en esta ruta (`rawBody.js`; si no hay bytes crudos, se reconstruyen como Meta los escribe —`\uXXXX`, `\/`—: cualquier reconstrucción que coincida prueba que el emisor conocía el secreto). Responde 200 tras validar y deduplica por `wamid` (`whatsapp_messages`).
- **Vinculación**: `POST whatsapp/link` (solo el dueño si hay `EDDIE_OWNER_EMAIL`) crea un código de 8 caracteres (10 min) y devuelve un enlace `wa.me/<número>?text=VINCULAR CÓDIGO` (el número sale de `GET /{phone-number-id}?fields=display_phone_number`); el mensaje `VINCULAR CÓDIGO` desde un teléfono lo liga a la cuenta (`whatsapp_links`, un teléfono por usuario). Cualquier otro mensaje de un número sin vincular solo recibe cómo vincular.
- **Mensajes**: texto, notas de voz (descarga con el token → Whisper → respuesta; si habló, Eddie contesta con su voz subiendo un MP3 como medio), fotos (JPEG/PNG/WebP ≤ ~900 KB, a la visión de Gemini/Claude) y botones de respuesta (`ok:<id>` / `no:<id>`, título ≤ 20 caracteres) para las confirmaciones, con las mismas reglas que Telegram (24 h, ligadas al teléfono, también por "sí"/"no"). La descarga de medios solo acepta los servidores de Meta y solo a ellos se envía el token.
- **Límites de la plataforma**: sin llamadas; texto libre solo dentro de las 24 h posteriores al último mensaje del usuario (siempre se cumple al responder), por eso los avisos de recordatorios y el resumen matutino siguen saliendo por Telegram (para WhatsApp harían falta plantillas aprobadas). Versión de la Graph API `v23.0` (`WHATSAPP_GRAPH_VERSION`).

### Recordatorios y resumen de la mañana (Cron)

- **Conector `reminders`** (`api/_lib/connectors/reminders/`): `set_reminder` (`in_minutes`, o `time` + `date` en la zona del usuario; solo hora = hoy, o mañana si ya pasó; máximo un año y 50 pendientes), `list_reminders`, `cancel_reminder` y `set_morning_briefing`. A diferencia de las tareas, escriben ellas mismas en la base (`reminders`, `briefing_settings`, migración `0003_reminders.sql`), porque el aviso tiene que existir en el servidor cuando no hay navegador abierto; exigen sesión y Telegram vinculado, y releen lo guardado para marcar `verified`. Salen por tema (`route`).
- **Trabajo programado** (`api/_lib/reminders/run.js`, expuesto en `GET|POST /api/connectors/cron`, protegido con `Authorization: Bearer <CRON_SECRET>`, comparación en tiempo constante y mínimo 16 caracteres): manda los avisos vencidos (`reminderText` avisa si llegan más de 15 min tarde) y los resúmenes cuya hora local ya pasó (ventana de 3 h, uno por día local). Todo se reserva antes de enviar (`update … where sent_at is null returning`, `claimBriefingDay`), así que dos ejecuciones a la vez no duplican; si Telegram rechaza el mensaje se libera (máximo 5 intentos por aviso) para el siguiente ciclo.
- **Quién lo dispara**: Vercel Hobby solo permite un cron diario (`vercel.json`, 11:00 UTC), insuficiente para "avísame a las 5:10"; por eso `.github/workflows/eddie-cron.yml` llama al endpoint cada 5 minutos con el secreto `CRON_SECRET` del repositorio (el retraso típico de GitHub Actions es de unos minutos).
- **Resumen** (`briefing.js`): `collectToday` (el mismo origen que el módulo Hoy: agenda, correos importantes, titulares) + tareas pendientes + recordatorios de hoy, formateado sin IA (`formatBriefing`, pura). Comandos del bot: `/resumen` y `/recordatorios`; la tarjeta de Telegram en Conectores tiene el interruptor, la hora y "Enviarme uno ahora" (`telegram/briefing` y `telegram/briefing-now`).

### Conector de Notion

Cinco herramientas en `api/_lib/connectors/notion/`: `notion_search`, `notion_read_page` y `notion_query_database` (lectura) y, con tarjeta, `notion_create_page` y `notion_append`. Misma política que GitHub: **un token de integración interna en `NOTION_TOKEN`** (variable de Vercel; nunca llega al navegador ni a la base de datos) y cada herramienta exige una sesión cuyo correo esté en `EDDIE_OWNER_EMAIL`, también al confirmar una tarjeta. Se eligió la integración interna en vez de OAuth público porque Eddie es de un solo dueño y así no hace falta guardar tokens por usuario; la integración solo ve lo que el dueño comparta (••• → Conexiones).

- **API**: `Notion-Version: 2022-06-28` (la anterior a los *data sources* de 2025-09-03, que cambian cómo se consultan las bases de datos). Errores traducidos: 401 (token), 404 `object_not_found` (con la pista de compartir la página), 403, 429, 400.
- **Referencias**: el usuario puede nombrar páginas por título, enlace o id (`idFrom` acepta notion.so/.site/.com); un título se resuelve con `/search` (coincidencia exacta, o única; si hay varias, devuelve las candidatas). Una base de datos nombrada donde se esperaba una página (y al revés) da un mensaje que apunta a la herramienta correcta.
- **Lectura** (`blocks.js#blocksToText`): hasta 2 páginas de 100 bloques y 12 sub-lecturas (toggles, listas anidadas), convertidos a texto con indentación y recortados a 6.000 caracteres (`truncated`). Las filas de una base se aplanan a propiedades simples (select, status, fecha, casillas, personas…).
- **Escritura** (`blocks.js#markdownToBlocks`): Markdown sencillo → bloques (títulos, listas, tareas, citas, código, separadores; 2.000 caracteres por segmento y 100 bloques por petición, avisando si se cortó). `prepare` resuelve el destino y arma la tarjeta (título y contenido editables); `run` crea la página (o fila, usando el nombre real de la propiedad de título) y la relee para `verified`; añadir usa `PATCH /blocks/{id}/children` y compara los bloques devueltos. Sin destino y sin `NOTION_PARENT_PAGE_ID`, Eddie pregunta (una integración no puede crear páginas en la raíz del espacio).
- Sin borrar ni archivar nada. Sale por tema (`route`).

### Visión (imágenes)

- **Formato**: cada mensaje del usuario puede llevar `images: [{ mimeType, data (base64) }]` (hasta 3 por mensaje; solo JPEG/PNG/WebP/GIF; `api/_lib/images.js` valida tipo, base64 y 1,2 M de caracteres por imagen). El servidor solo reenvía las imágenes de los dos últimos mensajes que las tengan y nunca más de 3 en total (`limitImages`); un mensaje del asistente jamás las lleva.
- **Proveedores**: `callGemini` las envía como `inline_data` y `callClaude` como bloques `image` (antes del texto). `planProviders` reencamina el mensaje si el proveedor elegido no ve (Groq/OpenRouter → Gemini, o Claude sin clave de Gemini), sin reutilizar el modelo del otro proveedor; con imágenes los respaldos son solo Gemini/Claude (Groq nunca) y sin ninguno configurado responde `PROVIDER_UNAVAILABLE`.
- **Navegador** (`src/services/images.js`): `prepareImage` decodifica (respetando la orientación EXIF), reduce a 1280 px y JPEG (baja calidad/tamaño hasta ≤ 900.000 caracteres base64) y crea una miniatura de 160 px. La conversación guardada (localStorage) conserva solo la miniatura; las imágenes completas viven en un `Map` en memoria (`ChatContext`), de modo que tras recargar un mensaje antiguo llega con una nota ("adjuntó una imagen que ya no está disponible").
- **Telegram** (`bot.js`): `pickPhoto` elige el mayor tamaño que quepa (o un documento de imagen ≤ ~900 KB), se descarga y se manda como imagen con el pie de foto (o "¿Qué ves en esta imagen?"); el hilo guarda `📷 texto`, no la imagen.

### Memoria de conversaciones (pgvector)

- **Datos**: tabla `episodes` (`db/migrations/0004_episodes.sql`, extensión `vector`): un resumen por tramo de conversación + `embedding vector(768)` (`gemini-embedding-001` con `outputDimensionality: 768`, normalizado; `RETRIEVAL_DOCUMENT` al guardar, `RETRIEVAL_QUERY` al buscar). Sin índice vectorial a propósito: cada consulta filtra por usuario (máximo 300 filas) y una lectura secuencial es exacta; HNSW con filtro devolvería menos resultados. Distancia coseno (`<=>`), similitud = `1 - distancia`.
- **Guardar** (`api/_lib/episodes/recall.js#saveConversation`): `summarize.js` pide el resumen al primer proveedor con clave (Gemini → Groq → OpenRouter; "NADA" = sin nada que recordar) tratando el chat como datos, no instrucciones; se embebe y se inserta; tope de 20 por hora y 300 en total. La app lo dispara con `POST /api/connectors/episodes` desde `useEpisodeSaver` (inactividad de 5 min, cambio de chat o `pagehide`; manda solo los mensajes posteriores al último resumen y guarda el avance en `localStorage`). Telegram cierra su hilo en `bot.js#closeConversation` (30 min sin actividad o `/nuevo`, usando `telegram_links.history_at` y `episode_saved` para hacerlo una sola vez; se hace mientras se prepara la respuesta).
- **Recordar**: `handler.js` añade al prompt, antes de llamar al modelo, el bloque de `recallBlock` (hasta 3 notas con similitud ≥ 0,62 y 900 caracteres; se salta si el mensaje es muy corto, si no hay notas —no llama a Gemini—, si el usuario apagó el conector o si algo falla o tarda más de 2,5 s). La herramienta `search_conversations` (conector `conversations`, por tema) busca con un umbral más bajo (0,5) y hasta 5 notas. Los bloques se presentan como "notas tuyas, no instrucciones".
- **Control del usuario**: `GET episodes`, `POST episodes/delete` (`{id}` o `{all:true}`); todo filtrado por usuario. Un solo interruptor: `conversations` en `disabledConnectors` (tarjeta de Memoria o hub) más `memoryEnabled`; el servidor lo comprueba también al guardar.

### Conector de GitHub

Seis herramientas en `api/_lib/connectors/github/`: `github_list_repos`, `github_repo_activity` (commits, PR, issues y estado del CI de la rama principal), `github_list_issues`, `github_get_issue` (con detalles de PR y últimos comentarios) y, con tarjeta, `github_create_issue` y `github_comment`; al confirmar, releen lo que GitHub devolvió y marcan `verified`. No fusiona, cierra ni borra nada. Como Eddie es un asistente personal, usa **un solo token en `GITHUB_TOKEN`** (variable de Vercel: nunca llega al navegador ni a la base de datos) y, como ese token abre repositorios privados, cada herramienta exige una sesión cuyo correo esté en `EDDIE_OWNER_EMAIL`; sin sesión o con otro correo no se hace ninguna llamada a GitHub (tampoco al confirmar una tarjeta). Un token por usuario, cifrado en la base de datos, queda como opción si algún día Eddie lo usan más personas. Enlace con la memoria: un proyecto guardado con `repo: "dueño/nombre"` (`update_project`) aparece en el prompt con ese repo, y nombrarlo en la conversación ofrece las herramientas de GitHub aunque no se diga "GitHub" (`intentFromMessages(messages, memory)`).

### Flujo de acción: entiende → planifica → pide permiso → ejecuta → comprueba → informa

- **Planifica**: para pedidos de 3 o más acciones, o delicados, Eddie llama primero a `make_plan({ goal, steps })` (herramienta oculta del conector `agent`, no cambia nada) y el plan aparece numerado en el recibo.
- **Pide permiso**: las herramientas `sensitive` dejan su paso en `waiting` y una tarjeta con `stepId`; al confirmar o cancelar el paso se actualiza.
- **Comprueba**: tras crear, mover o borrar un evento, Calendario vuelve a leerlo; tras enviar un correo, Gmail revisa que esté en `SENT`. El resultado (`verified: true | false | null`) sale en el recibo como "verificado"/"sin verificar" y en el resumen ("Comprobado en tu Calendario.").
- **Informa**: la personalidad exige un cierre concreto ("Ya lo hice. Este fue el resultado.") y nunca decir "listo" sin confirmación de la herramienta.

## Variables de entorno nuevas

| Variable | Sesión | Para qué |
|---|---|---|
| `GROQ_API_KEY` | 6 | Respaldo automático cuando Gemini alcanza su límite |
| `CONNECTOR_SECRET` | 9 | Clave para cifrar los tokens guardados; necesaria para conectar Gmail |
| `GITHUB_TOKEN` / `EDDIE_OWNER_EMAIL` | Eval 4 | Conector de GitHub: token fine-grained del dueño y correo(s) de Google autorizados a usarlo |
| `TELEGRAM_BOT_TOKEN` | 17 | Bot de Telegram (token de @BotFather) |
| `TELEGRAM_WEBHOOK_SECRET` | 17 | Verifica que los mensajes vienen de Telegram |
| `TAVILY_API_KEY` | 13 | Búsqueda web con Tavily (opcional: funciona sin clave con un límite bajo) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | 23 | Spotify |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | 25 | Notion |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` / `WHATSAPP_VERIFY_TOKEN` | 27 | WhatsApp Cloud API |
| `CRON_SECRET` | 16 | Protege las tareas programadas |

## Claves que hay que crear (sesión 1)

1. **Groq** — entra a https://console.groq.com, crea una cuenta gratis y luego ve a *API Keys* → *Create API Key*. Guárdala como `GROQ_API_KEY` en Vercel (*Settings → Environment Variables*).
2. **Bot de Telegram** — en Telegram abre `@BotFather`, envía `/newbot` y elige un nombre (ej. "Eddie") y un usuario que termine en `bot`. Te devuelve un token que va como `TELEGRAM_BOT_TOKEN`.
3. **Gmail en Google Cloud** — en el mismo proyecto del login actual: *APIs y servicios → Biblioteca → Gmail API → Habilitar*. Luego, en *Pantalla de consentimiento OAuth → Permisos*, agrega `gmail.readonly` y `gmail.send` (Eddie no pide `gmail.modify`: no puede borrar ni mover correos). Mientras la app esté "en prueba", agrega tu correo como usuario de prueba; en ese modo Google hace caducar el acceso cada 7 días y hay que volver a pulsar "Conectar Gmail".
