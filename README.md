# Eddie — Asistente personal

Eddie es un asistente personal con interfaz estilo HUD, pensado para usarse
por voz o por texto: organiza tu día y tus tareas, consulta hora y clima
reales, te ayuda a estudiar, revisa código y redacta documentos y correos,
con una experiencia de voz completa (Speech-to-Text y Text-to-Speech).

La aplicación es funcional de extremo a extremo: el frontend nunca ve las
claves de API, todas las llamadas a los proveedores de IA pasan por un
backend/función serverless que las protege.

## Arquitectura

```
Navegador (React + Vite)
   │  fetch('/api/chat')
   ▼
Backend (Express en local · función serverless en Vercel)
   │
   ├── api/_lib/handler.js   → valida y normaliza la solicitud
   ├── api/_lib/providers.js → llama a Gemini, Claude, Groq u OpenRouter (con respaldo automático)
   └── api/_lib/connectors/  → herramientas de los conectores activos (hora, calculadora, clima, tareas, internet, noticias, Wikipedia, monedas…)
   ▼
Respuesta unificada { content, provider, model }
   ▼
Chat / Historial (localStorage), leído en voz alta si "Voz" está activado en Configuración
```

- `api/chat.js` es una función serverless de Vercel (Node runtime). Es el
  único lugar donde se leen `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` y
  `GROQ_API_KEY`.
- `server/dev-server.js` es un servidor Express local que expone la misma
  lógica (`api/_lib/*`) en `http://localhost:8787`, para poder desarrollar sin
  instalar la CLI de Vercel. Vite proxea `/api` hacia ese servidor en
  desarrollo (ver `vite.config.js`).
- El frontend (`src/`) solo habla con `/api/chat` y `/api/health`; nunca con
  Gemini o Claude directamente.

## Módulos

| Módulo | Qué hace |
| --- | --- |
| Inicio | Anillo central para hablar con Eddie (escuchando, procesando, hablando…), paneles de tiempo, ubicación, clima, sistema y tareas, y el chat como panel lateral |
| Hoy | El día de un vistazo: saludo, agenda de hoy y mañana (Google Calendar), correos importantes sin leer (Gmail), tareas pendientes (vencidas primero), clima y titulares de noticias. Cada tarjeta explica qué falta si está vacía (iniciar sesión, conectar Gmail, conector apagado) y el botón "Resumen del día con Eddie" le pide que te lo cuente con sus herramientas, por voz si está activa. Se actualiza solo cada 5 minutos |
| Chat | Conversación con Eddie (con dictado por micrófono), historial persistente, estilos de respuesta y habilidades: Estudio (explicaciones, resúmenes, cuestionarios, flashcards, esquemas, planes de repaso), Código (explicar, depurar, refactorizar, generar ejemplos) y Documentos (resúmenes, informes, guías, esquemas, correos). Las respuestas se copian o exportan a TXT, DOC o PDF y, con sesión iniciada, se guardan en Google Drive |
| Tareas | Lista de tareas con prioridad, fecha de entrega, recordatorio de la más próxima y, con sesión iniciada, sincronización entre dispositivos + botón para agregarlas a Google Calendar. Eddie conoce tus pendientes al responder |
| Conectores | Qué servicios puede usar Eddie y en qué estado están (listo, conectado, por conectar, falta configurar, próximamente). Cada conector se enciende o apaga: al apagarlo, sus herramientas dejan de ofrecerse en el chat. Hoy: hora y fecha, clima, y Google Calendar y Drive |
| Configuración | Proveedor y modelo de IA, idioma, tema, lectura de respuestas en voz alta (on/off), historial de conversaciones (ver/abrir/eliminar), memoria (ver/eliminar), cuenta de Google (iniciar/cerrar sesión, eliminar cuenta) |

Además, Eddie tiene acceso a datos reales en tiempo real (no inventados):
un reloj en vivo en la barra superior, y herramientas que Gemini puede
invocar para consultar la hora/fecha exacta y el clima actual (usando la
ubicación del navegador, si el usuario la comparte, o una ciudad que
mencione).

## Requisitos

- Node.js 18 o superior.
- Una clave de API de al menos un proveedor:
  - Google Gemini: https://aistudio.google.com/app/apikey
  - Anthropic Claude: https://console.anthropic.com/settings/keys

## Instalación y ejecución local

```bash
npm install
cp .env.example .env
# Edita .env y coloca al menos una clave (GEMINI_API_KEY o ANTHROPIC_API_KEY)

npm run dev:full
```

