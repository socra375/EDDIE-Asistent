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
   └── api/_lib/connectors/  → herramientas de los conectores activos (hora, calculadora, clima, tareas, memoria, internet, noticias, Wikipedia, monedas, Gmail, Calendario, GitHub, Notion, YouTube, Recordatorios, Recuerdos de conversaciones, Telegram, Sonda local…)
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
| Animación de inicio | Al abrir Eddie (una vez por apertura, no en cada recarga de la pestaña) se reproduce una secuencia de unos 4 s: pantalla negra con rejilla hexagonal, línea de escaneo y esquinas HUD; un **reactor de arco** que se dibuja, gira y se enciende con destello y ondas; un registro de arranque (núcleo, enlace satelital, voz, visión, memoria, conectores), medidores que suben a 100 % y el título **E.D.D.I.E.** letra a letra con el saludo «Buenos días/tardes/noches, señor». Se omite con un toque o cualquier tecla; con «reducir movimiento» dura 1,4 s y sin movimiento; se desactiva (o se vuelve a ver) en Configuración → Interfaz HUD; no se muestra si Eddie se abre con un atajo («Hablar con Eddie», «Modo Vigilancia»). Solo mueve `transform`/`opacity` (≈ 9 % del hilo principal en la medición) |
| Inicio | Panel estilo J.A.R.V.I.S.: la pantalla está limpia: los paneles de información (Clima, Tareas, Sistema y Tiempo activo) **aparecen solo cuando los pides** y flotan a la izquierda sin mover el orbe. Di **«Activa sistema»** y se quedan a la vista hasta que digas **«Desactiva sistema»** (también «oculta los paneles»); di **«Dame los datos de hoy»** y Eddie lee el día (fecha y hora, clima, tareas, tu equipo, la sesión) y **cada panel aparece mientras habla de él**; al terminar de hablar (o si lo detienes) desaparecen. Con la voz apagada aparecen igual, unos segundos cada uno. El panel de **Cámara** (Modo Vigilancia, ver más abajo) sale solo mientras la cámara está encendida. Al centro, un **anillo de partículas** de luz que fluyen en cintas onduladas alrededor de un **disco vacío** (ese centro está reservado: más adelante mostrará la imagen que le pidas a Eddie), con el nombre, el estado («Escuchando la palabra clave…» solo 2 s al entrar, y luego «En espera»; escuchando, procesando, hablando…; si la palabra clave falla, lo dice y cuál es la causa) y los botones de cámara, micrófono y teclado; a la derecha la **Conversación** (Limpiar y Exportar), que **se abre y se cierra** con el botón de chat bajo el orbe o con la X de su encabezado (cerrada, el centro gana espacio; Escape la cierra en pantallas angostas; Eddie recuerda tu elección). En ventanas de más de 1100 px empieza abierta como columna; en las de menos es un cajón que empieza cerrado, y de menos de 760 px todo va en una columna. El encabezado es una barra delgada: marca y estado «En línea», reloj y fecha, clima y chips. El anillo (`src/home/ParticleRing.jsx` + `particleRing.js`, un solo canvas) cambia con el estado: fluye despacio en espera, late más rápido y brillante al escuchar y al hablar, **corre y se vuelve ámbar** al procesar, se congela gris cuando está desactivado y destella rojo con un error; toda la circunferencia (centro incluido) es el botón de hablar. Es ligero a propósito: ~20 cuadros por segundo (10 en Modo ligero, con la mitad de partículas y menos hilos), se pausa fuera de pantalla o con la pestaña oculta y se queda quieto con «reducir movimiento»; sin desenfoques ni filtros de sombra (hilo principal en reposo ≈ 13 % normal, 4 % en Modo ligero, 0,2 % con movimiento reducido, medido con render por software). En Configuración → Pantalla, el **Modo ligero** (automático, siempre ligero o completo) apaga además la rejilla, las líneas y las animaciones; el automático se activa solo en equipos pequeños, si se pide menos movimiento o si la pantalla se ve lenta (menos de 20 cuadros por segundo) |
| Hoy | El día de un vistazo: saludo, agenda de hoy y mañana (Google Calendar), correos importantes sin leer (Gmail), tareas pendientes (vencidas primero), clima y titulares de noticias. Cada tarjeta explica qué falta si está vacía (iniciar sesión, conectar Gmail, conector apagado) y el botón "Resumen del día con Eddie" le pide que te lo cuente con sus herramientas, por voz si está activa. Se actualiza solo cada 5 minutos |
| Chat | Conversación con Eddie (con dictado por micrófono), historial persistente, estilos de respuesta y habilidades: Estudio (explicaciones, resúmenes, cuestionarios, flashcards, esquemas, planes de repaso), Código (explicar, depurar, refactorizar, generar ejemplos) y Documentos (resúmenes, informes, guías, esquemas, correos). Las respuestas se copian o exportan a TXT, DOC o PDF y, con sesión iniciada, se guardan en Google Drive |
| Tareas | Lista de tareas con prioridad, fecha de entrega, recordatorio de la más próxima y, con sesión iniciada, sincronización entre dispositivos + botón para agregarlas a Google Calendar. Eddie conoce tus pendientes al responder |
| Notas | Una **hoja en blanco** que Eddie va escribiendo mientras hablas: el micrófono se queda abierto (dictado continuo) durante el tiempo que elijas (5, 10, 15, 30 min, 1 h, o cualquier valor de 1 a 180 min) con cuenta atrás, «+5 min» y «Detener»; ves el texto aparecer (y la frase a medias) en la hoja. Por voz: **«Eddie, toma notas durante 10 minutos»** (también «media hora», «una hora y media»; sin tiempo usa el elegido) abre Notas con una hoja nueva; **«fin de la nota»** o «termina la nota» la cierra. Puntuación hablada («coma», «punto», «punto y aparte», «nueva línea»…), título opcional, edición a mano, copiar y descargar `.txt`. Se guardan en este dispositivo |
| Memoria | Todo lo que Eddie recuerda de ti vive en un **orbe**: una esfera de puntos donde cada recuerdo (perfil, preferencias, proyectos, decisiones, conocimientos, contexto temporal) y cada conversación recordada es un punto con otros pequeños alrededor y líneas a sus vecinos; al pasar el mouse dice qué recuerdo es, al hacer clic lo fija (con *Olvidar*, y *Editar* en los proyectos) y se arrastra para girarla; los nuevos aparecen creciendo; la leyenda aísla una categoría; con Modo ligero o «reducir movimiento» no gira sola. Debajo, **Agregar memoria** para escribir cosas que se guardan en el orbe (nunca contraseñas ni tarjetas). Eddie también guarda lo que le cuentas sin que se lo pidas (y te avisa) y usa solo lo que viene al caso en cada respuesta. Al final, plegado, *Ajustes de la memoria, palabra clave y aplausos*: permitir que Eddie recuerde, borrar toda la memoria, recordar conversaciones y su borrado, y la **palabra clave de activación** (por defecto "Eddie"): dila y Eddie te escucha sin tocar nada |
| Conectores | Qué servicios puede usar Eddie y en qué estado están (listo, conectado, por conectar, falta configurar, próximamente). Cada conector se enciende o apaga: al apagarlo, sus herramientas dejan de ofrecerse en el chat. Se ve como una **órbita**: el reactor de Eddie al centro y cada conector como un icono en dos anillos que giran al entrar, van apareciendo y se detienen (tocar un icono abre su tarjeta); el botón *Lista* muestra las tarjetas de siempre y se recuerda. Con Modo ligero o «reducir movimiento» no gira |
| Configuración | Con menú a la izquierda (01 Voz y audio, 02 Motor de IA, 03 Interfaz HUD, 04 Cuenta, 05 Dispositivos, 06 Privacidad), tarjetas en dos columnas, interruptores y deslizadores; en Voz: leer respuestas, **activar con la palabra clave**, **volumen** (20–100 %) y **velocidad** (0,8–1,2; ElevenLabs la aplica en el servidor, la voz del navegador en su propio ritmo); en Interfaz HUD: **color del núcleo** del orbe (cian, azul, verde, ámbar). Los cambios se guardan al instante y hay «Restablecer ajustes». Contiene: proveedor y modelo de IA, idioma, tema, lectura de respuestas en voz alta (on/off), historial de conversaciones (ver/abrir/eliminar), memoria (activar/borrar), cuenta de Google (iniciar/cerrar sesión, eliminar cuenta) |

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
  **¿Cuándo decide que terminaste de hablar?** Después de una pausa de silencio que ajustas en
  Configuración → Voz → **«Pausa para terminar de hablar»** (0,8–3 s, por defecto 1,5 s; antes eran 0,9 s y
  cortaba las frases con pausas normales). `src/services/endpoint.js` (puro, con pruebas) mide el ruido del
  cuarto con el momento más callado del primer instante (no se confunde si ya estás hablando o suena un
  aplauso), sigue contando como voz el final suave de una frase y no deja el micrófono abierto por ruido de fondo.
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
  de Telegram. Usa voces creadas por ti (Voice Design o clonadas): el plan gratis no permite por API las de
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

