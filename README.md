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
   └── api/_lib/connectors/  → herramientas de los conectores activos (hora, calculadora, clima, tareas, memoria, internet, noticias, Wikipedia, monedas, Gmail, Calendario, GitHub, Notion, YouTube, Recordatorios, Recuerdos de conversaciones, Telegram, WhatsApp, Sonda local…)
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
| Inicio | Panel estilo J.A.R.V.I.S.: a la izquierda Sistema (núcleos, memoria, batería, red), Clima (temperatura, humedad, viento, sensación), **Cámara** (Modo Vigilancia, ver más abajo), Tiempo activo (sesión, comandos, carga de Eddie) y Tareas; al centro el **orbe** (círculos concéntricos con cinco barras de sonido) con el nombre, el estado («Escuchando la palabra clave…», escuchando, procesando, hablando…) y los botones de cámara, micrófono y teclado; a la derecha la **Conversación** siempre visible (Limpiar y Exportar). En ventanas de menos de 1100 px la conversación pasa a ser un cajón que abre el botón de teclado, y de menos de 760 px todo va en una columna. El encabezado es una barra delgada: marca y estado «En línea», reloj y fecha, clima y chips. Es ligero a propósito: en reposo solo gira un aro fino, los estados activos se redibujan por pasos y cada parte móvil es su propia capa (solo cambia `transform`/`opacity`); sin desenfoques ni filtros de sombra (GPU en reposo ≈ 2 % en la medición con render por software). En Configuración → Pantalla, el **Modo ligero** (automático, siempre ligero o completo) apaga además la rejilla, las líneas y las animaciones; el automático se activa solo en equipos pequeños, si se pide menos movimiento o si la pantalla se ve lenta (menos de 20 cuadros por segundo) |
| Hoy | El día de un vistazo: saludo, agenda de hoy y mañana (Google Calendar), correos importantes sin leer (Gmail), tareas pendientes (vencidas primero), clima y titulares de noticias. Cada tarjeta explica qué falta si está vacía (iniciar sesión, conectar Gmail, conector apagado) y el botón "Resumen del día con Eddie" le pide que te lo cuente con sus herramientas, por voz si está activa. Se actualiza solo cada 5 minutos |
| Chat | Conversación con Eddie (con dictado por micrófono), historial persistente, estilos de respuesta y habilidades: Estudio (explicaciones, resúmenes, cuestionarios, flashcards, esquemas, planes de repaso), Código (explicar, depurar, refactorizar, generar ejemplos) y Documentos (resúmenes, informes, guías, esquemas, correos). Las respuestas se copian o exportan a TXT, DOC o PDF y, con sesión iniciada, se guardan en Google Drive |
| Tareas | Lista de tareas con prioridad, fecha de entrega, recordatorio de la más próxima y, con sesión iniciada, sincronización entre dispositivos + botón para agregarlas a Google Calendar. Eddie conoce tus pendientes al responder |
| Memoria | Lo que Eddie recuerda de ti, por categoría: perfil, preferencias, proyectos (estado, stack, último cambio, próximo objetivo), decisiones, conocimientos y contexto temporal (con fecha de vencimiento). Eddie guarda lo que le cuentas sin que se lo pidas (y te avisa), usa solo lo que viene al caso en cada respuesta y tú puedes añadir, editar y borrar todo; nunca guarda contraseñas ni tarjetas. Aquí también eliges la **palabra clave de activación** (por defecto "Eddie"): dila y Eddie te escucha sin tocar nada |
| Conectores | Qué servicios puede usar Eddie y en qué estado están (listo, conectado, por conectar, falta configurar, próximamente). Cada conector se enciende o apaga: al apagarlo, sus herramientas dejan de ofrecerse en el chat. Hoy: hora y fecha, clima, y Google Calendar y Drive |
| Configuración | Proveedor y modelo de IA, idioma, tema, lectura de respuestas en voz alta (on/off), historial de conversaciones (ver/abrir/eliminar), memoria (activar/borrar), cuenta de Google (iniciar/cerrar sesión, eliminar cuenta) |

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
- `YOUTUBE_API_KEY` — (opcional) la clave de la API de YouTube Data v3 para que Eddie elija con fiabilidad el
  video que reproduce (ver la sección YouTube). Sin ella usa la página de resultados.
- `TAVILY_API_KEY` — (opcional) la **búsqueda web** funciona sin clave con
  un límite bajo; una clave gratis de https://app.tavily.com (1.000
  búsquedas al mes) lo amplía. Noticias, Wikipedia, monedas y tareas no
  necesitan ninguna clave.
