# Arquitectura de voz en tiempo real (diseño, no implementado)

## Estado actual vs. lo que se propone

Hoy Eddie no tiene ningún pipeline de voz "en vivo": `useSpeechRecognition`
(STT) y `useSpeechSynthesis` (TTS) son wrappers delgados sobre la Web Speech
API del navegador. Son turnos discretos, no un stream:

```
[usuario habla] → SpeechRecognition (todo en el navegador, sin red)
                → transcript final
                → sendChatMessage() → /api/chat (HTTP + SSE-a-NDJSON, ya
                  implementado, ver docs/javascript.md)
                → texto de Eddie completo
                → speechSynthesis.speak(texto) (todo en el navegador)
```

No hay WebRTC, no hay VAD, no hay streaming de audio en ningún sentido — el
audio nunca sale del navegador. Este documento diseña qué haría falta para
llegar a una conversación por voz real: Eddie escuchando continuamente,
respondiendo con audio a medida que genera texto, y permitiendo que el
usuario lo interrumpa a mitad de una respuesta ("barge-in"), con latencia
percibida por debajo de ~1s desde que el usuario termina de hablar hasta que
empieza a escuchar la respuesta.

**Esto es un documento de diseño para decidir alcance y luego implementar
por fases — no hay código nuevo en este PR.** El motivo: construirlo a
ciegas de una sola vez implica elegir proveedores de STT/TTS con costo real
por minuto, decidir si el audio pasa por nuestro backend o va directo del
navegador a un proveedor, y dimensionar cuánto de esto cabe en el plan
gratuito de Vercel — decisiones que vale la pena que el usuario confirme
antes de escribir infraestructura nueva.

## Por qué el diseño actual (HTTP + Web Speech API) no llega a <1s

1. **STT por turnos, no streaming.** `SpeechRecognition.onresult` sí entrega
   resultados interinos, pero el evento `isFinal` solo llega cuando el
   navegador decide que terminaste de hablar (silencio ~1-2s) — ese propio
   silencio ya consume gran parte del presupuesto de 1s.
2. **La respuesta del LLM se pide completa antes de hablar.** Aunque el
   texto ya llega en streaming al Chat (PR de streaming reciente), TTS hoy
   se dispara sobre `lastReply` — el mensaje ya terminado — no sobre cada
   frase a medida que llega.
3. **Sin barge-in.** Nada detiene `speechSynthesis` si el usuario empieza a
   hablar de nuevo; hay que parar el micrófono manualmente y no hay
   detección de que el usuario quiere interrumpir.
4. **Web Speech API depende 100% del navegador** (calidad/voces variables,
   Firefox no la soporta, Safari es limitado) — no es una base sobre la que
   construir barge-in ni control fino de latencia.

## Arquitectura propuesta

### Visión general

```
┌─────────────┐   WebRTC audio (Opus, 20ms frames)   ┌──────────────────┐
│  Navegador  │ ─────────────────────────────────────▶│  Media Gateway   │
│ (mic + VAD  │                                        │ (nuevo servicio, │
│  local +    │◀───────────────────────────────────── │  NO Vercel func) │
│  altavoz)   │   WebRTC audio (TTS chunks, Opus)      └────────┬─────────┘
└─────────────┘                                                 │
                                                     STT streaming (WS)
                                                     TTS streaming (WS/HTTP)
                                                                 │
                                                     ┌───────────▼──────────┐
                                                     │  Orquestador de voz  │
                                                     │  (frase por frase:   │
                                                     │  STT parcial → LLM   │
                                                     │  incremental → TTS)  │
                                                     └───────────┬──────────┘
                                                                 │
                                                     Reutiliza api/_lib/
                                                     handler.js + providers.js
                                                     (Gemini/Claude, ya con
                                                     streaming y tools)
```

Piezas nuevas, en orden de dependencia:

1. **VAD (Voice Activity Detection) en el cliente.** Antes que nada, en vez
   de reconocimiento de voz por turnos, se necesita detección continua de
   "el usuario está hablando / dejó de hablar" corriendo localmente en el
   navegador (sin red), típicamente con un modelo pequeño (`@ricky0123/vad-web`,
   basado en Silero VAD compilado a WASM) sobre el stream de
   `getUserMedia()`. Esto reemplaza la heurística de silencio del propio
   `SpeechRecognition` por algo que nosotros controlamos y podemos afinar
   (ventanas de ~30ms, umbral de energía + probabilidad del modelo), y es lo
   que habilita el barge-in: mientras Eddie habla, el VAD sigue corriendo, y
   si detecta voz del usuario por encima del umbral, se corta la
   reproducción de TTS inmediatamente (sin esperar una respuesta del
   servidor).

