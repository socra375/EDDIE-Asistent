# Sonda Local (EDDIE Prime) — conexión con la web

La **Sonda Local** es un servidor FastAPI (Python 3.11, Uvicorn) que corre en el Chromebook (Crostini) y puede mirar
el equipo físico con `psutil`: disco, memoria, procesador, batería, procesos. El servidor de Eddie en Vercel **nunca**
puede llegar a `127.0.0.1`; solo el navegador de ese mismo equipo, así que la web habla con la sonda directamente.

```
Chat (navegador del Chromebook) ──fetch──► http://127.0.0.1:8000/chat ──► herramientas psutil + su modelo de IA
        └── muestra el Markdown y las herramientas usadas ◄──┘
```

## Contrato

| Método | Ruta | Petición | Respuesta |
|---|---|---|---|
| `GET` | `/health` | — | `{"ok": true}` |
| `POST` | `/chat` | cabeceras `Content-Type: application/json` y `X-Eddie-Key: <clave>`; cuerpo `{"message": "EDDIE, revisa mi disco duro"}` | `{"response": "Markdown…", "tools_used": ["check_disk_space"]}` |

- Clave incorrecta: `401` o `403` (la web lo explica).
- Otros errores: cualquier estado no 2xx; si trae `{"detail": "…"}` la web lo muestra.

## Lo que la sonda debe tener (lado Python)

```python
import os
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://eddie-asistent.vercel.app", "http://localhost:5173"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Eddie-Key"],
)

# Chrome (Private/Local Network Access) pregunta antes de que una web pública llame a
# 127.0.0.1. Registrado DESPUÉS de CORSMiddleware, este middleware lo envuelve y
# añade la cabecera también a la respuesta del preflight.
@app.middleware("http")
async def private_network_access(request: Request, call_next):
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

@app.get("/health")
def health():
    return {"ok": True}

EDDIE_PROBE_KEY = os.environ.get("EDDIE_PROBE_KEY", "")

@app.post("/chat")
async def chat(body: dict, x_eddie_key: str = Header(default="")):
    if not EDDIE_PROBE_KEY or x_eddie_key != EDDIE_PROBE_KEY:
        raise HTTPException(status_code=401, detail="Clave inválida")
    ...  # herramientas psutil + modelo → {"response": ..., "tools_used": [...]}
```

Recomendaciones: la clave en una variable de entorno o en el `.env` de la sonda (nunca en el código ni en un chat),
escuchar solo en `127.0.0.1` (`uvicorn main:app --host 127.0.0.1 --port 8000`), y herramientas de solo lectura.

## Lado web (ya hecho)

- `src/services/probeCore.js`: funciones puras — `cleanProbeUrl` (solo direcciones de este equipo: `127.0.0.1`,
  `localhost`, `[::1]`), `askProbe` (POST `/chat` con `X-Eddie-Key`, 90 s de límite), `pingProbe` (GET `/health`, sin
  clave ni IA), `parseProbeReply` (valida `response` y limpia `tools_used`), `looksLikeSystemQuestion`.
- `src/services/probe.js`: la configuración (`eddie.probe`: `url`, `key`, `forced`, `autoDetect`) vive **solo en el
  navegador**; nunca se sincroniza con el servidor de Eddie. `autoDetectReady` exige dirección válida y clave guardada.
- Conectores → **Sonda local**: dirección, clave, *Probar conexión* (20 s, por si Chrome pide permiso de red local),
  *Enviar pregunta de prueba*, *Modo Sonda local en el chat* y la detección automática (encendida por defecto).
- Chat: el botón **Sonda local ON/OFF** de la barra (siempre visible) fuerza que cada mensaje, escrito o dictado
  (también desde Inicio), vaya a la sonda, sin pasar por la detección; errores claros si no responde. La respuesta se
  muestra con su Markdown (negritas, listas, títulos, código) y, como recibo, las herramientas que usó. Con el botón
  apagado, solo las preguntas sobre el equipo van a la sonda y, si no responde, contesta Eddie en la nube.
- Lo hablado con la sonda queda fuera de la memoria de conversaciones (los resúmenes que se guardan en el servidor);
  si sigues conversando con Eddie en la nube en el mismo chat, él ve esos mensajes como contexto.

## Límites

- Solo desde el navegador del mismo equipo donde corre la sonda; ni el teléfono, ni Telegram, ni WhatsApp llegan a ella.
- La sonda tiene su propio modelo de IA (sin la memoria de Eddie). Más adelante: fase 2 (la sonda se conecta a Eddie
  y recibe trabajos, para usarla desde Telegram) y fase 3 (la sonda solo expone herramientas y piensa el cerebro de Eddie).
