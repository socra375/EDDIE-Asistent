# Eddie 2.0 — Estructura técnica

Guía de referencia para las 35 sesiones del plan de Eddie 2.0 (asistente personal, voz primero, conectores, luego app de escritorio). Define dónde vive cada pieza para que cada sesión sume sin reorganizar lo anterior.

## Principios

1. **Un solo cerebro en la nube.** La web, Telegram, WhatsApp y la app de escritorio hablan con el mismo backend (`api/`). Ningún canal tiene lógica propia de IA.
2. **Conectores como plugins.** Cada servicio externo (Gmail, Spotify, Notion…) es una carpeta autocontenida que declara su autorización y sus herramientas. Agregar uno nuevo no toca el resto.
3. **Nada irreversible sin confirmación.** Enviar, borrar, publicar o gastar pasa siempre por una confirmación explícita del usuario.
4. **Todo gratis por defecto.** Gemini como proveedor principal, Groq como respaldo; cada conector usa el plan gratuito de su servicio.

## Estructura de carpetas (destino)

```
api/
  chat.js                      ← sin cambios: entrada del chat (streaming NDJSON)
  connectors/[[...path]].js    ← NUEVO, una sola función para OAuth y webhooks de todos los conectores
  cron/[[...job]].js           ← NUEVO: tareas programadas (resumen matutino, recordatorios)
  _lib/
    providers.js               ← Gemini + Claude + Groq (respaldo automático)
    agent.js                   ← NUEVO: bucle de varios pasos + protocolo de confirmación
    connectors/
      registry.js              ← NUEVO: lista de conectores y sus herramientas activas
      core/                    ← hora y clima (hoy en tools.js)
      google/                  ← Gmail + Calendario + Drive (reutiliza google.js y googleCredentials.js)
      websearch/
      telegram/
      whatsapp/
      spotify/
      notion/
    memory/                    ← NUEVO: memoria vectorial (pgvector)
src/
  layout/                      ← IconRail, ChatList, Header (reemplazan Sidebar y TopBar)
  core/                        ← Orbe central con estados + botones flotantes
  chat/                        ← panel de chat lateral + tarjetas de confirmación
  today/                       ← panel "Hoy"
  connectors/                  ← hub de conectores (tarjetas conectar/desconectar)
  skills/                      ← Estudio, Código, Documentos como habilidades del chat
desktop/                       ← NUEVO (semana 8): app Tauri que envuelve la web
```

**Límite de Vercel Hobby (12 funciones):** hoy hay 10 archivos en `api/`. Por eso todos los conectores comparten `api/connectors/[[...path]].js` y todas las tareas programadas comparten `api/cron/[[...job]].js`, con el mismo patrón de ruta comodín que ya usa `api/tasks/[[...id]].js`. Eso deja el total en 12.

## Contrato de un conector

Cada carpeta en `api/_lib/connectors/<id>/` exporta un objeto con esta forma:

```js
export default {
  id: 'gmail',
  name: 'Gmail',
  auth: {                      // null si no necesita cuenta (ej. búsqueda web)
    type: 'oauth2',
    start(state) {},           // URL de autorización
    callback(query) {},        // intercambia el código y guarda tokens cifrados
  },
  tools: [
    {
      declaration: { name: 'gmail_search', description: '…', parameters: { … } },
      sensitive: false,        // true → requiere confirmación antes de ejecutarse
      run: async (args, ctx) => { … },
    },
  ],
  webhook: null,               // Telegram/WhatsApp: handler de mensajes entrantes
};
```

- La validación de argumentos, el aislamiento de fallos y los reintentos ya existen en `api/_lib/tools.js` y `api/_lib/fetchWithRetry.js`; el registro los reutiliza para todas las herramientas.
- Solo se ofrecen a la IA las herramientas de los conectores que el usuario tiene activos.
- Los tokens de cada conector se guardan cifrados en Postgres (tabla `connector_credentials`, AES-256-GCM con una clave en `CONNECTOR_SECRET`), igual que hoy se guardan los de Google en `googleCredentials.js`.

## Protocolo de confirmación

Cuando la IA pide una herramienta marcada `sensitive: true`, el agente no la ejecuta. En su lugar, el stream del chat emite un evento nuevo:

```
{"type":"confirm","id":"c_123","tool":"gmail_send","summary":"Enviar correo a Marcos: «Reunión mañana»","args":{…}}
```

La interfaz muestra la tarjeta Enviar / Editar / Cancelar y responde con `POST /api/chat` incluyendo `{ confirm: { id, approved } }`. Los canales Telegram y WhatsApp usan botones del propio mensaje para lo mismo.

## Variables de entorno nuevas

| Variable | Sesión | Para qué |
|---|---|---|
| `GROQ_API_KEY` | 6 | Respaldo automático cuando Gemini alcanza su límite |
| `CONNECTOR_SECRET` | 7 | Clave para cifrar tokens de conectores |
| `TELEGRAM_BOT_TOKEN` | 17 | Bot de Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | 17 | Verifica que los mensajes vienen de Telegram |
| `WEBSEARCH_API_KEY` | 13 | Proveedor de búsqueda web (plan gratis) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | 23 | Spotify |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | 25 | Notion |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` / `WHATSAPP_VERIFY_TOKEN` | 27 | WhatsApp Cloud API |
| `CRON_SECRET` | 16 | Protege las tareas programadas |

## Claves que hay que crear (sesión 1)

1. **Groq** — entra a https://console.groq.com, crea una cuenta gratis y luego ve a *API Keys* → *Create API Key*. Guárdala como `GROQ_API_KEY` en Vercel (*Settings → Environment Variables*).
2. **Bot de Telegram** — en Telegram abre `@BotFather`, envía `/newbot` y elige un nombre (ej. "Eddie") y un usuario que termine en `bot`. Te devuelve un token que va como `TELEGRAM_BOT_TOKEN`.
3. **Gmail en Google Cloud** — en el mismo proyecto del login actual: *APIs y servicios → Biblioteca → Gmail API → Habilitar*. Luego, en *Pantalla de consentimiento OAuth → Permisos*, agrega `gmail.readonly`, `gmail.send` y `gmail.modify`. Mientras la app esté "en prueba", agrega tu correo como usuario de prueba.