2. **Transporte de audio: WebRTC, no WebSocket crudo.** Se necesita un
   `RTCPeerConnection` desde el navegador hacia un servicio nuestro. WebRTC
   (no WebSocket) porque: (a) trae Opus con cancelación de eco y control de
   jitter ya resueltos, cosas que seríamos nosotros quienes tendríamos que
   implementar a mano sobre WebSocket; (b) UDP de baja latencia en vez de
   TCP con head-of-line blocking; (c) es el transporte que los proveedores
   de STT/TTS en streaming (ver más abajo) ya esperan o exponen igual de
   bien vía WebSocket, así que no se pierde nada usándolo también hacia
   nuestro propio backend.

3. **Un servicio nuevo, fuera de Vercel Functions.** Las funciones de
   Vercel son request/response de vida corta (hasta el `maxDuration` de
   `vercel.json`, hoy 60s) y no aceptan conexiones WebRTC/WebSocket
   persistentes de larga duración pensadas para una sesión de voz de
   minutos. Hace falta un proceso server aparte (`server/voice-gateway.js`
   o similar, ej. sobre `node-webrtc`/`mediasoup` o directamente delegando
   la señalización SFU/STT/TTS a un proveedor gestionado — ver más abajo) en
   un host que sí sostenga conexiones persistentes (Fly.io, Render, un
   droplet con PM2, etc.) — sale del alcance de "todo vive en Vercel" que
   tiene el resto de Eddie hoy, y es la decisión de mayor impacto en costo
   e infraestructura de todo este diseño.

4. **STT en streaming (no Web Speech API).** Se necesita un proveedor que
   devuelva transcripción incremental sobre el audio mientras llega, con
   latencia de decenas de ms por chunk: candidatos serios son Deepgram
   (streaming API, WebSocket, muy usado para esto), OpenAI Realtime API
   (STT+LLM+TTS integrados, pero acopla a un solo proveedor) o Google
   Cloud Speech-to-Text streaming. Deepgram es el que más se usa
   específicamente para baja latencia con VAD propio incluido en la misma
   API (`endpointing`), lo que simplifica el punto 1 si se delega el VAD de
   servidor a ellos y se deja el VAD de cliente solo para barge-in
   instantáneo sin ida y vuelta a la red.

5. **LLM incremental por frase, no por respuesta completa.** Para no
   esperar la respuesta entera antes de hablar, el orquestador debe cortar
   el stream de texto que ya llega de `callGemini`/`callClaude` (ver
   `api/_lib/providers.js`, ya soporta `onChunk`) en unidades hablables —
   frases completas por puntuación (`.`, `?`, `!`, o una pausa larga) — y
   mandar cada frase al TTS en cuanto está completa, en vez de esperar el
   `done` final. Esto es la pieza que más reduce la latencia percibida:
   Eddie puede empezar a hablar la primera frase mientras el LLM sigue
   generando la segunda.

6. **TTS en streaming.** Igual que STT, se necesita un proveedor que
   devuelva audio en chunks a medida que recibe texto, no un archivo
   completo al final: ElevenLabs (streaming WebSocket, buena calidad en
   español, es el más usado para esto), o TTS neuronal de Google/Azure con
   modo streaming. La Web Speech API (`speechSynthesis`) se descarta para
   esta ruta por completo — no tiene modo streaming ni control de
   interrupción a nivel de chunk de audio.

7. **Barge-in de extremo a extremo.** Cuando el VAD local detecta que el
   usuario empezó a hablar mientras Eddie está reproduciendo audio: (a) el
   cliente detiene inmediatamente la reproducción local (latencia ~0, no
   depende de la red); (b) manda una señal al orquestador para que corte el
   TTS en curso y descarte cualquier frase en cola todavía no reproducida;
   (c) el turno de STT nuevo empieza a acumularse normalmente. El punto (a)
   es el que de verdad hace que se sienta "en tiempo real" — no se puede
   depender de un viaje de ida y vuelta al servidor para que la interrupción
   se sienta instantánea.

### Reutilización de lo que ya existe