- `GITHUB_TOKEN` y `EDDIE_OWNER_EMAIL` — (opcionales, van juntas) activan el
  conector de **GitHub** (ver repositorios, actividad, issues y PR; crear
  issues y comentarios con confirmación). `GITHUB_TOKEN` es un token de
  acceso personal *fine-grained* (GitHub → Settings → Developer settings →
  Fine-grained tokens) con permisos de solo lectura en *Contents*, *Issues*,
  *Pull requests* y *Metadata* y, si quieres que Eddie cree issues y
  comentarios, *Issues: Read and write*; elige solo los repositorios que
  quieras. `EDDIE_OWNER_EMAIL` es tu correo de Google (varios, separados por
  comas): como el token abre tus repositorios privados, las herramientas
  solo responden a quien haya iniciado sesión con ese correo. La clave vive
  solo en Vercel (nunca en el navegador ni en la base de datos); pégala en
  Vercel → Settings → Environment Variables y vuelve a desplegar, y nunca en
  un chat.
- `NOTION_TOKEN` (y `EDDIE_OWNER_EMAIL`, la misma de GitHub) — (opcionales) activan el conector de **Notion**
  (ver la sección Notion). `NOTION_PARENT_PAGE_ID` es opcional: la página donde Eddie crea las notas cuando no
  le dices otra.
- `ELEVENLABS_API_KEY` — (opcional) la **voz propia de Eddie**: las
  respuestas se leen con ElevenLabs usando la voz `bUQeiO7gn4ehGuSnZf26`
  y el modelo `eleven_flash_v2_5` (en español, rápido y a mitad de
  créditos). `ELEVENLABS_VOICE_ID` y `ELEVENLABS_MODEL` los cambian; el tono se ajusta con
  `ELEVENLABS_STABILITY` (0,45 por defecto: más bajo = más expresiva), `ELEVENLABS_SIMILARITY` (0,8)
  y `ELEVENLABS_STYLE` (0,15), valores de 0 a 1. Sin la
  clave, si se acaban los créditos o si la voz no está permitida en tu plan
  (el plan gratis no puede usar voces de la biblioteca por API), Eddie
  sigue con la voz del navegador y Configuración → Voz explica por qué.
- `ELEVENLABS_VOICES` — (opcional) **más voces para elegir** en Configuración → Voz, como pares `Nombre:VoiceID`
  separados por comas (`Mayordomo:abc123…,Cercano:def456…`, hasta 12). La de `ELEVENLABS_VOICE_ID` sigue siendo la
  de por defecto. El servidor solo habla con las voces de esa lista, y la que elijas también se usa en las notas de voz
  de Telegram y WhatsApp. Usa voces creadas por ti (Voice Design o clonadas): el plan gratis no permite por API las de
  la biblioteca.

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

## YouTube

Pídele a Eddie "abre YouTube" o "busca un tutorial de React en YouTube": abre **una pestaña nueva** con
YouTube o con los resultados de esa búsqueda (por chat, por voz o con la palabra clave). Si le pides
**poner algo** ("ponme música de salsa", "reproduce el tráiler de Dune"), elige el primer video y lo
**reproduce él mismo** en un reproductor flotante dentro de Eddie (sin ventanas emergentes), con el título
y el canal; puedes decirle "pausa el video", "sigue" o "cierra el video". Si YouTube no deja reproducir ese
video fuera de su sitio (algunos de música), el reproductor lo avisa y deja un botón para verlo en YouTube.
Solo abre direcciones de YouTube (`youtube.com`, `music.youtube.com`, `youtu.be`), nada más.

Para elegir el video usa la API de YouTube si existe `YOUTUBE_API_KEY` (gratis, unas 100 búsquedas al día; se
crea en Google Cloud → habilitar "YouTube Data API v3" → Credenciales → Clave de API, restringida a esa API, y
se pone en las variables de entorno de Vercel, nunca en el código ni en el chat). Sin clave lee la página de
resultados de YouTube, que no es una API oficial y puede fallar; en ese caso Eddie abre la lista de resultados
y te lo dice.

Los navegadores solo dejan abrir una ventana tras un clic. Por eso, si lo pides por voz o la respuesta
tarda, el navegador puede bloquearla: Eddie deja debajo de su respuesta (y en Inicio) un botón
"Abrir YouTube: …" y un clic la abre. Para que se abra sola, permite las ventanas emergentes de este
sitio (el icono del candado o de "ventana bloqueada" en la barra de direcciones). En Telegram manda el
enlace con un botón "Abrir" que lo abre en el teléfono (o en la app de YouTube). Se enciende o apaga en
Conectores → YouTube. (En Telegram, cuando pide poner algo manda el enlace del video con un botón "Reproducir".)