**Si no te oye:** el chip bajo el orbe de Inicio dice qué pasa. «Escuchando la palabra clave» = todo bien. Si el
reconocimiento de voz del navegador se corta apenas empieza (sin internet, el servicio de voz bloqueado por quien
administra el equipo, otra app con el micrófono), dice «Palabra clave sin señal · reintentando» y **sigue
intentándolo** esperando cada vez más (hasta 30 s) en vez de rendirse; pasa el cursor para ver la causa. Si el
navegador bloqueó el micrófono, o no se pudo usar, dice «Pulsa para reintentar» y basta pulsar el chip.

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


## Segundo cerebro: «Investiga y aprende X»

Dile a Eddie **«Investiga y aprende [un tema o una habilidad]»** (por voz, en el chat, en Telegram o desde **Memoria → Segundo cerebro**)
y Eddie va a la web, lee varias páginas, **guarda lo esencial** con su fuente y, desde entonces, **cualquier pregunta relacionada usa
ese conocimiento** como base de la respuesta.

- **Qué hace** (`api/_lib/knowledge/`): 2 búsquedas (Tavily) → elige hasta 8 páginas de sitios distintos (sin video, redes, tiendas ni
  PDF) → lee hasta 5 en paralelo → **una llamada a la IA destila de 6 a 12 notas** (≤ 320 caracteres, cada una con su fuente, solo lo que
  dicen las páginas, pasos en orden si es una habilidad) y un resumen → cada nota se guarda con su vector (Gemini, 768 dim.) en Neon
  (`knowledge_topics` y `knowledge_notes`, migración `0013_knowledge.sql`). Tarda unos 20–30 s. Si pides un tema que ya sabe, **lo
  actualiza** (reemplaza sus notas).
- **Cómo lo usa**: antes de responder busca por significado entre las notas aprendidas (≥ 0,6 de parecido, máx. 4, ~1.400 caracteres,
  con tope de 0,7 s como el recuerdo de conversaciones; una sola consulta de vectores para las dos memorias) y las añade al prompt como
  «Lo que aprendiste investigando en la web». Eddie dice que lo aprendió y de qué fuente. «¿Qué aprendiste de X?» (`search_knowledge`),
  «¿qué has aprendido?» (`list_knowledge`) y «olvida lo de X» (`forget_knowledge`, con tarjeta de confirmación).
- **El mapa** (`src/memory/KnowledgeMap.jsx`, `knowledgeMap.js`): arriba de la tarjeta, un mapa de órbitas como una carta estelar. Cada
  tema es un nodo con anillos que **recorre su propia elipse** (una vuelta cada 100–300 s), con **un punto pequeño por nota** detrás; los
  temas del mismo tipo se agrupan en la misma región y se unen con curvas finas. El **color es el tipo de conocimiento**: Empresarial
  (ámbar), Técnica (cian), Cotidiana (verde), Personal (rosa), Salud (coral), Académica (azul), Creativa (violeta) y Única (blanco, lo que
  no encaja en nada). La IA elige el tipo al aprender y lo puedes cambiar (en el detalle del mapa o en la lista). Animación: nodos que
  derivan, pulsos lentos, cometas por los arcos largos, paralaje suave con el puntero, **órbita que se dibuja al nacer un tema** y, mientras
  Eddie investiga, **una señal que pulsa desde el centro**. Pasa el mouse por un anillo (el mapa se detiene y sale su ficha), haz clic para
  fijarlo («Ver las notas» lo abre en la lista) y usa la leyenda para aislar un tipo. Va a ~20 fps (10 en Modo ligero), se pausa fuera de
  pantalla o con la pestaña oculta y queda quieto con «reducir movimiento»; la entrada empieza cuando el mapa se ve por primera vez.
- **La tarjeta de Memoria**: campo «Investiga y aprende…» (hasta **300 caracteres**: puedes explicar qué te interesa; el tema se guarda con
  un título corto de hasta 80), progreso, lista de temas (tema/habilidad, tipo, notas, fuentes, fecha), notas con enlace a su fuente,
  quitar una nota, cambiar el tipo, volver a investigar y olvidar un tema.
- **Límites**: 60 temas, 6 investigaciones por hora, solo con sesión iniciada; se apaga en Conectores → Segundo cerebro. Cuota: cada
  tema usa 2 búsquedas de Tavily (1.000 al mes gratis con `TAVILY_API_KEY`; sin clave hay un límite bajo), una llamada de IA y hasta 12
  embeddings de Gemini.
