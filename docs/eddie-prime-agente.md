# EDDIE Prime: tu equipo desde cualquier lugar (fases 2 y 3 de la Sonda)

La Sonda local (fase 1, `docs/sonda-local.md`) solo responde al navegador del mismo equipo. **EDDIE Prime** es un
agente pequeño (`public/eddie_agent.py`, servido en `/eddie_agent.py`) que deja a Eddie usar el equipo desde la web
en otro dispositivo, el teléfono o Telegram.

- **Fase 2: el agente se conecta hacia afuera.** El equipo nunca abre un puerto. Se vincula una vez con un código,
  espera un aviso y va a buscar sus trabajos a Eddie con su propio token.
- **Fase 3: un solo cerebro.** El agente no tiene IA. Ofrece una lista blanca de herramientas; Eddie (Gemini, Groq…)
  decide cuál usar y redacta la respuesta. Nada de comandos libres. Lo que cambia algo pasa por la tarjeta de
  confirmación, también con los botones de Telegram.

## Cómo viaja una pregunta

```
Tú (Telegram): "¿cuánto disco me queda en el Chromebook?"
  └─ Eddie (Vercel) elige computer_check {tool: "disk_usage"}
       1. guarda el trabajo en Neon (computer_jobs, estado queued)
       2. toca el timbre: POST https://ntfy.sh/<tema-secreto>  cuerpo "job" (sin datos)
  └─ eddie_agent.py (escuchando ese tema) → POST /api/connectors/computer/agent/next   (Bearer token)
       ← { job: { id, tool: "disk_usage", args: {} } }
     ejecuta la herramienta → POST /agent/result { id, ok, result }
  └─ Eddie lee el resultado (consulta cada 0,6 s) y te responde con los datos
```

**Por qué un timbre y no "¿hay algo para mí?" cada pocos segundos:** el plan gratis de Neon se apaga cuando nadie lo
usa y tiene 100 horas de cómputo al mes. Un agente que preguntara a la base todo el tiempo la mantendría encendida
las 730 horas del mes. Con el timbre, la base solo trabaja cuando hay un trabajo de verdad.