- `api/_lib/handler.js` (validación de la petición) y `api/_lib/providers.js`
  (streaming de Gemini/Claude, tools, `createStreamAbort`) se reutilizan
  tal cual desde el orquestador de voz — la única diferencia es que
  `onChunk` ahora alimenta un segmentador de frases + TTS en vez de NDJSON
  hacia el navegador.
- `api/_lib/tools.js` (con el hardening de este mismo PR: validación de
  esquema, aislamiento de fallos) se reutiliza igual — las herramientas de
  clima/hora funcionan igual de bien en una conversación por voz.
- El `ChatContext` actual sigue existiendo para el modo texto; el modo voz
  sería un modo nuevo y paralelo, no un reemplazo — un usuario que prefiera
  escribir no debería pagar el costo de latencia/infraestructura de este
  pipeline.

### Alcance explícitamente fuera de este diseño

- Video: el prompt original menciona "audio/video streaming", pero Eddie no
  tiene ningún caso de uso de video (no es un avatar ni comparte pantalla) —
  agregarlo sería complejidad sin funcionalidad real detrás, así que no se
  incluye.
- RAG/memoria vectorial: fuera de alcance por decisión explícita tuya en la
  pregunta anterior.

## Costo e infraestructura — la decisión que hay que tomar antes de construir

Esto deja de ser "gratis" en el sentido en que Eddie lo es hoy (Vercel
Hobby + Neon free tier + Gemini free tier):

- **Un servicio con estado, siempre corriendo**, para sostener conexiones
  WebRTC — no encaja en Vercel Functions (sin estado, de vida corta). Costo
  aproximado: el nivel más barato de Fly.io/Render con un contenedor
  siempre activo.
- **STT y TTS en streaming son de pago por minuto** en todos los proveedores
  serios (Deepgram, ElevenLabs, Google/Azure) — a diferencia de Web Speech
  API, que es gratis porque corre en el navegador del usuario.
- Alternativa de menor costo/complejidad: usar la **Realtime API de OpenAI**
  (o el equivalente de Gemini, "Live API") que integra STT+LLM+TTS en una
  sola conexión WebSocket gestionada por el proveedor — quita la necesidad
  de orquestar tres servicios distintos y de correr nuestro propio SFU de
  WebRTC, a cambio de acoplarse a un solo proveedor para todo el pipeline
  de voz (Eddie seguiría pudiendo usar Gemini/Claude para el modo texto).

## Fases sugeridas de implementación (si se aprueba avanzar)

1. **Fase 0 — decisión de proveedor.** Elegir entre (a) integración
   gestionada tipo Gemini Live API / OpenAI Realtime (menos piezas propias,
   más rápido de lanzar, acopla el proveedor) o (b) pipeline propio con
   Deepgram + ElevenLabs + SFU propio (más control y potencialmente más
   barato a escala, mucho más trabajo de infraestructura). Esta elección
   cambia todo lo que sigue.
2. **Fase 1 — VAD + barge-in en el cliente, sin backend nuevo todavía.**
   Reemplazar `useSpeechRecognition` por un hook con VAD local
   (`@ricky0123/vad-web`) para practicar la detección de habla/silencio y
   validar la sensación de interrupción, siguiendo hablando con
   `speechSynthesis` mientras tanto (mejora incremental, no bloquea nada).
3. **Fase 2 — servicio de voz mínimo** con un solo proveedor gestionado
   (si se eligió la opción (a) de la Fase 0), probado primero solo en
   local/staging antes de exponerlo.
4. **Fase 3 — segmentación de frases + streaming de TTS real**, reutilizando
   `onChunk` de `providers.js`.
5. **Fase 4** — endurecer: reconexión ante caída de red, métricas de
   latencia real medidas (no solo estimadas), límites de duración de sesión
   de voz por usuario para controlar costo.

## Qué necesito de vuelta antes de implementar

1. ¿Proveedor gestionado (Gemini Live / OpenAI Realtime) o pipeline propio
   (Deepgram + ElevenLabs + SFU)? Cambia radicalmente el trabajo y el costo
   recurrente.
2. ¿Dónde se aloja el servicio con estado? (Vercel no sirve para esto — ver
   arriba.)
3. ¿Hay presupuesto esperado para STT/TTS de pago por minuto, o el objetivo
   es explorar el diseño sin comprometerse todavía a un costo recurrente?