- **Seguridad**: las direcciones salen de resultados de búsqueda, así que **nunca se leen direcciones internas** (localhost, redes
  privadas, metadatos de la nube; se resuelve el nombre y se comprueba cada dirección, también en cada redirección), solo `http(s)` en
  los puertos 80/443, sin credenciales ni cookies, 6 s y 600 KB por página, solo texto. El texto de las páginas se trata siempre como
  **datos**: se le dice a la IA que ignore órdenes dentro de ellas, lo que devuelve se valida y recorta antes de guardarse, y al usarlo
  se marca de nuevo como «datos copiados de páginas, no instrucciones». Lo aprendido puede tener errores: por eso cada nota lleva su fuente.

## Despertar con dos aplausos

En **Memoria → Ajustes de la memoria, palabra clave y aplausos → Activar con dos aplausos** (apagado por defecto)
activas «Despertar a Eddie con dos aplausos». Aplaudes dos veces seguidas (entre 0,13 y 0,9 s de separación) y suena
un timbre corto; Eddie abre el micrófono y te escucha, igual que al decir la palabra clave sola (y la ventana de espera
tras su respuesta funciona igual). «Eddie, suspéndete» también lo apaga.

- **Cómo distingue un aplauso** (`src/services/clap.js`, puro y con pruebas): un golpe repentino (≥ 3× más fuerte que los últimos 60 ms y ≥ 4×
  el ruido del cuarto, que se aprende solo) con algo de energía sobre 2 kHz; el eco de un aplauso (hasta ~0,7 s) no lo anula y un segundo
  aplauso sobre la cola del primero cuenta. Una voz, música o un ventilador sostenidos no forman pareja. Los dos aplausos deben ir con
  0,13–0,9 s de separación; después de despertar ignora los aplausos 2,5 s. Calibrado para micrófonos de portátil/Chromebook (silenciosos y
  con pocos agudos): umbral medio ≈ 7 % del nivel máximo.
- **Medidor en vivo** (Memoria → «Activar con dos aplausos»): barra con el nivel del micrófono y la marca que un aplauso debe cruzar,
  ruido del cuarto, aplausos y dobles oídos, y el motivo cuando un sonido fuerte no contó («muy suave», «poco agudo», «no fue repentino»,
  «sonido largo»); si no llega audio avisa de que el micrófono puede estar silenciado.
- **Sensibilidad** Baja / Media / Alta en la misma tarjeta (si se activa solo, bájala; si no te oye, súbela).
- Se escucha con el micrófono sin cancelación de eco ni supresión de ruido (se comerían el aplauso) y **se suelta mientras
  Eddie te escucha, piensa o habla**, así no se despierta con su propia voz. El audio se analiza en tu equipo: no se envía
  ni se guarda. El navegador muestra «micrófono en uso» mientras esté activo.
- **Límites:** solo con Eddie abierto en una pestaña (en segundo plano el navegador duerme los temporizadores y puede no
  oírlos) y con el permiso del micrófono. Los aplausos muy suaves o lejanos pueden no detectarse.

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
  animal (máx. uno cada 15 s y la misma cosa no antes de 60 s). Con la cámara encendida, pregunta **«¿qué ves?»** y Eddie
  te lo cuenta al instante con lo que ve.
- **Cómo funciona — gratis y sin depender de nadie**: cada 5 s (3–15 en Configuración → Cámara · Modo Vigilancia) el
  navegador compara un cuadro pequeño con el anterior y **solo si la escena cambió** (o pasaron 30 s) analiza la imagen.
  El **motor de visión** se elige en esa misma tarjeta:
  - **Automático (recomendado)**: un **detector que corre en tu propio equipo** (COCO-SSD con TensorFlow.js: 80 tipos de
    objetos, personas y animales; cajas, lista, registro de eventos y avisos por voz) **sin claves, sin cuota y sin enviar
    ninguna imagen**; cada ~20 s y solo si algo cambió, una imagen pequeña va además a una IA gratuita para
    **describir mejor la escena y ver materiales**. Si no hay clave o se agota la cuota, sigue funcionando solo con el
    detector. «¿Qué ves?» se responde al instante con lo que el detector ve (más la descripción de la IA si la hay).
  - **Solo en este equipo**: nada sale del equipo, nunca.
  - **Solo IA en la nube**: la IA hace todo (como antes).
  - **El detector**: la primera vez que enciendes la cámara baja ~18 MB (los sirve Eddie mismo desde
    `/models/coco-ssd`, con la copia de Google como respaldo) y el navegador los guarda; después funciona sin conexión. Usa
    la tarjeta gráfica (WebGL) o, si no hay, el procesador; en equipos modestos tarda ~0,5–1 s por imagen. Modelo
    ssdlite_mobilenet_v2 de TensorFlow (licencia Apache 2.0). Distingue lo que está en sus 80 clases (persona, perro,
    laptop, taza, botella, celular…); los materiales que muestra son una pista por tipo de objeto («material probable»).
  - **La IA en la nube** (`POST /api/chat?action=vision`, sin función nueva en Vercel) prueba, en este orden, lo que esté
    configurado: **Gemini** (`GEMINI_VISION_MODEL`, por defecto `gemini-flash-latest`), **Groq** (gratis: Llama 4 con visión,
    `GROQ_VISION_MODEL`, por defecto `meta-llama/llama-4-scout-17b-16e-instruct`; usa la misma `GROQ_API_KEY` del chat y si
    Groq retira el modelo busca otro con visión de su lista) y **Claude** (`CLAUDE_VISION_MODEL`, por defecto
    `claude-haiku-4-5-20251001`); si uno está ocupado o caído, responde el siguiente. La respuesta se recorta a una forma
    fija (máx. 12 elementos, etiquetas cortas, cajas en rango). `VISION_MAX_PER_MINUTE` (20 por defecto) limita las
    peticiones por minuto y por dirección.
- **Privacidad**: la primera vez Eddie pide tu permiso en el panel Cámara (y el navegador pide el suyo). Con el detector
  de tu equipo la imagen **no sale del equipo**; la que va a la IA (modo Automático o nube) se envía una vez y **no se
  guarda** (ni fotos ni miniaturas, ni en el servidor ni en el navegador). La
  cámara se apaga sola a los 5/10/30 min (Configuración), si la pestaña estuvo oculta 2 min, si se desconecta o al
  cerrar la página. Eddie **describe** lo que ve (cantidad de personas, qué hacen, ropa), pero **no reconoce quién es**
  una persona ni deduce nombre, edad, etnia ni emociones.
- **Velocidad**: el detector del equipo carga y se «calienta» en cuanto pulsas encender (mientras la cámara pide permiso), y mira
  de nuevo en cuanto puede (≈ 2,5 veces lo que tarda un análisis, mínimo 1 s) en vez de esperar el intervalo, que pasa a ser el
  tope; en el panel Cámara se ve cuánto tarda cada análisis y si usa los gráficos o el procesador. Las respuestas de Gemini piden
  el mínimo de «pensamiento» (`GEMINI_THINKING=default` lo devuelve al comportamiento del modelo).