## Palabra clave de activación

En **Memoria → Palabra clave de activación** activas "Escuchar la palabra clave" y eliges la
palabra o frase (por defecto "Eddie"; acepta "Jarvis", "computadora central"…). Con Eddie
abierto en una pestaña, basta decirla:

- **"Eddie, ¿qué tengo hoy?"** — lo que sigue a la palabra se envía tal cual.
- **"Eddie"** solo — se abre el micrófono y lo que digas después se envía al terminar.

**Tiempo de espera** (por defecto 5 s, de 0 a 30): cuando Eddie termina de contestar —y de hablar—
abre el micrófono ese tiempo para que sigas la conversación **sin repetir la palabra**. Si empiezas a
hablar, se envía y, tras la siguiente respuesta, vuelve a abrirse; si no dices nada, se cierra y Eddie
vuelve a esperar la palabra clave. Con 0 hay que decirla cada vez. Solo se aplica a las conversaciones
que empezaste con la palabra (no a las del orbe de Inicio ni a las del chat); la tarjeta muestra
"tienes N s para responder" mientras la ventana está abierta.

**Apagar el micrófono:** di **"Eddie, suspéndete"** o **"apágate"** (también "desactiva el micrófono",
"duérmete", "ya no me escuches"; funciona igual con tu palabra clave, sola o dentro de la ventana de espera,
y también escrito en el chat). Eddie apaga "Escuchar la palabra clave" y te lo confirma. Como con el
micrófono apagado ya no puede oírte, para volver a encenderlo hay que activar el interruptor en
**Memoria → Palabra clave de activación**. Solo se entiende si es la orden completa: "apágate la luz" o
"suspende la reunión" se tratan como una frase normal.

Solo reacciona si la palabra va **al principio** de la frase (admite "oye", "hey", "hola" delante),
así que hablar *de* Eddie ("le dije a Eddie que…") no lo despierta. Se pausa mientras Eddie te
escucha, piensa o habla (así no se despierta con su propia voz) y, al despertarlo por voz,
activa la lectura de respuestas en voz alta. Usa el reconocimiento de voz del navegador (en
Chrome el audio lo procesa el servicio de voz de Google): funciona en Chrome y Edge, con la
pestaña abierta y el permiso del micrófono; no funciona con la pantalla apagada ni en Firefox.
Si el navegador bloquea el micrófono, la tarjeta lo dice y ofrece "Reintentar".

## Visión (Eddie ve imágenes)

En el chat puedes **adjuntar una imagen** (botón de la imagen; en el teléfono también hay botón de cámara),
**pegarla** (Ctrl+V sobre el cuadro de texto) o **arrastrarla** encima del chat; hasta 3 por mensaje, con o sin
pregunta ("¿qué planta es esta?", "resuelve este ejercicio", "lee este texto"). En **Telegram** basta con
mandarle una foto (con la pregunta como pie de foto, o sin ella).

- **Qué ve la IA**: las imágenes se leen con **Gemini o Claude** (los modelos de Groq y OpenRouter que usa Eddie
  no ven imágenes). Si tienes elegido Groq u OpenRouter, para ese mensaje Eddie usa Gemini (o Claude si no hay
  clave de Gemini); si ninguno está configurado, lo dice.
- **Tu privacidad**: la imagen se reduce en tu navegador (JPEG, lado mayor de 1280 px) antes de salir; viaja
  una sola vez con ese mensaje al proveedor de IA y **el servidor no la guarda**. En la conversación guardada
  queda solo una miniatura. Eddie puede seguir hablando de las últimas imágenes mientras no recargues la página;
  luego sabe que había una, pero pide que la vuelvas a mandar si hace falta verla de nuevo. La memoria de
  conversaciones solo guarda el texto.
- **Límites**: no se pueden leer las HEIC del iPhone (sácalas como JPG o captura de pantalla), 25 MB máximo de
  origen, 3 imágenes por mensaje (Vercel solo acepta ~4,5 MB por petición). En Telegram, las imágenes
  mandadas como archivo deben pesar menos de unos 900 KB; como foto normal no hay problema.

## Modo Vigilancia (cámara con visión por IA)

