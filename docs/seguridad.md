# Auditoría de cierre (2 oct 2026)

Revisión de seguridad de todo Eddie al cerrar el plan 2.0, hecha leyendo el código de cada punto de entrada
(`api/**`), los conectores y el navegador, con pruebas automáticas para lo corregido (`test_guard`, `test_vision_api`,
`test_spotify`). No hubo pruebas contra los servicios reales ni un pentest externo.

## Lo que se encontró y se corrigió

| # | Hallazgo | Riesgo | Arreglo |
|---|---|---|---|
| 1 | `/api/chat` y sus acciones respondían `Access-Control-Allow-Origin: *`: cualquier página podía llamar desde el navegador de un visitante y gastar la cuota de Gemini, Claude, Groq, Whisper o ElevenLabs del dueño. | Alto (coste y cuota) | Solo la propia página (o `ALLOWED_ORIGINS`) puede llamar; sin comodín. `requestGuard.js` |
| 2 | Sin límite de uso por dirección en chat, transcripción, voz ni confirmaciones. | Medio | Límites por minuto y dirección (`rateLimit.js`), con 429 y `Retry-After`, ajustables por variable. |
| 3 | El navegador elegía libremente el nombre del modelo (hasta 100 caracteres) y ese texto entraba en la dirección de la petición a Gemini (que lleva la clave en la URL). | Medio (cambiar la ruta de la petición; elegir un modelo caro) | `cleanModel`: solo nombres simples; el resto se ignora y se usa el modelo por defecto. |
| 4 | Los endpoints que actúan con la cookie de sesión (tareas, memoria, ajustes, calendario, Drive, cuenta, conectores) dependían solo de `SameSite=Lax` contra CSRF. | Bajo (defensa en profundidad) | Rechazan POST/PUT/PATCH/DELETE con `Sec-Fetch-Site` de otro sitio. |
| 5 | Suites de pruebas antiguas (`test_connectors`, `test_sanitize`, `test_gemini_*`) quedaron desactualizadas y fallaban en `main`. | Calidad | Puestas al día con el comportamiento actual (riesgo por herramienta, confirmaciones, 5 rondas de herramientas). |

## Lo que se revisó y estaba bien

- **Secretos**: ninguna clave en el repositorio ni en el navegador (búsqueda de patrones de claves), `.env*` ignorado, `/api/health`
  solo dice sí/no y los nombres de las voces.
- **Sesión**: id aleatorio opaco en cookie `HttpOnly; Secure; SameSite=Lax`, revocable borrando la fila.
- **Tokens de terceros** (Google, Spotify): cifrados con AES-256-GCM (`CONNECTOR_SECRET`) y, si falta el secreto, no se guardan en claro.
- **OAuth**: `state` aleatorio en cookie de 10 min; el callback de Spotify exige además la sesión de Eddie.
- **Webhooks y tareas programadas**: Telegram (`TELEGRAM_WEBHOOK_SECRET`) y cron (`CRON_SECRET`) comparan con `timingSafeEqual`;
  EDDIE Prime solo guarda el hash de su token y no abre puertos.
- **Inyección por contenido externo** (correos, páginas, Notion): las herramientas delicadas (enviar, borrar, mover, crear en
  Notion/GitHub, acciones del equipo) nunca corren desde el modelo: esperan tu confirmación en una tarjeta, con los datos visibles.