- **Cuota**: el detector local no gasta cuota. La descripción por IA (Gemini/Groq) se pide como mucho cada 20 s y solo si la
  escena cambió, así que un uso normal queda muy por debajo de los planes gratis (Groq: 30 por minuto).

## Notas (dictado con el micrófono abierto)

Abre **Notas** en la barra lateral, o di **«Eddie, toma notas durante 10 minutos»** desde cualquier pantalla.

- **Hoja en blanco que ves**: a la izquierda, tus hojas; a la derecha, la hoja de papel rayado. Lo que dices aparece en ella
  en cuanto el navegador lo entiende (la frase a medias se ve abajo en cursiva). Puedes escribir encima a mano.
- **Cuánto dura**: eliges 5, 10, 15, 30 min, 1 h u otro valor (1–180 min) antes de pulsar «Dictar», o lo dices: «durante
  20 minutos», «por media hora», «una hora y media». Hay cuenta atrás, «+5 min» para alargarla y «Detener». Al acabar el tiempo
  se cierra el micrófono solo y Eddie avisa («Se acabó el tiempo de la nota»). Sin tiempo en la orden usa el último elegido y
  lo dice.
- **Terminar antes**: «fin de la nota», «termina la nota» o «deja de tomar notas» (al final de una frase, esa frase se guarda).
- **Puntuación hablada** (se puede apagar en la hoja): «coma», «punto», «punto y aparte», «punto y coma», «dos puntos», «nueva
  línea», «nuevo párrafo», «abre/cierra interrogación», «abre/cierra paréntesis». Las frases empiezan con mayúscula.
- **Mientras dicta**: el micrófono de la palabra clave se pausa (no pueden compartirlo) y, si Eddie habla, el dictado espera a que
  termine para no escribir su voz. Tocar el orbe para hablar con Eddie corta el dictado.
- **Dónde se guardan**: en este navegador (`localStorage`), no en el servidor. Copiar o «Descargar .txt» para llevarlas.
- **Límites**: usa el reconocimiento de voz del navegador (Chrome/Edge; necesita conexión) y la pestaña debe seguir abierta y
  visible; sin permiso de micrófono lo dice en la hoja.

## Dispositivos (una cuenta, varios equipos)

**Configuración → Dispositivos** lista los equipos donde abriste Eddie con tu cuenta (Chromebook, teléfono, tablet…), con un
punto verde si Eddie está abierto ahora, más Telegram y EDDIE Prime. Desde cualquiera puedes **activar o apagar el Modo
Vigilancia de otro**, eligiéndolo en la lista, o por chat («activa la vigilancia en el Chromebook»). **Por ahora el candado de la cámara está
apagado** (ver «Candado de la cámara» más abajo): las cámaras se encienden a distancia sin pedir contraseña.

- **Solo si está encendido**: un equipo cuenta como encendido mientras Eddie siga abierto en él (late cada 2 min, ventana de 4 min);
  si está apagado o sin conexión, el botón se deshabilita y Eddie lo dice, sin dejar la orden en espera.
- **Control remoto opt-in, por equipo**: está **apagado por defecto**; hay que activarlo en ese equipo (tarjeta «Este dispositivo»).
  Mientras está apagado ni siquiera se guarda el tema del «timbre».
- **Cómo llega la orden** (sin sondeo constante, para cuidar la cuota de Neon): la orden se guarda en `device_commands` y se toca un
  timbre sin datos en un tema secreto de ntfy; el equipo lo oye, pide la orden con su cookie de sesión y responde (`done`,
  `consent` o `error`); si no hay timbre, la recoge en su siguiente latido. Las órdenes caducan a los 2 min.
- **Vigilar desde otro equipo y que Eddie te cuente lo que pasa**: junto a cada dispositivo, **«Activar vigilancia y ver»** enciende su
  cámara y abre una ventana con el **video en vivo**, y Eddie, **cada 5 segundos** (5, 10, 15 o 30 s), **dice en voz alta lo que
  ocurre**: «PC: aparece una persona», «la persona ya no está», «ahora hay 2 personas», «aparece un perro»… y cada 30 s «sin novedades,
  veo un laptop» para saber que sigue vivo; si se pierde la señal lo avisa. Todo queda también en el **REPORTE** de la ventana (con
  botón para quitar la voz y otro para ocultar la imagen y dejar solo el reporte). Lo mismo por chat o voz: «Eddie, activa la
  vigilancia en mi PC» o «enséñame lo que ve el Chromebook» muestra una **tarjeta donde escribes tu contraseña de cámara** (o usas tu
  huella) y, con eso, enciende la cámara y abre la ventana. «Apagar vigilancia» (o «desactiva la vigilancia en mi PC») la apaga y
  cierra la ventana, y **no pide nada**: apagar nunca es un riesgo. Desde Telegram **no se puede encender una cámara** (solo apagarla).
- **Quién habla**: solo el equipo que mira. El equipo observado (el PC) **no dice nada en voz alta** mientras su cámara se enciende por orden
  de otro dispositivo o lo están mirando; el que narra es el teléfono. El reporte escrito de la ventana **no depende de la voz**: si Eddie
  está contestando otra cosa o la voz se queda atascada, el reporte sigue apareciendo y se dice en cuanto pueda (como mucho a los 12 s).
  La ventana muestra una línea de estado («Imagen: video en vivo · Detector del otro equipo: datos hace 1 s · Voz: lista»), avisa si ve la
  imagen pero el otro equipo no manda datos, y tiene **▶ PROBAR VOZ**: el navegador del teléfono solo deja hablar a una página después de un
  toque, así que si no oyes a Eddie toca ahí una vez.
- **Qué protege la cámara** (pensado para dejar el PC en casa y llevarte el teléfono): (1) el **candado de la cámara** (abajo): sin él
  creado no se enciende nada a distancia, y con él cada encendido pide la prueba; (2) el control remoto, **apagado por defecto y
  activado equipo por equipo**; (3) el **permiso de la cámara, que se da una sola vez delante de ese equipo** con **«Dar permiso de
  cámara»** (muestra «CÁMARA LISTA PARA USO REMOTO»); (4) la sesión de tu cuenta; y (5) el chip rojo «VIGILANCIA · ON / ● TRANSMITIENDO»
  en el equipo observado. Si falta el permiso de la cámara, la orden dice que hay que darlo una vez allí.