Di **«Modo Vigilancia»** (o «Eddie, activa el modo vigilancia»; también escrito en la conversación, o con el botón de la
cámara bajo el orbe o el de encendido del panel **Cámara**) y Eddie enciende la cámara de tu equipo y empieza a
identificar **objetos, personas, animales y materiales**. Para apagarla: «desactiva el modo vigilancia», «modo normal»,
el chip rojo **● VIGILANCIA · ON** del encabezado (se ve en cualquier pantalla) o el botón de encendido.

- **Qué se ve**: el video con una caja y una etiqueta sobre cada cosa que la IA encontró (rojo = personas, verde =
  animales, ámbar = objetos), la lista con categoría, material (vidrio, madera, metal, plástico, tela…), detalle y
  confianza, y un **registro de eventos** («Persona detectado», «Perro: ya no está») con confirmación en dos análisis
  seguidos para que no parpadee. Con la voz activada, Eddie **avisa en voz alta** cuando aparece o se va una persona o un
  animal (máx. uno cada 15 s y la misma cosa no antes de 60 s). Con la cámara encendida, pregunta **«¿qué ves?»**: la
  imagen actual viaja con la pregunta por el chat y Eddie te lo cuenta con sus palabras.
- **Cómo funciona**: cada 5 s (3–15 en Configuración → Cámara · Modo Vigilancia) el navegador compara un cuadro pequeño
  con el anterior y **solo si la escena cambió** (o pasaron 30 s) manda un fotograma de 640 px a
  `POST /api/chat?action=vision` (no hay función nueva en Vercel). El servidor lo analiza con **Gemini**
  (`GEMINI_VISION_MODEL`, por defecto `gemini-flash-latest`) y, si Gemini está ocupado o no configurado, con **Claude**
  (`CLAUDE_VISION_MODEL`, por defecto `claude-haiku-4-5-20251001`); la respuesta se recorta a una forma fija (máx. 12
  elementos, etiquetas cortas, cajas en rango) antes de llegar a la página. `VISION_MAX_PER_MINUTE` (20 por defecto)
  limita los fotogramas por minuto y por dirección.
- **Privacidad**: la primera vez Eddie pide tu permiso en el panel Cámara (y el navegador pide el suyo). Los fotogramas se
  envían una vez al proveedor de IA y **no se guardan** (ni fotos ni miniaturas, ni en el servidor ni en el navegador). La
  cámara se apaga sola a los 5/10/30 min (Configuración), si la pestaña estuvo oculta 2 min, si se desconecta o al
  cerrar la página. Eddie **describe** lo que ve (cantidad de personas, qué hacen, ropa), pero **no reconoce quién es**
  una persona ni deduce nombre, edad, etnia ni emociones.
- **Cuota**: con el plan gratis de Gemini la cuota diaria es limitada; el filtro de movimiento y el tope de tiempo
  mantienen un uso normal en unas 50–120 consultas. Si se alcanza el límite, el panel lo dice y reintenta solo.

## Notion (buscar, leer y escribir tus páginas)

Eddie puede buscar y leer tus páginas de Notion, ver las filas de tus bases de datos (tareas, proyectos,
lecturas…) y escribir: crear una página (o una fila nueva) o añadir texto al final de una existente. Ejemplos:
"busca mis apuntes de React en Notion", "resúmeme la página del viaje", "¿qué proyectos tengo En curso?",
"crea una página con la lista de compras", "añade esto a mis notas". Funciona en la app y en Telegram.

- **Solo escribe con tu OK**: crear y añadir siempre pasan por una tarjeta (puedes editar el título y el texto
  antes de confirmar); Eddie relee lo guardado para comprobarlo. **No borra ni archiva nada.**
- **Solo ve lo que le compartas**: una integración de Notion solo accede a las páginas que le des.
- **Solo para ti**: como GitHub, usa un único token en las variables de Vercel y solo responde a quien inició
  sesión con el correo de `EDDIE_OWNER_EMAIL`.

Pasos (los haces tú, una sola vez):

1. Entra a https://www.notion.so/profile/integrations → **New integration** → nombre "Eddie", tu espacio de
   trabajo, tipo **Internal**. En *Capabilities* deja activadas **Read content**, **Update content** e
   **Insert content**. Guarda y copia el **Internal Integration Secret** (nunca lo pegues en un chat).
2. En **Vercel → Settings → Environment Variables → Production** agrega `NOTION_TOKEN` con ese secreto y
   asegúrate de que `EDDIE_OWNER_EMAIL` sea tu correo de Google. Luego **Redeploy**.