El timbre usa [ntfy](https://ntfy.sh), un servicio libre y gratuito. El tema es un nombre aleatorio de 24 caracteres
que solo conocen Eddie y tu agente. El mensaje no lleva datos ("job") y no se reenvía a teléfonos (`Firebase: no`). El trabajo y su
resultado solo pasan entre tu agente y Eddie, con el token. Si prefieres tu propio servidor ntfy, ponlo en `EDDIE_NTFY_URL` (https).

**Dos formas de recibir el aviso, a la vez** (desde el agente 1.3.0): una conexión abierta (`/json`, avisa al instante, con un
tiempo máximo de silencio de 75 s y reconexión ante cualquier fallo) y, además, una consulta corta cada 10 s de los avisos recientes
del tema (`/json?poll=1&since=<último>`). Una conexión abierta puede morir en silencio —un router, un antivirus o una VPN que la
retienen— y entonces el aviso no llega; la consulta corta sí. Para eso el servidor deja que ntfy **guarde unas horas** el mensaje
vacío «job» (ya no manda `Cache: no`). Cuesta unas 6 peticiones por minuto a ntfy por equipo, dentro de su límite gratuito.

## Tiempos

- El agente tiene **15 s** para recoger el trabajo. Si no lo hace: «Tu equipo no responde: puede estar apagado,
  dormido o sin el agente».
- Después tiene **15 s** para responder. Lo normal es 1–3 s; la primera llamada tras un rato puede tardar algo más
  porque Vercel y Neon "despiertan".
- Un trabajo que nadie recogió en 60 s ya no se entrega: si el equipo se enciende más tarde, no ejecuta órdenes
  viejas.

## Herramientas del agente (lista blanca)

| Herramienta | Riesgo | Qué hace |
|---|---|---|
| `system_summary` | lectura | CPU, RAM, disco, batería, horas encendido |
| `disk_usage {path}` | lectura | espacio total, usado, libre y particiones |
| `memory_usage` | lectura | RAM y swap |
| `cpu_usage` | lectura | uso por núcleo, carga, frecuencia, temperaturas |
| `battery_status` | lectura | porcentaje, si carga y tiempo restante (en Crostini puede no verse) |
| `top_processes {sort, limit}` | lectura | procesos que más CPU o memoria usan |
| `network_info` | lectura | interfaces, IPs locales, tráfico |
| `uptime` | lectura | desde cuándo está encendido |
| `list_directory {path}` | lectura | archivos de una carpeta **dentro de tu carpeta personal** |
| `open_app {name}` | confirmación (una vez por app) | busca y abre **cualquier app instalada** por su nombre |
| `kill_process {pid}` | confirmación | cierra un proceso **de tu usuario** (nunca el 1 ni el propio agente) |
| `scan_network` | lectura | qué dispositivos hay en tu red local: IP, MAC y el nombre que cada uno anuncia (ver «Red local») |
| `check_downloads` | lectura | si hay una descarga a medias en tu carpeta Descargas y qué llegó hace poco; la usan las rutinas automáticas (ver `docs/eddie-2-arquitectura.md` o el README) |

Eddie las ve con `computer_check` / `computer_action`: dos herramientas genéricas cuyo argumento `tool` es el nombre
de la herramienta del agente. El servidor solo acepta herramientas que el agente declaró al vincularse o al
arrancar, con su mismo riesgo (una de confirmación nunca corre por `computer_check`), y solo con los argumentos que
declaró (`api/_lib/computer/catalog.js`).

### `open_app`: cualquier app instalada, con permiso la primera vez

**El agente (desde la versión 1.5.0) busca la app por su nombre**, sin necesidad de configurar nada: en Windows, en
el registro (`App Paths`) y en los accesos directos del menú Inicio; en Mac, en `/Applications`; en Linux, en los
`.desktop` de `/usr/share/applications` y similares. Si no la encuentra así, prueba el PATH (`shutil.which`). Si de
verdad no está, o tiene un nombre que el agente no adivina, se le puede dar uno a mano en
`~/.config/eddie-agent/config.json`:

```json
"apps": { "mi script": ["/home/yo/bin/cosa.sh"] }
```

(esa entrada manual se prueba primero, antes de la búsqueda automática).

**Permiso**: la primera vez que se pide abrir una app nueva en un equipo, Eddie muestra la tarjeta de confirmación de
siempre, con una nota de que no se volverá a pedir. Al confirmarla, el servidor la recuerda (tabla
`computer_app_grants`, por equipo y por nombre de app) y las siguientes veces la abre directo, sin tarjeta — igual
que si el usuario hubiera dicho que sí otra vez. Es **por equipo**: aprobar Spotify en el PC de la oficina no aprueba
Spotify en el de casa. Todo lo demás (`kill_process`…) sigue pidiendo confirmación siempre; esto es exclusivo de
`open_app`.

## Descargas (check_downloads) y rutinas por evento

`check_downloads` (agente 1.6.0+) no sabe qué se está descargando ni de dónde: solo mira la carpeta
**Descargas** del equipo. Un archivo con una extensión de descarga a medias (`.crdownload`, `.part`,
`.download`, `.tmp`) cuenta como "descargando"; el resto, modificado en los últimos 2 minutos, como
"recién llegado".

Una rutina automática por evento ("cuando termine la descarga, avísame", ver README → Rutinas
automáticas) la llama cada 5 minutos (el mismo cron de los recordatorios) a través de `computer_check`.
El servidor compara la respuesta con la de la vez anterior: solo el paso de "sí estaba descargando" a
"ya no" dispara la rutina — una sola lectura de "no está descargando" nunca la dispara (sería falso si
simplemente no había empezado nada), y un equipo apagado o sin este agente actualizado tampoco (una
lectura que no se pudo hacer no cuenta como cambio).

## Red local (scan_network)

Dice qué hay conectado a la **misma red** que el equipo: una lista con la IP, la MAC y el nombre que cada dispositivo anuncia
de sí mismo (impresoras, Chromecast, altavoces, televisores, el router). Solo mira; no entra en nada ni escanea puertos.

- **Cómo lo hace:** manda un paquete suelto a cada dirección de la red (para que el sistema aprenda su MAC y aparezca en su tabla
  de vecinos: `arp -a` en Windows, `ip neigh` en Linux), pregunta por mDNS y SSDP (los servicios que se anuncian solos en la red) y
  escucha 2,5 s lo que contestan. Son los mismos anuncios que ve cualquier móvil o PC en la red.
- **Límites:** solo la red **privada** a la que está conectado (10.x, 172.16–31.x, 192.168.x), y nunca más de una /24 (254 direcciones).
  No toca otras redes ni Internet.
- **Lo que no ve:** los dispositivos que el router aísla entre clientes (redes de invitados), los apagados o dormidos, y los móviles
  modernos que cambian su MAC en cada red (aparecen con su nombre si lo anuncian, sin fabricante). El **fabricante** a partir de la
  MAC todavía no se identifica.
- **En un Chromebook** Linux corre dentro de una red virtual: puede no ver tu red real. El resultado lo avisa.
- **Privacidad:** la lista (con MAC) se manda a Eddie en la respuesta, como cualquier otro dato del equipo. No se guarda aparte.

## Varios equipos

Se pueden vincular **varios equipos** a la misma cuenta (el PC con Windows, el Chromebook…). Cada uno se identifica por su nombre
(`PC-MARCOS`, `penguin`…) y dice qué sistema es (`windows`, `mac`, `linux` o `chromebook`; el agente detecta Linux dentro de ChromeOS).
Vincular **el mismo** equipo otra vez (mismo nombre) lo reemplaza y su token anterior deja de valer; otro nombre se añade.

- **A cuál va cada orden:** `computer_check` y `computer_action` aceptan `device` (nombre, parte del nombre o el sistema:
  «windows», «chromebook»). Con un solo equipo no hace falta. Con varios y sin `device`, **nunca se adivina**: Eddie recibe la lista
  y pregunta (una orden en el equipo equivocado es peor que una pregunta de más). La tarjeta de confirmación dice en qué equipo se hará.
- `computer_list` (lectura) lista los equipos con su sistema y lo que puede hacer cada uno.
- En la tarjeta de Conectores, cada equipo tiene su **Probar desde la nube** y su **Desvincular**; mientras hay un código en
  pantalla la tarjeta se actualiza sola hasta que aparece el equipo nuevo.
- Base de datos: `0022_computer_devices_many.sql` (columna `platform` y único `(user_id, name)`, aditiva) y, aplicada **después**
  de desplegar, `0023_computer_devices_drop_single.sql` (quita el único `user_id` de «un equipo por cuenta»).

## Instalación en Windows (un clic, sin terminal)

En **Conectores → Tu equipo (EDDIE Prime) → Descargar instalador para Windows** (solo el dueño). Se descarga
`Instalar-EDDIE-Prime.cmd`, con un código de vinculación de un solo uso (30 minutos) ya dentro. Con doble clic:

1. Busca Python 3.8+ (`py -3`, `python`…); si no hay, lo instala con `winget` (oficial, para tu usuario, sin administrador).
2. Crea `%LOCALAPPDATA%\Eddie` con su propio entorno virtual e instala `psutil`.
3. Descarga `eddie_agent.py` de este mismo Eddie, comprueba que es el agente y lo vincula con el código.
4. Lo deja **arrancando solo al iniciar sesión, oculto, en segundo plano**: una tarea programada del usuario (reintenta si se cae;
   sin límite de tiempo; también con batería). Si Windows no deja crear la tarea, usa la carpeta de Inicio.
5. Se registra en **Configuración → Aplicaciones → EDDIE Prime** (desinstalador en `%LOCALAPPDATA%\Eddie`) y comprueba en
   `%APPDATA%\eddie-agent\agent.log` que el agente contactó con Eddie.

Es un archivo de texto: se puede abrir con el Bloc de notas y leer. No usa permisos de administrador. Windows puede mostrar
«Windows protegió tu PC» porque el archivo no está firmado (Más información → Ejecutar de todas formas). Volver a descargar y ejecutar el
instalador actualiza el agente. El desinstalador quita la tarea, los procesos, la carpeta y la configuración; falta pulsar **Desvincular** en Eddie.

El agente en Windows: configuración en `%APPDATA%\eddie-agent`, sin ventana (lo que imprime va a `agent.log`, que se rota a
512 KB), **una sola copia a la vez** (`agent.lock`), y `open_app` busca cualquier app instalada (ver arriba); la calculadora, el
bloc de notas, el explorador y Paint tienen además un alias en español listo desde que se vincula.

**Por qué no el Chromebook:** el agente corre en Linux (Crostini), que se apaga al cerrar la terminal y las apps de Linux; con él se
apaga el agente. Ahí el camino fiable es la extensión «Tu navegador» (vive con Chrome).

## Instalación (Linux / Chromebook, terminal de Linux)

1. En Eddie → **Conectores → Tu equipo (EDDIE Prime)** → **Vincular un equipo** (con la sesión de Google del dueño).
   La tarjeta muestra tres comandos con botón **Copiar**:
   ```bash
   curl -fsSL https://eddie-asistent.vercel.app/eddie_agent.py -o eddie_agent.py
   python3 eddie_agent.py pair CÓDIGO --app https://eddie-asistent.vercel.app
   python3 eddie_agent.py run
   ```
   Necesita `psutil`: usa el mismo entorno virtual de tu sonda (`source venv/bin/activate`) o `pip install psutil`.
2. Para que arranque solo al encender Linux: `python3 eddie_agent.py install-service`. Crea
   `~/.config/systemd/user/eddie-agent.service` con el Python que uses y lo activa (`systemctl --user enable --now`).
   Para ver el registro: `journalctl --user -u eddie-agent -f`.
3. **Probar desde la nube** en la tarjeta, y luego por Telegram: "¿cuánta batería tiene mi Chromebook?".

`python3 eddie_agent.py test` prueba las herramientas sin conectarse a nada.

## Contrato (por si quieres integrarlo en tu FastAPI)

Todas las rutas son `POST` bajo `/api/connectors/computer/agent/` con JSON; todas menos `pair` llevan
`Authorization: Bearer <token>`.

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `pair` | `{ code, name, version, tools }` | `{ token, topic, ntfy, name, tools }`; el token solo se entrega aquí |
| `hello` | `{ version, tools, name? }` | `{ ok, name, topic, ntfy, tools }`; actualiza el catálogo al arrancar |
| `next` | `{}` | `{ job: { id, tool, args } }` o `{ job: null }` |
| `result` | `{ id, ok: true, result }` o `{ id, ok: false, error }` | `{ ok }`; 409 si el trabajo caducó o no es tuyo |

`tools` es una lista de `{ name, label, description, risk: "read"|"confirm", parameters: { properties: { arg: { type:
"string"|"integer"|"number"|"boolean", description?, enum? } }, required: [] } }`, con un máximo de 24 herramientas
y 6 argumentos. El resultado puede ser cualquier JSON (máximo 16 KB); si trae `summary`, ese texto es el que se ve en
el recibo del chat.

El timbre: `GET {ntfy}/{topic}/json` es una conexión que se queda abierta y envía líneas JSON. Cuando llega una con
`"event": "message"`, llama a `next` hasta recibir `null`. Al arrancar y al reconectar, llama a `next` una vez por si
algo quedó esperando.

## Seguridad

- **Sin puertos abiertos.** Solo hay conexiones de salida a Eddie y a ntfy.
- **Token por equipo.** Son 32 bytes aleatorios; en Neon solo se guarda su SHA-256. «Desvincular» lo invalida al
  momento (el agente recibe 401 y se detiene). La configuración local es `0600`.
- **Solo el dueño.** Con `EDDIE_OWNER_EMAIL` configurado, solo esa cuenta puede generar códigos (10 min, un solo uso).
- **Lista blanca.** No hay ejecución de comandos arbitrarios. Las rutas no salen de tu carpeta personal y los procesos
  solo los tuyos. Abrir una app pide confirmación la primera vez (luego se recuerda, por equipo); cerrar un proceso,
  siempre.
- **Cada equipo solo responde sus trabajos.** Un token no puede leer ni responder los trabajos de otro equipo.

## Relación con la Sonda local (fase 1)

Las dos conviven. El botón «Sonda local» del chat sigue hablando con tu FastAPI en `127.0.0.1:8000` (con su propia
IA) cuando estás en ese mismo equipo. Desde cualquier otro lugar, Eddie usa EDDIE Prime. Cuando el agente te
funcione, la IA propia de la sonda ya no hace falta: puedes dejar solo el agente.