- **Video fluido (WebRTC)**: la cámara viaja **directamente de un equipo a otro** (~20 imágenes por segundo, 640×480, menos de 1 Mbit,
  cifrado) sin pasar por el servidor; los dos navegadores se encuentran con mensajes cortos que el servidor guarda un minuto
  (`device_signals`, migración `0011`) y con servidores STUN públicos de Google/Cloudflare. Junto al video viaja por un canal de datos lo que
  detecta (cajas y reporte). **Si no hay camino directo** (algunas redes móviles o empresas lo impiden), Eddie lo intenta 3 veces y cae a
  **una imagen por segundo** por tu cuenta (`device_frames`, una sola fila que se sobrescribe, borrada al cerrar y nunca servida con más de 30 s).
  Para esas redes puedes añadir un relé TURN (gratis en varios proveedores): `TURN_URLS`, `TURN_USERNAME` y `TURN_CREDENTIAL` en Vercel.
- **Cuánto dura y qué necesita cada lado**: la cámara observada sigue mientras la ventana esté abierta (máximo 8 h; sin espectador se
  corta a los pocos segundos); en el equipo observado funciona aunque la pestaña esté en segundo plano (un navegador no congela una página que
  captura la cámara), pero **el equipo debe seguir encendido y despierto, sin suspender al cerrar la tapa** y con Eddie abierto. En el teléfono
  que vigila, Eddie mantiene la pantalla encendida mientras la ventana esté abierta; con la pantalla bloqueada o Eddie cerrado el navegador
  detiene las voces y los reportes (para avisos con el teléfono en el bolsillo harían falta alertas push por evento: no están hechas).
- **Privacidad de la cámara**: encender la cámara en otro equipo no se salta nada: la primera vez ese equipo pide permiso
  (la orden queda en «necesita tu permiso») y el chip rojo «VIGILANCIA · ON» se ve siempre. Una pestaña oculta pausa la vigilancia.
- **Cuentas**: cada dispositivo solo ve los de su cuenta; quitar uno (Quitar) cierra su sesión. Migración `0008_devices.sql`.

### Candado de la cámara (contraseña o huella, una sola vez)

> **Apagado por ahora** (decisión del dueño, 3 oct 2026). Todo el código sigue ahí: para volver a exigirlo pon la variable de entorno
> `CAMERA_LOCK=on` en Vercel y haz Redeploy. Mientras esté apagado, `watch_device` actúa al instante sin tarjeta, Telegram puede
> encender la vigilancia, la vista no pide permiso de lectura y Configuración solo muestra el aviso (la contraseña que ya existiera
> se conserva y vuelve a pedirse al reactivarlo). Lo descrito abajo es el comportamiento con `CAMERA_LOCK=on`.

Para que nadie que entre a tu cuenta (o a tu Telegram) pueda espiarte con tus cámaras, **antes de encender una cámara a distancia hay
que probar que eres tú**. Se configura en **Configuración → Dispositivos → Seguridad de la cámara**:

- **Se crea una sola vez y no vuelve a mostrarse**: eliges **contraseña** (la escribes y la repites, o pulsas «Generar una segura»,
  y **«Copiar»** para llevártela a tu gestor de contraseñas; tienes que marcar que la guardaste) o **huella / rostro / PIN del equipo**
  (una llave de acceso WebAuthn «passkey»: la huella nunca sale del dispositivo y el servidor solo guarda una llave pública). Al crearla
  desaparece de la pantalla: **no hay «ver» ni «cambiar»**, y del servidor solo queda un hash (scrypt) que no se puede revertir.
- **Se pide cada vez que se enciende una cámara a distancia**: en el botón «Activar vigilancia y ver» (aparece dentro de la ventana de
  la cámara), en la tarjeta que sale cuando se lo pides a Eddie por chat o voz, y en cualquier otro equipo. La prueba se canjea en el
  servidor por un **pase de un solo uso que dura 2 minutos** (se guarda su hash, se gasta al encender), así que ni la contraseña
  viaja con la orden ni se puede reutilizar. **Nunca pasa por el chat**: Eddie no la ve, no la pide y un «sí» hablado no sustituye a la tarjeta.
- **Solo se elimina pidiéndoselo a Eddie** («Eddie, elimina la contraseña de la cámara», o el botón de la tarjeta): si la recuerdas, la
  escribes (o usas tu huella) y se borra **al instante**; si la **olvidaste** o perdiste el equipo de la huella, se **programa para dentro
  de 24 horas**: te llega un aviso por notificación y por Telegram y **puedes cancelarla** en la misma tarjeta. Mientras tanto la cámara
  sigue protegida. Después podrás crear otra.
- **Contra intentos de adivinarla**: 5 fallos bloquean 5 min, 8 fallos 15 min… hasta 6 h; al tercer fallo te avisamos por
  notificación y Telegram. Las imágenes de una cámara solo se leen desde un equipo que la encendió con la prueba (permiso de 8 h) y se
  quita al apagarla.
- **Seguro por defecto**: sin candado creado, ninguna cámara se enciende a distancia (la orden lo dice y te lleva a crearlo).
- **Límites que quedan**: quien tenga tu sesión abierta podría **programar** la eliminación (te avisamos y puedes cancelarla en 24 h; si
  no miras tus avisos, esa persona podría crear otro candado a las 24 h); y si olvidas la contraseña, no hay forma de recuperarla,
  solo de eliminarla esperando. Migración `0012_camera_lock.sql`; `api/_lib/devices/cameraLock.js`.

## Notificaciones en segundo plano (Eddie con la app cerrada)

**Configuración → Dispositivos → Notificaciones en segundo plano → «Activar notificaciones aquí»** en cada equipo (Chromebook,
Android, PC, Mac; en iPhone/iPad solo con Eddie añadido a la pantalla de inicio, iOS 16.4 o más). Después, los recordatorios
(«avísame en 20 minutos…») y el resumen de la mañana llegan a ese equipo **aunque Eddie esté cerrado**, sin necesitar Telegram.
Tocar la notificación abre (o enfoca) Eddie en el sitio correcto (el resumen abre Hoy).

- **Cómo funciona**: Web Push estándar. El navegador se suscribe con la llave pública del servidor y guarda su dirección en
  `push_subscriptions` (migración `0009_push.sql`); el trabajo programado (`/api/connectors/cron`, cada 5 min con GitHub Actions)
  envía el aviso cifrado al servicio de notificaciones del navegador (Google, Mozilla, Apple, Microsoft) y el *service worker*
  (`public/sw.js`) lo muestra. Si el aviso se entrega por Telegram **o** por notificación, cuenta como enviado.