3. **Comparte tus páginas con la integración**: en Notion abre la página (o la base de datos) →
   menú **•••** (arriba a la derecha) → **Conexiones** → agrega "Eddie". Las subpáginas la heredan. Crea, por
   ejemplo, una página "Notas de Eddie" y compártela: ahí guardará lo que le pidas. Si quieres que sea el destino
   por defecto, copia su identificador (los 32 caracteres del final de su enlace) a `NOTION_PARENT_PAGE_ID`
   en Vercel.
4. Prueba: "Eddie, busca en Notion mis notas" o "crea una página llamada Prueba en Notas de Eddie".

Si Eddie dice que no encuentra una página, casi siempre es el paso 3. El contenido que escribe usa Markdown
sencillo (títulos con `#`, listas con `-`, tareas con `- [ ]`, citas con `>`, código con tres comillas
invertidas); el formato dentro de una línea (negritas, enlaces) se guarda como texto normal.

## Memoria de conversaciones (Eddie recuerda lo que hablaron)

Además de lo que le pides recordar (perfil, preferencias, proyectos…), Eddie guarda **un resumen corto de
cada conversación** y, cuando vuelves a un tema, lo recuerda aunque hayan pasado días: "¿qué decidimos de la
base de datos del proyecto?". Funciona en la app y en Telegram, y solo con la sesión de Google iniciada.

- **Cuándo se guarda**: al terminar una conversación: 5 minutos sin hablar, al cambiar o empezar otro chat, o al
  cerrar la pestaña (en Telegram: 30 minutos sin escribir, o `/nuevo`). Solo cuenta si hubo al menos 4
  mensajes, y si es pura charla sin nada que recordar (saludos, pruebas) no se guarda nada.
- **Qué se guarda**: el resumen (2–4 frases, sin contraseñas ni tarjetas), no la conversación completa, junto
  con un *vector* de su significado (embedding de Gemini) para encontrarlo por sentido y no por palabras.
- **Cómo se usa**: antes de contestar, Eddie busca los resúmenes más parecidos a lo que dijiste y, si alguno
  encaja, se lo pasa al modelo como contexto. Si preguntas "¿de qué hablamos ayer?" usa la herramienta
  `search_conversations`.
- **Tu control**: en **Memoria → Conversaciones recordadas** las ves todas, borras una o todas, y apagas
  "Recordar mis conversaciones" (también se apaga con el interruptor de Memoria o con el conector en
  Conectores). Se guardan como máximo 300.

Necesita `GEMINI_API_KEY` (la misma de siempre, para los vectores y los resúmenes; si falta, resume con Groq u
OpenRouter pero no puede crear vectores), la base de datos de Neon y la migración
`db/migrations/0004_episodes.sql` (activa la extensión **pgvector**, gratis en Neon: en el editor SQL de
Neon, pega y ejecuta el archivo). Opcional: `GEMINI_EMBEDDING_MODEL` si Google cambia el nombre del modelo
(por defecto `gemini-embedding-001`).

## Recordatorios y resumen de la mañana (por Telegram)

Eddie te avisa solo, por Telegram, aunque tengas la app cerrada:

- **Recordatorios**: "recuérdame llamar a mamá a las 5", "avísame en 20 minutos que saque la comida",
  "mañana a las 8 recuérdame la cita". Eddie lo guarda y a esa hora te escribe `⏰ Recordatorio: …`.
  También puedes pedirle "¿qué recordatorios tengo?" o "cancela el de mamá" (o usar `/recordatorios`).
  Si pides solo "anota comprar pan" (sin hora) crea una tarea, no un aviso.
- **Resumen de la mañana**: "mándame un resumen cada mañana a las 7", o el interruptor en
  Conectores → Telegram (con la hora y el botón "Enviarme uno ahora"; también `/resumen`). Trae tu agenda
  de hoy, tus recordatorios, tareas pendientes, correos importantes sin leer y tres titulares. Se arma con
  los mismos datos que el módulo Hoy, sin gastar IA; solo se manda si ese día aún no se mandó y no han
  pasado más de 3 horas de la hora elegida.

Necesita Telegram vinculado (ver abajo) y tres cosas más. **Los avisos pueden llegar con unos minutos de
retraso**: el plan gratis de Vercel solo deja un trabajo programado al día, así que el que revisa cada 5
minutos es un flujo de GitHub Actions.