`npm run dev:full` levanta a la vez:
- el backend local en `http://localhost:8787`
- el frontend (Vite) en `http://localhost:5173`, con `/api` proxeado al backend

También puedes ejecutarlos por separado: `npm run server` y, en otra
terminal, `npm run dev`.

Abre `http://localhost:5173`. En **Configuración** puedes elegir el proveedor
(Gemini o Claude); un indicador te dice si el proveedor tiene su clave
configurada en el servidor.

## Configurar las claves de API

Las claves **nunca** deben ir en el código ni en el frontend. Se leen
exclusivamente desde variables de entorno del backend:

- `GEMINI_API_KEY` — habilita el proveedor Gemini.
- `ANTHROPIC_API_KEY` — habilita el proveedor Claude.
- `OPENROUTER_API_KEY` — habilita OpenRouter (https://openrouter.ai/keys): una
  sola clave para cientos de modelos. Por defecto usa `openrouter/free`, que
  elige un modelo gratuito en cada petición (los gratuitos permiten 20
  solicitudes por minuto y 50 al día; con 10 USD de créditos, comprados una
  sola vez, el límite diario sube a 1.000). En Configuración → Proveedor de
  IA puedes elegir `openrouter/auto` o escribir el id de cualquier modelo de
  https://openrouter.ai/models. También funciona como **respaldo**: si el
  proveedor elegido falla, responde primero Groq y, si tampoco puede,
  OpenRouter. `OPENROUTER_MODEL` (opcional) cambia el modelo predeterminado.
- `GROQ_API_KEY` — habilita Groq (modelo `openai/gpt-oss-120b`, gratis y muy rápido), como
  proveedor elegible y como **respaldo automático**: si el proveedor elegido
  falla antes de empezar a responder (límite gratuito, saturación, tiempo
  agotado o clave faltante), Groq responde en su lugar y la respuesta lleva
  la etiqueta "vía Groq". `GROQ_MODEL` (opcional) cambia el modelo de Groq
  sin tocar el código; si Groq retira el modelo, Eddie consulta la lista de
  modelos vigentes de Groq y cambia solo.
  La misma clave activa el **reconocimiento de voz con Whisper**: Eddie
  graba lo que dices y lo transcribe en Groq con `whisper-large-v3-turbo`
  (más preciso que el reconocimiento del navegador). `GROQ_STT_MODEL`
  (opcional) lo cambia, p. ej. a `whisper-large-v3`. Sin la clave, o si
  eliges "El del navegador" en Configuración → Voz, se usa la Web Speech API.
- `TAVILY_API_KEY` — (opcional) la **búsqueda web** funciona sin clave con
  un límite bajo; una clave gratis de https://app.tavily.com (1.000
  búsquedas al mes) lo amplía. Noticias, Wikipedia, monedas y tareas no
  necesitan ninguna clave.
- `ELEVENLABS_API_KEY` — (opcional) la **voz propia de Eddie**: las
  respuestas se leen con ElevenLabs usando la voz `bUQeiO7gn4ehGuSnZf26`
  y el modelo `eleven_flash_v2_5` (en español, rápido y a mitad de
  créditos). `ELEVENLABS_VOICE_ID` y `ELEVENLABS_MODEL` los cambian. Sin la
  clave, si se acaban los créditos o si la voz no está permitida en tu plan
  (el plan gratis no puede usar voces de la biblioteca por API), Eddie
  sigue con la voz del navegador y Configuración → Voz explica por qué.

Puedes configurar solo una o ambas. Si seleccionas en Configuración un
proveedor sin clave, Eddie lo indicará claramente en lugar de fallar en
silencio, y la petición devuelve un error 503 explicando qué falta.

## Cuenta de Google (login, Calendar, Drive)

Esta parte es **opcional**: sin configurarla, Eddie funciona exactamente
igual que antes (todo se guarda en `localStorage` del navegador, sin
cuentas). Configurándola, los usuarios pueden iniciar sesión con Google
para:

- Sincronizar tareas, configuración y memoria entre dispositivos.
- Pedirle a Eddie tu agenda ("¿qué tengo mañana?"), crear eventos y
  moverlos o borrarlos con confirmación.
- Agregar tareas con fecha de entrega a Google Calendar (permiso limitado
  a `calendar.events`, no a todo el calendario).
- Guardar los documentos que genera Eddie directamente en Google Drive
  (permiso limitado a `drive.file`: solo archivos que la propia app crea,
  nunca el Drive completo del usuario).

### 1. Base de datos (Postgres)