- **Sin configurar nada**: la llave VAPID se crea sola la primera vez y se guarda en Neon con la parte privada cifrada con
  `CONNECTOR_SECRET` (el mismo de Gmail/Spotify; no se muestra ni se pega en ningún sitio). Opcional: `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en Vercel para usar las tuyas.
- **Probar**: «Enviar prueba» en la misma tarjeta. Desactivar: «Desactivar aquí» (o quita el permiso en el candado del navegador);
  un navegador que ya no existe se borra solo cuando el servicio de notificaciones lo informa.
- **Qué no puede un navegador** (y por qué no lo hace Eddie): escuchar el micrófono o la palabra clave con la app cerrada o el
  teléfono bloqueado, ni abrir la cámara: eso exige una app nativa. Para hablarle desde cualquier lugar, Telegram (texto y notas de
  voz) ya funciona en segundo plano. Con la app abierta pero minimizada, la palabra clave sigue mientras el navegador no pause la
  pestaña, y la vigilancia se apaga sola tras 2 min oculta.
- **Límites**: hasta 10 dispositivos por cuenta; los avisos pueden tardar unos minutos (el trabajo programado corre cada 5 min);
  solo se acepta enviar a los servicios reales de notificaciones (lista cerrada), nunca a una dirección arbitraria.

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

## Spotify (música por voz)

«Pon música de Bad Bunny», «pausa», «siguiente canción», «sube el volumen a 60», «¿qué suena?»: Eddie busca y controla la
reproducción de **tu cuenta de Spotify**. Es un conector por cuenta (OAuth): se vincula desde **Conectores → Conectar
Spotify** y se puede quitar con **Desconectar Spotify**.

- **Qué hace**: `spotify_search` (canciones, artistas, álbumes, playlists), `spotify_play` (el primer resultado, o
  reanudar lo que sonaba), `spotify_control` (pausar, reanudar, siguiente, anterior, volumen, aleatorio) y
  `spotify_now_playing`. Tras poner o pausar, Eddie vuelve a leer el reproductor y lo anota en el recibo como
  «comprobado». Solo pide permisos de **lectura y control de la reproducción**; nunca toca tus listas ni tu biblioteca.
- **Lo que necesita Spotify**: una cuenta **Premium** (Spotify no deja controlar la reproducción desde otras apps con
  cuentas gratis) y **Spotify abierto en algún dispositivo**: la app del teléfono o del computador, o
  open.spotify.com en una pestaña. Si no hay ninguno activo pero hay uno abierto, Eddie lo arranca ahí; si no hay
  ninguno, te lo dice.
- **Configurarlo** (una vez): en https://developer.spotify.com/dashboard crea una app («Web API»), agrega como
  **Redirect URI** `https://TU-DOMINIO/api/connectors/spotify/callback` (o la de `SPOTIFY_REDIRECT_URI`) y, mientras la
  app esté en modo desarrollo, agrega tu correo de Spotify en **User Management**. En **Vercel → Settings →
  Environment Variables → Production** pon `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` (junto a `CONNECTOR_SECRET`,
  `DATABASE_URL` y `APP_URL`, que ya usan Google y Telegram) y vuelve a desplegar. Nunca pegues esas claves en el chat.
  Hace falta aplicar `db/migrations/0007_spotify.sql` (tabla `spotify_credentials`; los tokens se guardan cifrados).
- **Cómo funciona**: `/api/connectors/spotify/{connect,callback,disconnect}` viven en la misma función de conectores
  (no suman funciones a Vercel). Eddie solo le ofrece estas herramientas a la IA cuando la conversación habla de música.
  También funciona desde Telegram.

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

## Recordatorios y resumen de la mañana (Telegram y notificaciones)

Eddie te avisa solo, por Telegram o con una notificación en tus dispositivos (ver «Notificaciones en segundo plano»), aunque tengas la app cerrada. Basta con uno de los dos:

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

Comandos: `/llamar`, `/resumen`, `/recordatorios`, `/uso`, `/restaurar`, `/voz on|off` (contestar siempre con voz), `/nuevo`
(conversación nueva), `/ayuda`, `/desvincular`. Si `EDDIE_OWNER_EMAIL` está
definido, solo esa cuenta puede vincular Telegram. Eddie solo responde en tu
chat privado vinculado; en grupos no contesta.

## Criterio: Eddie se apoya en lo que ya sabe

Sin que tengas que decirle «recuerda que…», en cada respuesta Eddie cuenta con lo que sabe de ti: la memoria (perfil,
preferencias, proyectos, **decisiones con su fecha**, contexto vigente), las notas de conversaciones anteriores, lo que
aprendió en el segundo cerebro y tus tareas pendientes. Antes de hacer o aceptar algo que cambia cosas (editar, borrar,
mover, enviar, comprar, publicar, cancelar…) lo compara con eso: si choca con una decisión tuya, una preferencia, un plan
en curso o algo que salió mal, **no lo hace todavía** y responde algo como «Eso no es conveniente, ya que me dijiste el
12 de sep que…», con una alternativa y la pregunta de si lo hace igual (si insistes tras escucharlo, lo hace). Solo advierte con
evidencia que tenga a la vista: si nada choca, lo hace sin comentarios y nunca inventa datos pasados.

**Carácter propio (párrafo CONCIENCIA):** Eddie no espera a que le preguntes. Da su opinión sincera, aconseja y advierte
(lo dejas para el último momento, repites un error, lo que pides contradice tus metas o un compromiso que le contaste,
descuidas tu descanso). Si insistes en algo que ya te advirtió o repites un patrón que te perjudica, se pone firme y te da
un pequeño sermón de 3 o 4 frases, con cariño y con datos tuyos; solo cuando lo merece, nunca el mismo consejo dos veces
seguidas, y la decisión final siempre es tuya. No humilla ni manipula ni moraliza sobre lo que no le contaste.
- Para las peticiones de **cambio** busca más a fondo en las conversaciones (hasta 5 notas, umbral más bajo, un poco más de
  espera: `api/_lib/episodes/recall.js`, `isActionRequest`); para la charla normal sigue siendo rápido.
- La regla vive en el párrafo CRITERIO de `src/services/personality.js` y vale también en Telegram. Se apaga con el
  conector *Recuerdos de conversaciones* (Conectores) o la memoria desde Configuración.
- Límite honesto: depende de que Eddie haya guardado antes esa decisión (se guardan solas al cerrar una conversación o
  cuando lo cuentas) y de que el modelo la tenga delante; con un modelo pequeño puede dejar pasar alguna advertencia.

## Respuestas en Telegram, cupo por tanda y respuestas largas

- **A Telegram solo llegan los resultados, no la charla.** Eddie conversa y pregunta todo en el chat de la app; cuando termina
  un trabajo que produce algo para guardar o consultar (un informe, un resumen largo, una redacción, un borrador, un plan, la
  agenda de la semana), lo manda con la herramienta `send_to_telegram` (título + contenido completo) y en el chat solo dice
  en una o dos frases qué envió, para no llenarlo. Los saludos, «de nada», las respuestas cortas y las preguntas se quedan en
  la app. Las **imágenes** que crea o edita llegan siempre como foto. Si le pides «mándamelo a Telegram» lo hace aunque sea corto;
  si le pides «aquí en el chat» o «léemelo», no lo envía. Lo enviado queda en el hilo de Telegram, así puedes seguir desde allí
  («hazlo más corto»). Sin Telegram vinculado (Conectores) o con el envío apagado, lo entrega en el chat. Se apaga en
  Configuración → Dispositivos → *Uso y Telegram*. Código: `api/_lib/telegram/mirror.js` y `api/_lib/connectors/telegram/`.