1. **Base de datos**: ejecuta `db/migrations/0003_reminders.sql` en el editor SQL de Neon.
2. **`CRON_SECRET`**: una clave al azar de al menos 16 caracteres (por ejemplo, en una terminal:
   `openssl rand -hex 32`). Va en **dos** sitios con el mismo valor, y nunca en un chat:
   - Vercel → Settings → Environment Variables → `CRON_SECRET` (luego Redeploy).
   - GitHub → tu repositorio → Settings → Secrets and variables → Actions → *New repository secret* →
     nombre `CRON_SECRET`.
3. **Activar el flujo de GitHub Actions**: ya está en `.github/workflows/eddie-cron.yml` (cada 5
   minutos); en la pestaña *Actions* del repositorio puedes lanzarlo a mano con *Run workflow* para
   probarlo. Si tu dominio no es `eddie-asistent.vercel.app`, agrega el secreto `EDDIE_APP_URL` con tu
   dirección. Sin `CRON_SECRET` en GitHub el flujo no hace nada (avisa con una advertencia).

`GET /api/connectors/cron` (con `Authorization: Bearer <CRON_SECRET>`) envía lo que toque; Vercel lo
llama además una vez al día (11:00 UTC) desde `vercel.json`. Se puede llamar las veces que sea: cada
aviso y cada resumen se reservan con una sola operación en la base antes de enviarse, así que no se
repiten.

## Telegram (hablar con Eddie desde el celular)

Eddie también vive en Telegram: le escribes o le mandas **notas de voz** y te
contesta con su voz (la de ElevenLabs), con las mismas herramientas, memoria y
tareas que en la app. Lo delicado (enviar un correo, borrar algo) te llega con
botones ✅ / ✖. El comando `/llamar` (y el botón de menú "Llamar a Eddie") abre
su pantalla de voz dentro de Telegram.

> Un bot de Telegram **no puede hacer ni recibir llamadas de teléfono** (la API
> de bots no lo permite). La "llamada" son notas de voz en los dos sentidos más
> esa pantalla de voz; si tu teléfono no deja usar el micrófono dentro de
> Telegram, las notas de voz funcionan igual.

Necesita la cuenta de Google y la base de datos (ver "Cuenta de Google"), porque
el bot sabe quién eres por el chat que vinculas.

1. **Crear el bot**: en Telegram abre `@BotFather` → `/newbot` → elige un nombre
   (por ejemplo "Eddie") y un usuario que termine en `bot`. Te da un token.
2. **Variables en Vercel** (Settings → Environment Variables, luego Redeploy):
   - `TELEGRAM_BOT_TOKEN` = el token de BotFather (solo en Vercel, nunca en un chat).
   - `TELEGRAM_WEBHOOK_SECRET` = un texto aleatorio de 20–64 caracteres (letras,
     números, `_` o `-`). Telegram lo devuelve en cada mensaje para probar que
     viene de él.
   - `APP_URL` = tu dominio fijo con `https://` (ya lo tienes para el login).
3. **Base de datos**: ejecuta `db/migrations/0002_telegram.sql` en el editor SQL de
   Neon (igual que hiciste con la 0001).
4. **Vincular**: en Eddie → Conectores → **Telegram** → *Vincular Telegram*. La
   app registra el webhook, los comandos y el botón de menú por sí sola y te da
   un enlace: ábrelo y pulsa **Iniciar** (Start) en Telegram. La tarjeta pasa a
   "Conectado" sola.
5. Prueba: escríbele "hola", o mándale una nota de voz: "anota comprar pan".

Comandos: `/llamar`, `/resumen`, `/recordatorios`, `/voz on|off` (contestar siempre con voz), `/nuevo`
(conversación nueva), `/ayuda`, `/desvincular`. Si `EDDIE_OWNER_EMAIL` está
definido, solo esa cuenta puede vincular Telegram. Eddie solo responde en tu
chat privado vinculado; en grupos no contesta.

## WhatsApp (hablar con Eddie desde WhatsApp)

Igual que en Telegram: le escribes, le mandas **notas de voz** o **fotos** y te contesta (con su voz si le hablaste
por voz), con las mismas herramientas, memoria y tareas que en la app. Lo delicado (enviar un correo, borrar algo)
te llega con botones **Confirmar / Cancelar**. Comandos: `/ayuda`, `/voz on|off`, `/resumen`, `/recordatorios`,
`/nuevo`, `/desvincular`. Funciona con la API oficial de WhatsApp de Meta (WhatsApp Cloud API) y su número de
prueba gratuito.

