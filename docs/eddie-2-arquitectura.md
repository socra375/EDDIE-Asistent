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
| `TELEGRAM_BOT_TOKEN` | 17 | Bot de Telegram |
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