- **Cupo diario repartido en tandas** (`api/_lib/usage/`): `DAILY_REQUEST_LIMIT` (por defecto 50, `0` = sin límite) se parte en
  la mitad para la **mañana** (de las 00:00 a las 14:00) y la mitad para la **tarde** (de las 14:00 a las 24:00, cambia la hora con
  `QUOTA_SPLIT_HOUR`), en la zona horaria de tu navegador o de tu Telegram (`QUOTA_TIMEZONE` si no se sabe). Cada tanda **se
  restaura sola** cuando empieza la siguiente y el día a medianoche; lo que no uses por la mañana no se acumula, así nunca
  gastas todo temprano. Cuenta cada pregunta que Eddie contesta (app y Telegram; no cuentan las voces, transcripciones, la cámara
  ni las que fallan sin respuesta). Al llegar al tope Eddie dice cuándo se restaura. Puedes devolverle el cupo a la tanda actual con
  el botón de Configuración → *Uso y Telegram*, o con `/restaurar` (y ver cuánto llevas con `/uso`). Tabla `usage_counters`
  (migración `0015_usage.sql`). Si la base de datos falla, Eddie sigue contestando (no se bloquea por su propio contador).
- **Que no se caiga cuando piensa mucho**: mientras Eddie piensa, el servidor manda un latido cada 4 s para que la conexión no se
  dé por muerta; el silencio permitido a un modelo pasó de 12 a 25 s (y de 20 a 40 s por intento, con tope de 50 s en total para
  caber en los 60 s de Vercel). Si aun así se corta, la app lo dice con claridad (antes la respuesta podía quedar a medias en
  silencio). En Telegram, si Eddie no alcanza a responder en ~54 s, te avisa «tardé demasiado» (y no te descuenta la petición)
  en vez de quedarse mudo.
- **Respuesta vacía de Gemini** («Gemini no devolvió contenido utilizable»): Eddie ya no se rinde al primer intento. Reintenta tal cual; si sigue vacía, reintenta con el
  «pensamiento» normal del modelo (el mínimo a veces lo deja sin nada que decir) y por último sin herramientas; solo entonces pasa a Groq/OpenRouter. Si aun así falla,
  el mensaje trae el detalle técnico (modelo, motivo y lo que llegó) y el registro de Vercel guarda `[callGemini] empty response …` con el intento, el pensamiento, si había herramientas y el último dato recibido.
  También se leen mejor las respuestas en streaming: saltos de línea `\r\n`, un último evento sin su línea en blanco y cuerpos JSON simples; y un **error dentro de un stream que ya empezó**
  (p. ej. «el modelo está sobrecargado», que Gemini manda con estado 200) se reintenta una vez y, si persiste, se muestra tal cual (y pasa a Groq/OpenRouter) en vez de contarse como «vacío».

## Documentos .md y conversaciones clasificadas (los dos cerebros)

- **Un .md sobre cualquiera de los dos cerebros**: en Memoria, suelta un archivo `.md` (o usa «Subir documento .md») sobre el orbe de
  **memoria** o sobre el mapa del **segundo cerebro**. Eddie lo lee con una llamada de IA y lo **clasifica por lo que dice**
  (`api/_lib/brain/`, tipos en `src/services/brainKinds.js`):
  - sobre el **orbe de Memoria** (primer cerebro) cada dato va a su categoría: *dato personal* → Perfil, *preferencia* → Preferencias,
    *proyecto* → Proyectos, *decisión* → Decisiones, *conocimiento* → Conocimientos, *contexto temporal* → Contexto temporal y
    *habilidad / posible skill* → Conocimientos como «Habilidad · …». Se aplica a tu memoria como si Eddie lo hubiera recordado
    en el chat (y se sincroniza con tu cuenta);
  - sobre el **segundo cerebro** el documento entra como **un tema** (título, resumen, de 4 a 12 notas con vectores), de tipo *habilidad* o
    *tema* y con su color (empresarial, técnica…); si lo vuelves a soltar, lo actualiza. Si además contiene datos personales,
    preferencias o proyectos, te avisa para que lo sueltes también en Memoria.
  Hasta 150 KB y unos 30.000 caracteres analizados (en 3 partes; si es más largo lo dice). Cuenta como **una petición** del cupo del día.
  El contenido del documento se trata como datos, nunca como instrucciones, y lo que devuelve la IA se valida y recorta antes de guardarse.
- **Las conversaciones ya no solo se guardan: se analizan.** Al cerrarse una conversación (app o Telegram) la misma llamada que hacía el
  resumen ahora devuelve también la información **clasificada** (solo lo que *tú* dijiste o confirmaste): los datos, preferencias,
  proyectos, decisiones y contexto temporal van a la **memoria** (la app los aplica; desde Telegram se escriben en tu cuenta) y las
  **habilidades** que aparezcan van al **segundo cerebro** como notas de un tema de tipo *habilidad* (las siguientes conversaciones
  suman notas al mismo tema sin repetirlas). Respeta los interruptores: con la memoria apagada no se escribe en ella y con el
  conector «Segundo cerebro» apagado no se guardan habilidades. Sin costo extra de IA: es la misma llamada del resumen.
- Por ahora los `.md` se suben desde la app (no por Telegram).

## Imágenes: crear, editar y eliminar (Galería)

- **Desde el chat o por voz**: «dibújame un faro al amanecer», «hazme un logo…», y luego «quítale el fondo», «hazla de noche»,
  «elimina la última imagen». Eddie usa las herramientas `create_image`, `edit_image`, `list_images` y `delete_image`
  (conector **Imágenes**, `api/_lib/connectors/media/`). Eliminar pide tu confirmación con una tarjeta. Si adjuntas una imagen al
  mensaje, la edita a ella; si no, edita la última (o la que nombres de la galería). La edición se guarda como una imagen nueva y la
  original se conserva. Eddie no ve lo que crea: te dice en una frase qué hizo y ofrece ajustarla.
- **Dónde aparece**: en el **centro del anillo de Inicio** (el disco libre; «Quitar la imagen del centro» la limpia), debajo de la
  respuesta en el chat, en la **Galería** (módulo nuevo: crear con una descripción y una forma 1:1, 16:9, 9:16, 4:3 o 3:4, abrir,
  **editar con una instrucción**, mostrar en el centro, descargar y eliminar) y en tu **Telegram** como foto (con el interruptor de
  Configuración → «Uso y Telegram»).
