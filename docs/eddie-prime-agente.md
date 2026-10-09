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
que solo conocen Eddie y tu agente. El mensaje no lleva datos ("job"), no se guarda (`Cache: no`) y no se reenvía a
teléfonos (`Firebase: no`). El trabajo y su resultado solo pasan entre tu agente y Eddie, con el token. Si prefieres
tu propio servidor ntfy, ponlo en `EDDIE_NTFY_URL` (https).

## Tiempos

- El agente tiene **10 s** para recoger el trabajo. Si no lo hace: «Tu equipo no responde: puede estar apagado,
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
| `open_app {name}` | confirmación | abre una app **de la lista que tú permitas** |
| `kill_process {pid}` | confirmación | cierra un proceso **de tu usuario** (nunca el 1 ni el propio agente) |

Las apps permitidas se definen en `~/.config/eddie-agent/config.json`:

```json
"apps": { "terminal": ["x-terminal-emulator"], "archivos": ["nautilus"], "code": ["code"] }
```

Eddie las ve con `computer_check` / `computer_action`: dos herramientas genéricas cuyo argumento `tool` es el nombre
de la herramienta del agente. El servidor solo acepta herramientas que el agente declaró al vincularse o al
arrancar, con su mismo riesgo (una de confirmación nunca corre por `computer_check`), y solo con los argumentos que
declaró (`api/_lib/computer/catalog.js`).

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
512 KB), **una sola copia a la vez** (`agent.lock`), y `open_app` abre sin configurar nada la calculadora, el bloc de notas, el
explorador y Paint (más lo que añadas en `config.json`). Todavía solo se vincula **un equipo por cuenta**: vincular el PC
reemplaza al anterior.

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
- **Lista blanca.** No hay ejecución de comandos arbitrarios. Las rutas no salen de tu carpeta personal, las apps son
  solo las permitidas y los procesos solo los tuyos. Abrir y cerrar siempre piden confirmación.
- **Cada equipo solo responde sus trabajos.** Un token no puede leer ni responder los trabajos de otro equipo.

## Relación con la Sonda local (fase 1)

Las dos conviven. El botón «Sonda local» del chat sigue hablando con tu FastAPI en `127.0.0.1:8000` (con su propia
IA) cuando estás en ese mismo equipo. Desde cualquier otro lugar, Eddie usa EDDIE Prime. Cuando el agente te
funcione, la IA propia de la sonda ya no hace falta: puedes dejar solo el agente.
