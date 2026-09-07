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
| Tareas | Lista de tareas con prioridad, fecha de entrega y recordatorio de la más próxima |
| Documentos | Genera resúmenes/informes/guías/cuestionarios y los exporta a TXT, CSV, DOCX o PDF |
| Configuración | Proveedor y modelo de IA, idioma, tema, memoria (ver/eliminar) |

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

- Las claves de API solo existen en variables de entorno del servidor.
- Toda solicitud a `/api/chat` se valida (proveedor permitido, longitud de
  mensajes, tamaño del historial) antes de reenviarse al proveedor.
- El historial de conversación, las tareas y la memoria se guardan en
  `localStorage` del navegador — no se envían a ningún servidor propio ni de
  terceros salvo el contenido de los mensajes que decides enviar a Eddie.
- Puedes borrar el historial de conversación y la memoria en cualquier
  momento desde Configuración.
- CORS restringido a los métodos necesarios; sin ejecución de código
  arbitrario en el navegador.

## Despliegue

### Opción recomendada: Vercel (frontend + backend en un solo proyecto)

1. Sube el repositorio a GitHub.
2. Importa el repo en Vercel.
3. En "Environment Variables" añade `GEMINI_API_KEY` y/o `ANTHROPIC_API_KEY`.
4. Vercel detecta `vercel.json`: construye el frontend con Vite (`dist/`) y
   despliega `api/chat.js` y `api/health.js` como funciones serverless.

No se requiere configuración adicional: mismo dominio para frontend y API.

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

## Estructura del proyecto

```
api/                  Funciones serverless (Vercel) + lógica compartida
  _lib/handler.js      Validación de solicitudes
  _lib/providers.js     Adaptadores Gemini / Claude
  chat.js, health.js
server/
  dev-server.js        Servidor Express para desarrollo local
src/
  components/          Chat, Voice, Study, Code, Tasks, Documents, Settings, Core, Layout
  context/             SettingsContext, VoiceContext, ChatContext
  hooks/               useSpeechRecognition, useSpeechSynthesis, useProviderHealth
  services/            api.js (fetch al backend), personality.js (prompt de Eddie)
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