> Límites de WhatsApp: un asistente **no puede llamarte ni recibir llamadas**, y solo puede escribirte libremente
> durante las **24 horas** siguientes a tu último mensaje (fuera de ese plazo exige mensajes con plantilla aprobada
> por Meta). Por eso los **avisos de recordatorios y el resumen de la mañana siguen llegando por Telegram**; en
> WhatsApp tienes `/resumen` y `/recordatorios` cuando quieras.

Pasos (los haces tú, una sola vez; necesitas una cuenta de Facebook/Meta):

1. En https://developers.facebook.com → **My Apps → Create App** → tipo **Business** → agrega el producto
   **WhatsApp**. Meta crea una cuenta de WhatsApp Business de prueba con un **número de prueba** gratis.
2. En **WhatsApp → API Setup**: copia el **Phone number ID** (será `WHATSAPP_PHONE_NUMBER_ID`) y, en el campo
   "To", agrega **tu propio número** como destinatario y verifícalo con el código que te llega (el número de prueba
   solo conversa con los números que registres, hasta 5).
3. **Token** (`WHATSAPP_TOKEN`): la pantalla API Setup da uno temporal que caduca en 24 horas (sirve para
   probar). Para uno permanente: Meta Business Settings → **Users → System users** → crea un usuario del sistema
   (Admin) → *Add assets* → tu app y tu cuenta de WhatsApp (control total) → **Generate token** con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`. Cópialo (nunca lo pegues en un chat).
4. **App secret** (`WHATSAPP_APP_SECRET`): en **App settings → Basic → App secret** (Show).
5. **Variables en Vercel** (Settings → Environment Variables → Production, luego Redeploy):
   `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` (una frase
   al azar que inventas tú, por ejemplo `openssl rand -hex 16`); `APP_URL` ya la tienes.
6. **Base de datos**: ejecuta `db/migrations/0005_whatsapp.sql` en el editor SQL de Neon.
7. **Webhook**: en Meta, **WhatsApp → Configuration → Webhook → Edit**: *Callback URL*
   `https://TU-DOMINIO/api/connectors/whatsapp/webhook`, *Verify token* = tu `WHATSAPP_VERIFY_TOKEN` →
   **Verify and save**. Luego en *Webhook fields* suscríbete a **messages**.
8. **Vincular**: en Eddie → Conectores → **WhatsApp** → *Vincular WhatsApp*; se abre el chat con el número de
   prueba con el mensaje `VINCULAR XXXXXXXX` ya escrito: envíalo. La tarjeta pasa a "Conectado" sola.
9. Prueba: escribe "hola", manda una nota de voz o una foto.

Seguridad: cada entrega del webhook se acepta solo si trae la firma `X-Hub-Signature-256` válida (HMAC-SHA256 con
tu app secret); Eddie solo responde al número que vinculaste (si defines `EDDIE_OWNER_EMAIL`, solo el dueño puede
vincular); los mensajes repetidos se ignoran y el token solo se envía a los servidores de Meta.

## Sonda local (tu Chromebook)

La **Sonda Local** (EDDIE Prime) es un pequeño servidor en Python que corre en tu equipo y puede mirar el disco, la
memoria, el procesador o la batería, algo que el servidor de Eddie en la nube nunca puede hacer. La web le habla
directamente desde el navegador de ese mismo equipo.

1. Arranca la sonda en el equipo (`uvicorn main:app --host 127.0.0.1 --port 8000`) con CORS para este sitio, el
   permiso de red privada, `GET /health` y la clave en `X-Eddie-Key` (ver `docs/sonda-local.md`).
2. En Eddie → **Conectores → Sonda local**: deja la dirección `http://127.0.0.1:8000`, escribe la clave (la misma que
   tiene la sonda; se guarda solo en este navegador) y pulsa **Probar conexión**. Si Chrome pregunta si el sitio
   puede acceder a apps o dispositivos de este equipo, acepta.
3. Eddie **no depende** de la sonda: el botón **Sonda local** del chat arranca apagado en cada carga (no se guarda),
   y la voz, el anillo y la palabra clave nunca le hablan a ella. Pulsa el botón (OFF → ON) para mandarle lo que
   **escribas** en el chat (hasta 90 s de espera; la respuesta muestra las herramientas que usó); mientras esté en ON
   aparece «SONDA · ON» en el encabezado. Opcional: en la tarjeta, activa que las preguntas claras sobre el hardware
   («disco duro», RAM, CPU, batería) vayan solas a la sonda (si no responde en 8 s, contesta Eddie). Todo lo demás
   sobre tu equipo lo responde EDDIE Prime desde la nube.