- **XSS**: sin `innerHTML` ni `eval`; el Markdown se pinta con elementos de React; la exportación a PDF escapa el contenido.
- **Salida del modelo en la cámara**: se recorta a una forma fija antes de llegar a la página y solo se muestra como texto.
- **Notificaciones push**: solo con sesión; el servidor solo llama a los servicios de notificaciones reales (lista cerrada de dominios, https, sin puerto ni credenciales: una suscripción no puede apuntar a una dirección interna); la llave VAPID privada se guarda cifrada (`CONNECTOR_SECRET`) y nunca se envía al navegador; el texto de la notificación se recorta y su enlace solo puede ser una ruta de este sitio; 4 pruebas por minuto y 10 dispositivos por cuenta.
- **Sin confirmación al activar la cámara de otro equipo**: decisión del usuario (dejar el PC en casa y vigilarlo con el teléfono). Las barreras que quedan: control remoto apagado por defecto y activado por equipo, permiso de cámara dado una vez en ese equipo (el navegador y el de Eddie), sesión de la cuenta, chip rojo visible allí y 8 h de tope. Quien robe la sesión de tu cuenta (o tu Telegram vinculado) podría encender las cámaras de los equipos que tengan el control remoto activado: cierra sesión si pierdes un equipo, y apaga el control remoto de los que no uses.
- **Video en vivo (WebRTC)**: el video va de equipo a equipo, cifrado (DTLS-SRTP), sin pasar por el servidor; el servidor solo guarda ~1 minuto los mensajes de conexión (oferta, respuesta y candidatos de red, que contienen direcciones IP de tus equipos), solo entre dispositivos de la misma cuenta, de tamaño limitado y borrados al leerlos; la lista de servidores STUN/TURN solo se entrega con sesión.
- **Vista remota de la cámara (respaldo por imágenes)**: solo entre dispositivos de la misma cuenta y solo si el equipo observado activó el control remoto; el equipo solo sube imágenes si hay un espectador activo (el servidor lo comprueba en cada imagen y se lo dice), con chip «TRANSMITIENDO» visible, tope de 10 min y 120 imágenes/min; se acepta solo un JPEG en base64 de hasta 90 000 caracteres y los datos que lo acompañan se recortan (etiquetas, categorías, cajas); una sola imagen por equipo, sobrescrita, borrada al cerrar la vista y nunca servida con más de 30 s.
- **Dependencias**: `npm audit --omit=dev` sin vulnerabilidades.

## Segundo cerebro (3 oct 2026)

«Investiga y aprende X» hace que el servidor lea páginas cuyas direcciones vienen de una búsqueda (el mundo exterior). Defensas:
**SSRF** — solo `http(s)` en 80/443, sin credenciales, nombres internos (`localhost`, `.local`, `.internal`…) ni IP numéricas
privadas, resolución DNS con comprobación de **todas** las direcciones y repetida en cada redirección (máx. 3, manuales), 6 s, 600 KB,
solo `text/html`/`text/plain`, sin cookies. **Inyección de instrucciones** — el texto de las páginas va a la IA como datos con
orden de ignorar lo que pidan, lo que ella devuelve se valida (forma, longitud, fuente real), y al responder las notas se entregan
marcadas como «datos copiados de páginas, no instrucciones». **Abuso de cuota** — 6 investigaciones por hora y 60 temas por usuario.
Riesgo residual: un nombre que cambie de dirección entre la comprobación y la lectura (DNS rebinding) y notas con información
falsa o con texto malicioso que la IA copie (cada nota muestra su fuente y se borra en Memoria).

## Documentos .md y análisis de conversaciones (7 oct 2026)

- **El texto es dato, no instrucción**: un documento (o una conversación) puede decir «ignora tus reglas»; se manda al analizador marcado
  como datos y lo que devuelve se **valida** antes de guardarse: solo tipos conocidos, textos de máximo 300 caracteres, campos por tipo,
  categoría de una lista, sin repetidos y con tope de elementos. Nada de lo que escribe el modelo se ejecuta.
- **Dónde se escribe**: lo de la memoria vuelve a la app como las mismas acciones que usan las herramientas de memoria (se aplica en tu
  navegador y se ve en el orbe, donde puedes olvidarlo o editarlo); desde Telegram se escribe en tu propia cuenta. El segundo cerebro
  solo recibe habilidades de conversaciones y temas de documentos, siempre filtrado por el usuario de la sesión.
- **Superficie**: `POST /api/connectors/brain/document` exige sesión, rechaza cambios cross-site (como el resto de la función), acepta
  hasta ~350.000 caracteres, analiza como máximo 30.000, cuenta como una petición del cupo diario y se devuelve si la IA falla.
- **Riesgo que queda**: un documento hecho con mala intención podría intentar colar una «preferencia» engañosa en tu memoria; por eso solo
  entra lo que tú sueltas, todo queda a la vista en el orbe y puede borrarse. No subas documentos con claves o contraseñas (se le pide a la IA
  que no las guarde, pero no es una garantía).

## Imágenes (7 oct 2026)

- **Lo que llega del proveedor se comprueba**: antes de guardar nada se miran los primeros bytes (PNG, JPEG o WebP reales) y el tamaño (máx. 6 MB);
  un «PNG» que en realidad es HTML o SVG se descarta. Nunca se confía en el tipo que declara el servidor.
