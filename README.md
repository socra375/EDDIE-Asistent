# Eddie — Asistente virtual para estudiantes

Eddie es un asistente de IA con interfaz futurista (estilo HUD) pensado para
estudiantes: tutor académico, ayuda con programación, organización de tareas,
creación de documentos, investigación y una experiencia de voz completa
(Speech-to-Text y Text-to-Speech).

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
   └── api/_lib/providers.js → llama a Gemini o Claude según settings.provider
   ▼
Respuesta unificada { content, provider, model }
   ▼
Chat / Voz (TTS) / Historial (localStorage)
```

- `api/chat.js` es una función serverless de Vercel (Node runtime). Es el
  único lugar donde se leen `GEMINI_API_KEY` y `ANTHROPIC_API_KEY`.
- `server/dev-server.js` es un servidor Express local que expone la misma
  lógica (`api/_lib/*`) en `http://localhost:8787`, para poder desarrollar sin
  instalar la CLI de Vercel. Vite proxea `/api` hacia ese servidor en
  desarrollo (ver `vite.config.js`).
- El frontend (`src/`) solo habla con `/api/chat` y `/api/health`; nunca con
  Gemini o Claude directamente.

## Módulos

| Módulo | Qué hace |
| --- | --- |
| Chat | Conversación con Eddie, historial persistente, modos de respuesta (rápido, explicativo, tutor, técnico, investigación, creativo) |
| Voz | Control de micrófono (STT), lectura en voz alta (TTS), selección de voz/idioma/velocidad/tono/volumen |
| Estudio | Tutor: explicaciones, resúmenes, cuestionarios, flashcards, esquemas, planes de repaso |
| Programación | Explicar, depurar, refactorizar código y generar ejemplos |
| Tareas | Lista de tareas con prioridad, fecha de entrega, recordatorio de la más próxima y, con sesión iniciada, sincronización entre dispositivos + botón para agregarlas a Google Calendar |
| Documentos | Genera resúmenes/informes/guías/cuestionarios, los exporta a TXT, CSV, DOCX o PDF y, con sesión iniciada, permite guardarlos directamente en Google Drive |
| Configuración | Proveedor y modelo de IA, idioma, tema, historial de conversaciones (ver/abrir/eliminar), memoria (ver/eliminar), cuenta de Google (iniciar/cerrar sesión, eliminar cuenta) |

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

Puedes configurar solo una o ambas. Si seleccionas en Configuración un
proveedor sin clave, Eddie lo indicará claramente en lugar de fallar en
silencio, y la petición devuelve un error 503 explicando qué falta.

## Cuenta de Google (login, Calendar, Drive)

Esta parte es **opcional**: sin configurarla, Eddie funciona exactamente
igual que antes (todo se guarda en `localStorage` del navegador, sin
cuentas). Configurándola, los usuarios pueden iniciar sesión con Google
para:

- Sincronizar tareas, configuración y memoria entre dispositivos.
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

- **STT**: botón de micrófono, transcripción en tiempo real, manejo de
  permisos denegados y aviso si el navegador no es compatible.
- **TTS**: lee las respuestas de Eddie (manual o automáticamente si activas
  "leer respuestas en voz alta" en Voz/Configuración). La lista de voces
  disponibles depende del navegador/SO — Eddie detecta las voces instaladas y
  te deja elegir una, en vez de asumir que existe una voz grave específica.

Compatibilidad: mejor soporte en Chrome/Edge. Safari y Firefox tienen soporte
parcial o distinto del estándar; si el navegador no implementa
`SpeechRecognition`, Eddie lo indica y el chat sigue funcionando por texto.

## Exportación de documentos

- **TXT / CSV**: generados como Blob y descargados directamente.
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
3. En "Environment Variables" añade `GEMINI_API_KEY` y/o `ANTHROPIC_API_KEY`
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
funciones serverless por despliegue. El proyecto usa 10 (agrupando
endpoints relacionados de bajo tráfico en un mismo archivo, p. ej.
`api/auth/session.js` maneja GET/POST/DELETE para me/logout/eliminar
cuenta, y `api/tasks/[[...id]].js` maneja tanto `/api/tasks` como
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
  _lib/googleCredentials.js  Guardar/renovar tokens de Google por usuario
  _lib/session.js        Sesiones opaco por cookie
  _lib/cookies.js, respond.js, httpErrors.js  Utilidades HTTP compartidas
  _lib/authHandlers.js, calendarHandlers.js, driveHandlers.js,
       tasksHandlers.js, settingsHandlers.js, memoryHandlers.js
                         Lógica de cada grupo de endpoints (independiente de la plataforma)
  chat.js, health.js
  auth/google/start.js, auth/google/callback.js
  auth/session.js        GET/POST/DELETE = me / logout / eliminar cuenta (un solo archivo)
  calendar/events.js, drive/save.js
  tasks/[[...id]].js     GET/POST sin id, PATCH/DELETE con id (un solo archivo)
  settings/index.js, memory/index.js
db/
  migrations/0001_eddie_accounts.sql  Esquema Postgres (usuarios, sesiones, tareas, etc.)
server/
  dev-server.js        Servidor Express que replica todas las rutas de api/ en local
src/
  components/          Chat, Voice, Study, Code, Tasks, Documents, Settings, Core, Layout, Shared
  context/             SettingsContext, AuthContext, VoiceContext, ChatContext
  hooks/               useSpeechRecognition, useSpeechSynthesis, useProviderHealth
  services/            api.js (chat), remote.js (tasks/settings/memory/calendar/drive), personality.js
  utils/               storage.js (localStorage), export.js (TXT/CSV/DOC/PDF)
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