- **Con qué**: el modelo de imágenes de **Gemini** con tu misma `GEMINI_API_KEY` (cupo gratis diario; el cupo real lo fija Google y cambia,
  mídelo con tu clave). Modelo: `gemini-2.5-flash-image` o `GEMINI_IMAGE_MODEL`; si el modelo desaparece, Eddie elige otro de imágenes que tu clave
  pueda usar. **Respaldo**: si Gemini se queda sin cupo o falla, una imagen *nueva* (no una edición) puede salir de **Pollinations**
  (gratis, sin clave; el texto de la descripción sale hacia ese servicio; `MEDIA_FALLBACK=off` lo desactiva) y Eddie lo dice.
  Nunca se usa el respaldo cuando Gemini rechaza el contenido.
- **Dónde se guardan**: en tu base de datos de Neon (`media_items`, migración `0016_media.sql`), sin servicio extra: hasta **60 imágenes o 150 MB**
  (si se llena, Eddie te pide eliminar alguna; nunca borra solo). Cada imagen se sirve solo a su dueño con sesión iniciada.
- **Límites**: `DAILY_IMAGE_LIMIT` imágenes por 24 horas (20 por defecto, 0 = sin límite); además, hacer una imagen desde la Galería cuenta como
  una petición del cupo diario (desde el chat ya cuenta la petición del mensaje). Una imagen fallida no gasta cupo.
- **Seguridad**: lo que devuelve el proveedor se comprueba (debe ser de verdad PNG, JPEG o WebP, de máximo 6 MB; si no, se descarta) y las
  descripciones se limpian y recortan a 800 caracteres. Gemini aplica su propia política de contenido y la herramienta le pide a la IA no crear
  imágenes sexuales, de menores ni que suplanten a personas reales.
- **Video**: todavía no. Para video no hay APIs gratis fiables (Veo y similares son de pago); se verá después con un presupuesto.

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

Solo funciona en el equipo donde corre la sonda. Para el teléfono o Telegram está EDDIE Prime (abajo).

## Tu equipo desde cualquier lugar (EDDIE Prime)

Con el agente `eddie_agent.py` en tu Chromebook, Eddie lo consulta y lo maneja desde la web, el teléfono o
Telegram: "¿cuánto disco me queda?", "¿qué está gastando memoria?", "abre la terminal". El agente no tiene IA
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

## App instalable (PWA)

Eddie se puede **instalar como app** en el Chromebook, el computador o el teléfono (Chrome o Edge): menú del navegador →
**Instalar Eddie**, o el botón **Instalar Eddie** de Configuración → *Aplicación* cuando el navegador lo permite. Se
abre en su propia ventana, desde el lanzador, y trae **atajos** (clic derecho o mantener pulsado el ícono): *Hablar con
Eddie* (abre Inicio con el orbe listo; un toque y escucha), *Modo Vigilancia*, *Mis tareas* y *Hoy*. Los mismos enlaces
sirven en el navegador: `/?modulo=tareas|hoy|chat|memoria|conectores|configuracion` y `/?accion=hablar|vigilancia`.

- **Sin conexión**: tras abrir Eddie una vez con internet, el *service worker* (`public/sw.js`) guarda **solo la propia
  app** (la página, sus scripts y estilos, los íconos). Sin internet abre, muestra «SIN RED» y deja ver tus tareas, tu
  memoria y tus chats guardados (están en el navegador); para hablar con la IA hace falta internet.
- **Qué nunca guarda**: todo lo de `/api` (sesión, IA, voz, cámara) va siempre a la red y no se almacena; tampoco lo que
  no sea de la propia dirección (fuentes, mapas, clima) ni nada que no sea una lectura (GET).
- **Actualizaciones**: la página se pide primero a la red, así que una versión nueva aparece al volver a abrir Eddie con
  internet; si la red tarda más de 4 s se usa la copia guardada. Solo se registra en producción (no en `npm run dev`).
- Vercel sirve `sw.js` sin caché (`vercel.json`); para probarlo en local: `npm run build && npm run preview`.

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
- **Solo la propia página puede usar la API** (`api/_lib/requestGuard.js`): `/api/chat` y sus acciones (voz, transcripción,
  visión, confirmaciones) ya no aceptan llamadas de navegador desde otros sitios (antes respondían con
  `Access-Control-Allow-Origin: *`, es decir, cualquier página podía gastar tu cuota de IA). Si tu página vive en otra
  dirección, agrégala a `ALLOWED_ORIGINS` (separadas por comas). Los cambios que usan tu sesión (tareas, memoria,
  ajustes, calendario, Drive, cuenta, conectores) además rechazan un POST/PUT/PATCH/DELETE que venga de otro sitio, aunque
  la cookie `SameSite=Lax` ya no se enviaría. Telegram, el agente EDDIE Prime y el cron no son navegadores y siguen
  entrando con su propio secreto o token.
- **Límites por minuto y por dirección** (en memoria de cada instancia): chat 60 (`CHAT_MAX_PER_MINUTE`), transcripción 40
  (`TRANSCRIBE_MAX_PER_MINUTE`), voz 120 (`SPEAK_MAX_PER_MINUTE`), confirmaciones 60 (`CONFIRM_MAX_PER_MINUTE`) y cámara 20
  (`VISION_MAX_PER_MINUTE`). Responden 429 con `Retry-After`.
- El nombre de modelo que manda el navegador se valida (letras, números y `. _ : -`, y `/` solo en Groq/OpenRouter; nunca
  `..`): no puede cambiar la dirección de la petición al proveedor.
- Los accesos de Spotify y Google se guardan cifrados (AES-256-GCM); las acciones delicadas (enviar, borrar, mover) siempre
  piden tu confirmación en una tarjeta; sin ejecución de código arbitrario en el navegador. Ver `docs/seguridad.md`.

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
  migrations/0005_whatsapp.sql       (retirada: WhatsApp se quitó; sus tablas ya se borraron de Neon)
  migrations/0008_devices.sql        Dispositivos de la cuenta y sus órdenes
  migrations/0009_push.sql           Notificaciones push (llaves, suscripciones)
  migrations/0010_device_frames.sql  Última imagen compartida para la vista remota (respaldo)
  migrations/0011_device_signals.sql Mensajes para conectar el video en vivo entre dos equipos
  migrations/0012_camera_lock.sql    Candado de la cámara (hash de la contraseña, llaves, pases de un solo uso, permisos de lectura)
  migrations/0013_knowledge.sql      Segundo cerebro (temas y notas aprendidas con vectores)
  migrations/0014_knowledge_category.sql  Tipo de conocimiento de cada tema (color del mapa)
  migrations/0015_usage.sql          Peticiones usadas por día y tanda (cupo diario)
  migrations/0016_media.sql          Galería de imágenes (bytes, descripción, edición de origen)
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
