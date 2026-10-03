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