Se necesita una base de datos Postgres para guardar cuentas, tareas,
configuración y memoria de los usuarios que inician sesión. Recomendado:
[Neon](https://neon.tech) (plan gratuito, sin tarjeta):

1. Crea un proyecto en Neon y copia su cadena de conexión.
2. Ejecuta el script `db/migrations/0001_eddie_accounts.sql` contra esa
   base de datos (desde el editor SQL de Neon, o con `psql "$DATABASE_URL" -f db/migrations/0001_eddie_accounts.sql`).
3. Guarda esa cadena de conexión como `DATABASE_URL`.

Cualquier Postgres sirve (Neon, Supabase, Railway, RDS...); el esquema es
SQL estándar sin dependencias específicas de un proveedor.

### 2. Credenciales de Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/) y crea
   (o reutiliza) un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: configúrala
   en modo "Externo" (o "Interno" si usas Google Workspace), con el nombre
   de la app y tu correo de soporte.
3. **APIs y servicios → Biblioteca**: habilita **Google Calendar API** y
   **Google Drive API**.
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente
   de OAuth**, tipo "Aplicación web". En "URI de redireccionamiento
   autorizados" añade exactamente:
   - Local: `http://localhost:8787/api/auth/google/callback`
   - Producción: `https://TU-DOMINIO.vercel.app/api/auth/google/callback`
5. Copia el **Client ID** y el **Client Secret** que genera.

### 3. Variables de entorno

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback   # o tu dominio en producción
APP_URL=http://localhost:5173                                        # o tu dominio en producción
DATABASE_URL=postgres://...
```

`GOOGLE_CLIENT_SECRET` y `DATABASE_URL` son secretos de servidor: van en
`.env` local y en las variables de entorno de Vercel, **nunca** en el
frontend ni en el repositorio. Configuración → Cuenta de Google muestra un
aviso si falta alguna de `DATABASE_URL` o `GOOGLE_CLIENT_ID`/`SECRET`, en
vez de fallar en silencio.

### 4. Gmail (opcional)

Eddie puede buscar, leer y resumir tus correos, y enviarlos o responderlos
**siempre con tu confirmación** (tarjeta con Enviar / Editar / Cancelar).
Gmail se conecta aparte del login, desde el módulo **Conectores → Conectar
Gmail**, y solo pide leer (`gmail.readonly`) y enviar (`gmail.send`): Eddie
no puede borrar correos.

1. En el mismo proyecto de Google Cloud: **Biblioteca → Gmail API →
   Habilitar**.
2. **Pantalla de consentimiento → Permisos (scopes)**: agrega
   `.../auth/gmail.readonly` y `.../auth/gmail.send`. Mientras la app esté
   en modo "Prueba", agrega tu correo en **Usuarios de prueba**. (En modo
   prueba Google hace caducar el acceso cada 7 días: si Eddie dice que
   vuelvas a conectar Gmail, pulsa el botón otra vez.)
3. En Vercel agrega `CONNECTOR_SECRET`: un texto aleatorio de al menos 16
   caracteres (mejor 40). Con él se cifran en la base de datos los accesos a
   Google (AES-256-GCM); sin él, el botón de Gmail avisa que falta. No lo
   cambies después: los accesos guardados dejarían de poder leerse y
   habría que volver a conectar.

### Cómo funciona el login (para quien quiera entender/tocar el código)

Es un flujo OAuth 2.0 "Authorization Code" implementado a mano (sin SDK de
Google) con protección CSRF por `state` y sesiones propias:

1. `GET /api/auth/google/start` genera un `state` aleatorio, lo guarda en
   una cookie de corta duración y redirige a Google.
2. Google redirige de vuelta a `GET /api/auth/google/callback` con un
   `code`. El backend valida el `state`, intercambia el `code` por tokens,
   obtiene el perfil del usuario, crea/actualiza su fila en `users` y una
   sesión opaca en `sessions` (el navegador solo recibe el id de sesión en
   una cookie `HttpOnly; Secure`).
3. Cada request autenticado (`/api/tasks`, `/api/settings`, `/api/memory`,
   `/api/calendar/*`, `/api/drive/*`) resuelve el usuario a partir de esa
   cookie — el frontend nunca ve ni maneja tokens de Google directamente.
4. Los tokens de Calendar/Drive se guardan en `google_credentials` y se
   renuevan automáticamente con el `refresh_token` cuando expiran.

## Voz (Speech-to-Text / Text-to-Speech)

Eddie usa la **Web Speech API** del navegador (sin dependencias externas):

- **STT**: el botón de micrófono en el Chat dicta el mensaje con
  transcripción en tiempo real, maneja permisos denegados y avisa si el
  navegador no es compatible.
- **TTS**: si activas "Eddie lee sus respuestas en voz alta" en
  Configuración, cada respuesta se lee automáticamente en cuanto llega, con
  la voz/velocidad/tono/volumen por defecto del navegador para el idioma
  activo — no hay selector de voz, es un simple interruptor on/off.

Compatibilidad: mejor soporte en Chrome/Edge. Safari y Firefox tienen soporte
parcial o distinto del estándar; si el navegador no implementa
`SpeechRecognition`/`speechSynthesis`, Eddie lo indica y el chat sigue
funcionando por texto.

## Exportación de documentos

- **TXT**: generado como Blob y descargado directamente.
- **DOCX**: se genera un archivo `.doc` con contenido HTML válido, que Word y
  LibreOffice abren de forma nativa. No es un `.docx` binario real (eso
  requeriría una librería adicional), pero el resultado es un documento
  editable con el mismo contenido.
- **PDF**: se abre una ventana de impresión con el documento formateado y se
  invoca el diálogo de impresión del navegador ("Guardar como PDF"). Esto
  evita añadir una dependencia pesada solo para generar PDFs y funciona en
  cualquier navegador moderno.

## Seguridad y privacidad

- Las claves de API y el Client Secret de Google solo existen en variables
  de entorno del servidor; nunca se envían al navegador.
- Toda solicitud a `/api/chat` se valida (proveedor permitido, longitud de
  mensajes, tamaño del historial) antes de reenviarse al proveedor.
- Sin iniciar sesión: el historial de conversación, las tareas y la
  memoria se guardan solo en `localStorage` del navegador — no se envían a
  ningún servidor propio ni de terceros salvo el contenido de los mensajes
  que decides enviar a Eddie.
- Con sesión de Google iniciada: tareas, configuración y memoria también
  se guardan en la base de datos, asociadas a tu cuenta, para poder
  sincronizarlas entre dispositivos. La sesión es un id aleatorio opaco en
  una cookie `HttpOnly; Secure; SameSite=Lax` (no un token manipulable) que
  el backend resuelve contra la tabla `sessions`; cerrar sesión la borra
  del servidor de inmediato. El acceso a Calendar/Drive se pide con el
  permiso mínimo necesario (`calendar.events`, `drive.file`, no el
  calendario ni el Drive completos).
- Puedes borrar el historial de conversación y la memoria, cerrar sesión, o
  eliminar tu cuenta y todos tus datos del servidor en cualquier momento
  desde Configuración.
- CORS restringido a los métodos necesarios; sin ejecución de código
  arbitrario en el navegador.

## Despliegue

### Opción recomendada: Vercel (frontend + backend en un solo proyecto)

1. Sube el repositorio a GitHub.
2. Importa el repo en Vercel.
3. En "Environment Variables" añade `GEMINI_API_KEY`, `GROQ_API_KEY` y/o
   `ANTHROPIC_API_KEY`
   y, si vas a habilitar el login con Google, también `DATABASE_URL`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (con tu
   dominio de Vercel) y `APP_URL` (el mismo dominio).
4. Si usas Google Sign-In, actualiza también el "URI de redireccionamiento
   autorizado" en Google Cloud Console con ese mismo dominio.
5. Vercel detecta `vercel.json`: construye el frontend con Vite (`dist/`) y
   despliega cada archivo bajo `api/` como una función serverless.

Mismo dominio para frontend y API — no se requiere configuración de CORS
adicional, y las cookies de sesión funcionan de forma nativa.

**Nota sobre el plan gratuito (Hobby) de Vercel**: tiene un límite de 12
funciones serverless por despliegue. El proyecto usa 11 (agrupando
endpoints relacionados de bajo tráfico en un mismo archivo, p. ej.
`api/auth/session.js` maneja GET/POST/DELETE para me/logout/eliminar
cuenta, y `api/tasks.js` maneja tanto `/api/tasks` como
`/api/tasks/<id>`). Si agregas nuevos endpoints, ten en cuenta ese límite
o pasa a un plan de pago.

### Alternativa: GitHub Pages (solo frontend) + backend aparte

GitHub Pages solo sirve archivos estáticos, así que **no puede** alojar las
funciones serverless ni guardar las claves de forma segura. Si usas GitHub
Pages para el frontend:

1. Despliega `api/` como backend independiente (Vercel Functions, Render,
   Railway, o el propio `server/dev-server.js` detrás de un proceso Node
   persistente) y configura ahí las variables de entorno.
2. Publica el frontend en GitHub Pages (`npm run build`, sube `dist/`).
3. Antes de compilar, define la URL del backend, por ejemplo con una
   variable `VITE_API_BASE_URL`, y ajusta `src/services/api.js` para usar
   `${import.meta.env.VITE_API_BASE_URL}/api/chat` en vez de una ruta
   relativa.

En ningún caso coloques las claves de API en el repositorio público ni en el
bundle del frontend.

**Nota sobre el login con Google en este esquema**: las sesiones usan una
cookie, que requiere que frontend y backend compartan dominio (o al menos
sean del mismo "site" para `SameSite=Lax`). Con frontend y backend en
dominios distintos (como en este esquema de GitHub Pages), el login con
Google no funcionará correctamente — esa función requiere el despliegue
conjunto en Vercel.

## Estructura del proyecto

```
api/                  Funciones serverless (Vercel) + lógica compartida
  _lib/handler.js       Validación de solicitudes de chat
  _lib/providers.js     Adaptadores Gemini / Claude
  _lib/db.js            Cliente Postgres (Neon) — solo backend
  _lib/google.js        OAuth de Google (autorizar/intercambiar/refrescar tokens)
  _lib/googleCredentials.js  Guardar (cifrados) y renovar tokens de Google por usuario
  _lib/secretBox.js      Cifrado AES-256-GCM de tokens con CONNECTOR_SECRET
  _lib/session.js        Sesiones opaco por cookie
  _lib/cookies.js, respond.js, httpErrors.js  Utilidades HTTP compartidas
  _lib/authHandlers.js, calendarHandlers.js, driveHandlers.js,
       tasksHandlers.js, settingsHandlers.js, memoryHandlers.js
                         Lógica de cada grupo de endpoints (independiente de la plataforma)
  chat.js, health.js
  auth/google/start.js, auth/google/callback.js
  auth/session.js        GET/POST/DELETE = me / logout / eliminar cuenta (un solo archivo)
  calendar/events.js, drive/save.js
  tasks.js               GET/POST sin id, PATCH/DELETE con id (un solo archivo + reescritura en vercel.json)
  settings/index.js, memory/index.js
  connectors.js          GET /api/connectors (y, más adelante, OAuth y webhooks de conectores)
  _lib/connectors/       Registro de conectores (registry.js) y uno por carpeta: agent, clock, calculator, weather, tasks, websearch, news, wikipedia, currency, gmail, google
db/
  migrations/0001_eddie_accounts.sql  Esquema Postgres (usuarios, sesiones, tareas, etc.)
server/
  dev-server.js        Servidor Express que replica todas las rutas de api/ en local
src/
  components/          Chat, Tasks, Settings, Core, Shared
  home/                Pantalla de Inicio (anillo de voz y paneles HUD)
  layout/              Barra de íconos, Mis chats, encabezado, logo, efectos HUD
  connectors/          Hub de conectores (tarjetas por estado e interruptores)
  context/             SettingsContext, AuthContext, VoiceContext, ChatContext
  hooks/               useWhisperRecognition, useSpeechRecognition, useSpeechSynthesis, useProviderHealth
  services/            api.js (chat), remote.js (tasks/settings/memory/calendar/drive), personality.js, skills.js, localAnswers.js
  utils/               storage.js (localStorage), export.js (TXT/DOC/PDF)
```

Documentación técnica más detallada, por capa:

- [`docs/html.md`](docs/html.md) — estructura de `index.html`, la app como
  SPA de una sola página, y el DOM que renderiza React.
- [`docs/css.md`](docs/css.md) — sistema de variables/tema (oscuro/claro),
  clases utilitarias, convención de CSS por componente y animaciones.
- [`docs/javascript.md`](docs/javascript.md) — arquitectura del frontend
  (contexts, hooks, servicios, utils) y del backend (`api/`, `server/`),
  con el flujo completo de un mensaje de chat.

## Limitaciones conocidas y alternativas

Algunas funciones "extra" del listado original no están implementadas en
esta primera versión porque requieren servicios adicionales (visión por
computadora, generación de imágenes, OCR de PDFs) que exigirían claves y
dependencias nuevas fuera del alcance de "solo Gemini/Claude + Web Speech
API". El sistema de proveedores está diseñado para poder añadir esas
integraciones más adelante sin rehacer la arquitectura (basta con crear un
nuevo adaptador en `api/_lib/providers.js`).

## Scripts

- `npm run dev` — solo frontend (Vite).
- `npm run server` — solo backend local (Express).
- `npm run dev:full` — ambos a la vez.
- `npm run build` — build de producción del frontend (`dist/`).
- `npm run preview` — sirve el build de producción localmente.
- `npm run lint` — linter (oxlint).