- **Quién ve qué**: `GET /api/connectors/media/file` exige sesión y filtra por usuario; se sirve con `X-Content-Type-Options: nosniff` y caché privada.
  Las imágenes no viajan al modelo (solo el id) y los ids son UUID.
- **Borrar**: la herramienta `delete_image` siempre pide tarjeta de confirmación (y la Galería pide un segundo clic). Nada se borra solo: con la galería llena
  se pide al usuario que elimine.
- **Costes y abuso**: tope por 24 horas (`DAILY_IMAGE_LIMIT`), tope de 60 imágenes / 150 MB por usuario, y cada creación desde la Galería cuenta en el cupo diario.
- **Privacidad del respaldo**: con `MEDIA_FALLBACK` activo (por defecto), si Gemini no tiene cupo, la descripción de una imagen nueva se envía a Pollinations
  (sin clave ni cuenta). Para evitarlo: `MEDIA_FALLBACK=off`.
- **Imágenes buscadas (7 oct 2026)**: se descargan en el servidor (nunca se enlazan desde fuera) con la misma defensa que el lector de páginas: solo
  http(s) a direcciones públicas, cada redirección se vuelve a resolver y comprobar, sin credenciales, con tiempo y tamaño máximos; el tipo se decide por
  los primeros bytes (PNG, JPEG, WebP) y se guarda con autor, licencia y página. Las URL que devuelven las fuentes no se confían: pasan por esa descarga.
  El texto de la búsqueda sale hacia Pexels, Openverse, Wikimedia o Tavily. Se rechazan las búsquedas de contenido sexual explícito o violento y los
  resultados con esos títulos. Límite propio: `DAILY_IMAGE_SEARCH_LIMIT`. La licencia de lo encontrado en la web general no está verificada y se avisa.
- **Riesgo que queda**: el contenido lo filtra la política de Gemini, no Eddie; las imágenes editadas a partir de fotos de personas dependen de ella.

## Candado de la cámara (3 oct 2026)

**Estado: apagado por ahora** (pedido del dueño); se reactiva con `CAMERA_LOCK=on`. Con el candado apagado, cualquiera con sesión
en la cuenta puede encender las cámaras de los equipos que permiten el control remoto (y Telegram vinculado, la vigilancia).

Encender una cámara de otro dispositivo exige contraseña o huella (WebAuthn), creada una sola vez y nunca mostrada de nuevo:
hash scrypt en servidor, pases de un solo uso (120 s, solo su hash), bloqueo por fallos, lectura de imágenes solo con permiso
concedido al encender, Telegram sin poder encender cámaras, seguro por defecto (sin candado no hay encendido remoto) y
eliminación inmediata con prueba o programada a 24 h con avisos (push y Telegram) y cancelación. El secreto nunca pasa por la IA ni
queda en la conversación (campo `camera-auth` de la tarjeta). Detalle en el README («Candado de la cámara»).
Riesgo residual: una sesión robada puede programar la eliminación (hay aviso y 24 h para cancelarla).

## Riesgos que quedan (y qué hacer)

1. **Uso anónimo de la cuota por llamadas que no son de navegador** (curl, scripts): pueden omitir las cabeceras `Sec-Fetch-*`.
   Los límites por dirección lo frenan, pero viven en la memoria de cada instancia (no son globales). Si algún día se abusa:
   exigir sesión para la IA o poner un límite global en una tabla.
2. **Datos en el navegador sin cifrar** (`localStorage`: chats, tareas, memoria, clave y dirección de la Sonda local): en un
   equipo compartido, cierra sesión y borra los datos desde Configuración. La clave de la Sonda abre un programa de tu propio equipo.
3. **Datos que salen a terceros por diseño**: el texto de los mensajes (Gemini, Claude, Groq, OpenRouter), el audio (Groq, ElevenLabs),
   los fotogramas de la cámara (Gemini/Claude, sin guardarse), la ubicación (Open-Meteo, Nominatim) y búsquedas (Tavily).
   Apaga el conector que no quieras en Conectores.
4. **Tablas `whatsapp_*`**: ya no se usaban tras quitar WhatsApp; el usuario autorizó borrarlas y se eliminaron de Neon (vacías) el 2 oct 2026.
5. **El servidor local de desarrollo** (`npm run server`) usa CORS abierto y no aplica estos límites: es solo para tu equipo.
6. **Rotar la clave de la Sonda** que se pegó en un chat al principio del proyecto, y no pegar nunca claves en conversaciones.