Solo funciona en el equipo donde corre la sonda. Para el teléfono, Telegram o WhatsApp está EDDIE Prime (abajo).

## Tu equipo desde cualquier lugar (EDDIE Prime)

Con el agente `eddie_agent.py` en tu Chromebook, Eddie lo consulta y lo maneja desde la web, el teléfono, Telegram o
WhatsApp: "¿cuánto disco me queda?", "¿qué está gastando memoria?", "abre la terminal". El agente no tiene IA
propia (un solo cerebro: el de Eddie) y no abre puertos. Espera un aviso sin datos (ntfy) y va a buscar el trabajo con
su token. Solo ejecuta su lista blanca de herramientas, y lo que cambia algo pide confirmación.

1. **Conectores → Tu equipo (EDDIE Prime) → Vincular un equipo** (sesión del dueño).
2. En la terminal de Linux pega los tres comandos que muestra la tarjeta (descargar, `pair CÓDIGO`, `run`). Usa el
   mismo entorno de Python que tu sonda, o `pip install psutil`.
3. `python3 eddie_agent.py install-service` para que arranque solo; luego **Probar desde la nube**.

No necesita variables nuevas (usa `DATABASE_URL` y la migración `0006_computer.sql`). Opcional: `EDDIE_NTFY_URL` si
usas tu propio servidor ntfy. Detalles, herramientas, contrato y seguridad: `docs/eddie-prime-agente.md`.

## Voz (Speech-to-Text / Text-to-Speech)

Eddie usa la **Web Speech API** del navegador (sin dependencias externas):

- **STT**: el botón de micrófono en el Chat dicta el mensaje con
  transcripción en tiempo real, maneja permisos denegados y avisa si el
  navegador no es compatible.
- **TTS**: si activas "Eddie lee sus respuestas en voz alta" en
  Configuración, Eddie **empieza a hablar con la primera frase**, mientras
  todavía escribe el resto (no espera a que termine). Las frases se leen por
  trozos con la voz de ElevenLabs o, si no está, la del navegador. Con
  ElevenLabs cada trozo se encadena justo detrás del anterior (sin huecos, con un
  fundido de 8 ms) y el servidor recibe también el texto de los trozos vecinos para que la
  entonación continúe en vez de reiniciarse; el siguiente audio se prepara mientras suena el
  actual. Si el servidor falla, esa respuesta sigue con la voz del navegador (un error de
  créditos o de plan lo pausa 5 minutos; uno pasajero se reintenta en la siguiente respuesta).
  Mientras Eddie usa herramientas y pasan 1,5 s sin nada que oír, dice una frase corta
  («Un momento, lo reviso») y la respuesta empieza cuando termina. Con la voz activada, el
  prompt pide un estilo hablado (frases cortas, sin listas ni símbolos), y símbolos como `°C`,
  `%` o `km/h` se leen como se dicen, sin emojis. El micrófono de seguimiento (palabra
  clave) espera a que termine de hablar. Los bloques de código no se leen y los
  enlaces se leen solo por su texto. Configuración → Voz muestra los tiempos de la
  última respuesta (transcribir, primeras palabras, primera voz) y **con qué voz habló**
  (ElevenLabs o el navegador) y, si fue el navegador, por qué.

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

- La cámara de Modo Vigilancia solo se enciende con tu permiso, muestra siempre un chip rojo y se apaga sola; los
  fotogramas no se guardan (ver «Modo Vigilancia»).
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
  migrations/0003_reminders.sql      Recordatorios y resumen de la mañana
  migrations/0004_episodes.sql       Memoria de conversaciones (pgvector)
  migrations/0005_whatsapp.sql       WhatsApp (números vinculados, códigos, confirmaciones)
server/
  dev-server.js        Servidor Express que replica todas las rutas de api/ en local
src/
  components/          Chat, Tasks, Settings, Core, Shared
  home/                Pantalla de Inicio (orbe de voz, paneles HUD, cámara y conversación)
  layout/              Barra de íconos, Mis chats, encabezado, logo, efectos HUD
  connectors/          Hub de conectores (tarjetas por estado e interruptores)
  context/             SettingsContext, AuthContext, VoiceContext, ChatContext
  hooks/               useWhisperRecognition, useSpeechRecognition, useSpeechSynthesis, useProviderHealth
  services/            api.js (chat), remote.js (tasks/settings/memory/calendar/drive), personality.js, memory.js (memoria estructurada), memoryActions.js, skills.js, localAnswers.js
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
