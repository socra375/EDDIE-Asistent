#!/usr/bin/env python3
"""EDDIE Prime: el agente de Eddie en tu equipo.

Deja que Eddie (en la nube) consulte y maneje este equipo desde la web, el
teléfono, Telegram, sin abrir ningún puerto:

  1. Se vincula una vez con el código de Conectores → «Tu equipo (EDDIE Prime)».
  2. Espera un aviso sin datos (un tema secreto de ntfy) que dice "hay trabajo".
  3. Va a buscar el trabajo a Eddie con su propio token, ejecuta UNA de sus
     herramientas de la lista blanca de abajo y devuelve el resultado.

Un solo cerebro: aquí no hay IA. Eddie decide qué herramienta usar y redacta
la respuesta. Nada de comandos libres; lo que cambia algo (abrir una app,
cerrar un proceso) Eddie lo pide siempre con tu confirmación.

Uso:
  python3 eddie_agent.py pair CÓDIGO [--app https://eddie-asistent.vercel.app] [--name "Mi Chromebook"]
  python3 eddie_agent.py run            # se queda esperando trabajos
  python3 eddie_agent.py test           # prueba las herramientas aquí mismo
  python3 eddie_agent.py install-service  # arranque automático (systemd de usuario)

Requisitos: Python 3.8+ y psutil (pip install psutil).
Configuración: ~/.config/eddie-agent/config.json (solo tu usuario puede leerla).
Ahí puedes permitir apps para open_app, por ejemplo:
  "apps": {"terminal": ["x-terminal-emulator"], "archivos": ["nautilus"], "code": ["code"]}
"""

import argparse
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = "1.0.0"
DEFAULT_APP = "https://eddie-asistent.vercel.app"
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", "eddie-agent")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
HOME = os.path.realpath(os.path.expanduser("~"))
MAX_LIST = 50
MIN_FETCH_GAP = 1.0  # segundos entre pedidos de trabajo, por si alguien abusa del aviso

try:
    import psutil  # type: ignore
except ImportError:  # se avisa al usarlo
    psutil = None


# ---------------------------------------------------------------- utilidades

def log(*parts):
    print(time.strftime("[%H:%M:%S]"), *parts, flush=True)


def gb(n):
    return round(n / (1024 ** 3), 2)


def used_percent(du):
    """Como df: lo usado sobre lo que el usuario puede usar (sin el espacio reservado)."""
    room = du.used + du.free
    return round(du.used / room * 100, 1) if room else None


def need_psutil():
    if psutil is None:
        raise RuntimeError("Falta psutil: instálalo con  pip install psutil  (en el mismo entorno de Python).")


def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_config(cfg):
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG_PATH)
    os.chmod(CONFIG_PATH, 0o600)


def inside_home(path):
    """Ruta relativa a la carpeta personal (o absoluta dentro de ella); None si sale de ahí."""
    raw = (path or "").strip() or "."
    full = os.path.realpath(os.path.join(HOME, os.path.expanduser(raw)))
    if full == HOME or full.startswith(HOME + os.sep):
        return full
    return None


def short_path(full):
    return "~" if full == HOME else "~/" + os.path.relpath(full, HOME)


# -------------------------------------------------------------- herramientas
# Cada una: (función, nombre visible, descripción, riesgo, parámetros).
# riesgo "read" = solo mira; "confirm" = cambia algo (Eddie pide confirmación).

def t_system_summary(_args, _cfg):
    need_psutil()
    du = shutil.disk_usage(HOME)
    vm = psutil.virtual_memory()
    out = {
        "equipo": socket.gethostname(),
        "sistema": f"{platform.system()} {platform.release()}",
        "cpu_percent": psutil.cpu_percent(interval=0.5),
        "nucleos": psutil.cpu_count(),
        "memoria": {"total_gb": gb(vm.total), "disponible_gb": gb(vm.available), "uso_percent": vm.percent},
        "disco_personal": {"total_gb": gb(du.total), "libre_gb": gb(du.free), "uso_percent": used_percent(du)},
        "encendido_horas": round((time.time() - psutil.boot_time()) / 3600, 1),
    }
    bat = _battery()
    if bat:
        out["bateria"] = bat
    out["summary"] = f"CPU {out['cpu_percent']} %, RAM {vm.percent} %, disco {out['disco_personal']['libre_gb']} GB libres"
    return out


def t_disk_usage(args, _cfg):
    need_psutil()
    target = inside_home(args.get("path")) if args.get("path") else HOME
    if not target:
        raise ValueError("Solo puedo mirar dentro de tu carpeta personal.")
    du = shutil.disk_usage(target)
    parts = []
    for p in psutil.disk_partitions(all=False):
        try:
            u = psutil.disk_usage(p.mountpoint)
        except (PermissionError, OSError):
            continue
        parts.append({"montaje": p.mountpoint, "tipo": p.fstype, "total_gb": gb(u.total), "libre_gb": gb(u.free), "uso_percent": u.percent})
    return {
        "ruta": short_path(target),
        "total_gb": gb(du.total),
        "usado_gb": gb(du.used),
        "libre_gb": gb(du.free),
        "uso_percent": used_percent(du),
        "particiones": parts[:10],
        "summary": f"{gb(du.free)} GB libres de {gb(du.total)} GB",
    }


def t_memory_usage(_args, _cfg):
    need_psutil()
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    return {
        "total_gb": gb(vm.total), "disponible_gb": gb(vm.available), "usada_gb": gb(vm.used), "uso_percent": vm.percent,
        "swap_total_gb": gb(sw.total), "swap_uso_percent": sw.percent,
        "summary": f"RAM al {vm.percent} % ({gb(vm.available)} GB disponibles)",
    }


def t_cpu_usage(_args, _cfg):
    need_psutil()
    per = psutil.cpu_percent(interval=0.8, percpu=True)
    total = round(sum(per) / len(per), 1) if per else 0
    out = {"uso_percent": total, "por_nucleo": per, "nucleos": psutil.cpu_count()}
    try:
        out["carga_1_5_15"] = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        pass
    freq = psutil.cpu_freq()
    if freq:
        out["frecuencia_mhz"] = round(freq.current)
    temps = _temperatures()
    if temps:
        out["temperaturas_c"] = temps
    out["summary"] = f"CPU al {total} %"
    return out


def _battery():
    if psutil is None or not hasattr(psutil, "sensors_battery"):
        return None
    try:
        b = psutil.sensors_battery()
    except Exception:
        return None
    if b is None:
        return None
    mins = None if b.secsleft in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) else round(b.secsleft / 60)
    return {"percent": round(b.percent), "cargando": bool(b.power_plugged), "minutos_restantes": mins}


def _temperatures():
    if psutil is None or not hasattr(psutil, "sensors_temperatures"):
        return None
    try:
        data = psutil.sensors_temperatures()
    except Exception:
        return None
    out = {}
    for name, entries in (data or {}).items():
        for e in entries[:2]:
            out[f"{name}{'/' + e.label if e.label else ''}"] = e.current
    return dict(list(out.items())[:8]) or None


def t_battery_status(_args, _cfg):
    bat = _battery()
    if not bat:
        return {"disponible": False, "nota": "Este entorno no ve la batería (en Crostini, Linux no siempre tiene acceso a ella).", "summary": "Batería no disponible aquí"}
    bat["summary"] = f"Batería {bat['percent']} %{' (cargando)' if bat['cargando'] else ''}"
    return bat


def t_top_processes(args, _cfg):
    need_psutil()
    sort = "memory" if args.get("sort") == "memory" else "cpu"
    limit = max(1, min(int(args.get("limit") or 8), 20))
    procs = []
    for p in psutil.process_iter(["pid", "name", "username", "memory_percent"]):
        try:
            p.cpu_percent(None)
            procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    time.sleep(0.6)
    rows = []
    for p in procs:
        try:
            rows.append({
                "pid": p.pid, "nombre": p.info["name"], "usuario": p.info["username"],
                "cpu_percent": round(p.cpu_percent(None), 1), "memoria_percent": round(p.info["memory_percent"] or 0, 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    key = "memoria_percent" if sort == "memory" else "cpu_percent"
    rows.sort(key=lambda r: r[key], reverse=True)
    top = rows[:limit]
    return {"orden": sort, "procesos": top, "summary": ", ".join(f"{r['nombre']} {r[key]} %" for r in top[:3])}


def t_network_info(_args, _cfg):
    need_psutil()
    ifaces = []
    for name, addrs in psutil.net_if_addrs().items():
        ips = [a.address for a in addrs if a.family in (socket.AF_INET, socket.AF_INET6) and not a.address.startswith("fe80")]
        if ips and name != "lo":
            ifaces.append({"interfaz": name, "ips": ips[:4]})
    io = psutil.net_io_counters()
    return {
        "equipo": socket.gethostname(), "interfaces": ifaces[:8],
        "enviado_mb": round(io.bytes_sent / 1e6, 1), "recibido_mb": round(io.bytes_recv / 1e6, 1),
        "summary": ", ".join(f"{i['interfaz']} {i['ips'][0]}" for i in ifaces[:2]) or "Sin red",
    }


def t_uptime(_args, _cfg):
    need_psutil()
    hours = (time.time() - psutil.boot_time()) / 3600
    return {"horas": round(hours, 1), "desde": time.strftime("%Y-%m-%d %H:%M", time.localtime(psutil.boot_time())), "summary": f"Encendido hace {round(hours, 1)} h"}


def t_list_directory(args, _cfg):
    target = inside_home(args.get("path"))
    if not target:
        raise ValueError("Solo puedo listar carpetas dentro de tu carpeta personal.")
    if not os.path.isdir(target):
        raise ValueError(f"No existe la carpeta {short_path(target)}.")
    entries = []
    with os.scandir(target) as it:
        for e in it:
            if e.name.startswith("."):
                continue
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            entries.append({
                "nombre": e.name, "tipo": "carpeta" if e.is_dir(follow_symlinks=False) else "archivo",
                "tamano_kb": round(st.st_size / 1024, 1), "modificado": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)),
            })
    entries.sort(key=lambda x: x["modificado"], reverse=True)
    return {"carpeta": short_path(target), "total": len(entries), "elementos": entries[:MAX_LIST], "summary": f"{len(entries)} elementos en {short_path(target)}"}


def t_open_app(args, cfg):
    apps = cfg.get("apps") or {}
    name = str(args.get("name") or "").strip().lower()
    if not apps:
        raise ValueError("No hay apps permitidas. Agrégalas en ~/.config/eddie-agent/config.json, en \"apps\".")
    match = next((k for k in apps if k.lower() == name), None)
    if not match:
        raise ValueError(f"«{name}» no está en la lista de apps permitidas: {', '.join(sorted(apps))}.")
    argv = apps[match]
    if isinstance(argv, str):
        argv = [argv]
    if not argv or not shutil.which(argv[0]):
        raise ValueError(f"No encuentro el programa de «{match}» ({argv[0] if argv else '?'}).")
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"abierta": match, "summary": f"Abrí {match}"}


def t_kill_process(args, _cfg):
    need_psutil()
    pid = int(args.get("pid") or 0)
    if pid <= 1 or pid == os.getpid():
        raise ValueError("Ese proceso no se puede cerrar.")
    try:
        p = psutil.Process(pid)
        if p.uids().real != os.getuid():
            raise ValueError("Solo cierro procesos de tu usuario.")
        name = p.name()
        p.terminate()
        try:
            p.wait(timeout=4)
            how = "cerrado"
        except psutil.TimeoutExpired:
            p.kill()
            how = "forzado"
    except psutil.NoSuchProcess:
        raise ValueError(f"No existe el proceso {pid}.")
    except psutil.AccessDenied:
        raise ValueError("No tengo permiso para cerrar ese proceso.")
    return {"pid": pid, "nombre": name, "resultado": how, "summary": f"Cerré {name} ({pid})"}


S = lambda d: {"type": "string", "description": d}  # noqa: E731
I = lambda d: {"type": "integer", "description": d}  # noqa: E731

TOOLS = {
    "system_summary": (t_system_summary, "Resumen del equipo", "CPU, memoria, disco, batería y tiempo encendido.", "read", {}),
    "disk_usage": (t_disk_usage, "Uso del disco", "Espacio total, usado y libre (y particiones).", "read", {"path": S("Carpeta dentro de tu carpeta personal (opcional).")}),
    "memory_usage": (t_memory_usage, "Uso de memoria", "RAM y swap.", "read", {}),
    "cpu_usage": (t_cpu_usage, "Uso del procesador", "Uso por núcleo, carga, frecuencia y temperaturas si hay.", "read", {}),
    "battery_status": (t_battery_status, "Batería", "Porcentaje, si carga y tiempo restante.", "read", {}),
    "top_processes": (t_top_processes, "Procesos que más consumen", "Los procesos con más CPU o memoria.", "read", {"sort": {"type": "string", "enum": ["cpu", "memory"], "description": "cpu o memory"}, "limit": I("Cuántos (máx. 20).")}),
    "network_info": (t_network_info, "Red", "Interfaces, IPs locales y tráfico.", "read", {}),
    "uptime": (t_uptime, "Tiempo encendido", "Desde cuándo está encendido.", "read", {}),
    "list_directory": (t_list_directory, "Ver una carpeta", "Archivos y carpetas (dentro de tu carpeta personal).", "read", {"path": S("Ruta, ej. Descargas.")}),
    "open_app": (t_open_app, "Abrir una app", "Abre una app de la lista permitida en la configuración.", "confirm", {"name": S("Nombre de la app en la lista.")}),
    "kill_process": (t_kill_process, "Cerrar un proceso", "Cierra un proceso de tu usuario por su pid.", "confirm", {"pid": I("Id del proceso.")}),
}

REQUIRED = {"list_directory": ["path"], "open_app": ["name"], "kill_process": ["pid"]}


def catalog(cfg):
    out = []
    for name, (_fn, label, desc, risk, params) in TOOLS.items():
        if name == "open_app" and cfg.get("apps"):
            desc = f"{desc} Permitidas: {', '.join(sorted(cfg['apps']))}."
        out.append({"name": name, "label": label, "description": desc, "risk": risk,
                    "parameters": {"properties": params, "required": REQUIRED.get(name, [])}})
    return out


def run_tool(name, args, cfg):
    if name not in TOOLS:
        raise ValueError(f"Herramienta desconocida: {name}")
    fn = TOOLS[name][0]
    return fn(args if isinstance(args, dict) else {}, cfg)


# ----------------------------------------------------------------- red

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def api(cfg, path, body=None, token=True, timeout=30):
    url = cfg["app"].rstrip("/") + "/api/connectors/computer/" + path
    data = json.dumps(body or {}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": f"eddie-agent/{VERSION}"}
    if token:
        headers["Authorization"] = "Bearer " + cfg["token"]
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error")
        except Exception:
            msg = None
        raise ApiError(e.code, msg or f"Error {e.code}")


def drain(cfg):
    """Pide y ejecuta trabajos hasta que no quede ninguno."""
    while True:
        job = api(cfg, "agent/next").get("job")
        if not job:
            return
        name, args = job.get("tool"), job.get("args") or {}
        log("Trabajo:", name, json.dumps(args, ensure_ascii=False))
        try:
            result = run_tool(name, args, cfg)
            payload = {"id": job["id"], "ok": True, "result": result}
        except Exception as e:  # el error vuelve a Eddie, no tumba el agente
            payload = {"id": job["id"], "ok": False, "error": str(e)[:400]}
            log("  falló:", e)
        try:
            api(cfg, "agent/result", payload)
        except ApiError as e:
            log("  no pude entregar el resultado:", e)


def listen(cfg, on_ring):
    """Escucha el tema secreto de ntfy (una conexión que se queda abierta)."""
    url = f"{cfg['ntfy'].rstrip('/')}/{cfg['topic']}/json"
    req = urllib.request.Request(url, headers={"User-Agent": f"eddie-agent/{VERSION}"})
    with urllib.request.urlopen(req, timeout=120) as res:  # ntfy manda "keepalive" cada ~45 s
        log("Esperando trabajos (aviso:", cfg["ntfy"] + ")")
        for raw in res:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line).get("event")
            except ValueError:
                continue
            if event == "message":
                on_ring()


def cmd_run(cfg):
    if not cfg.get("token"):
        sys.exit("Este equipo no está vinculado. Usa: python3 eddie_agent.py pair CÓDIGO")
    stop = {"now": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(now=True) or sys.exit(0))
    last = {"t": 0.0}

    def ring():
        if time.time() - last["t"] < MIN_FETCH_GAP:
            time.sleep(MIN_FETCH_GAP)
        last["t"] = time.time()
        try:
            drain(cfg)
        except ApiError as e:
            if e.status == 401:
                sys.exit("Eddie rechazó el token: el equipo se desvinculó. Vuelve a vincularlo desde Conectores.")
            log("Error al pedir trabajo:", e)
        except (urllib.error.URLError, OSError) as e:
            log("Sin conexión con Eddie:", e)

    # Al arrancar: se presenta (catálogo actualizado) y recoge lo pendiente.
    wait = 5
    while True:
        try:
            hello = api(cfg, "agent/hello", {"version": VERSION, "tools": catalog(cfg)})
            break
        except ApiError as e:
            if e.status == 401:
                sys.exit("Eddie rechazó el token: el equipo se desvinculó. Vuelve a vincularlo desde Conectores.")
            log("Eddie respondió con un error:", e, f"— reintento en {wait} s")
        except (urllib.error.URLError, OSError) as e:
            log("Sin conexión con Eddie:", e, f"— reintento en {wait} s")
        time.sleep(wait)
        wait = min(wait * 2, 120)
    cfg["topic"], cfg["ntfy"] = hello.get("topic", cfg["topic"]), hello.get("ntfy", cfg["ntfy"])
    log(f"EDDIE Prime {VERSION} listo como «{hello.get('name')}» con {hello.get('tools')} herramientas.")
    ring()
    backoff = 2
    while not stop["now"]:
        try:
            listen(cfg, ring)
            backoff = 2
        except (urllib.error.URLError, OSError, socket.timeout) as e:
            log(f"Aviso desconectado ({e}); reintento en {backoff} s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
        ring()  # por si llegó algo mientras no escuchaba


def cmd_pair(args):
    cfg = load_config()
    cfg["app"] = (args.app or cfg.get("app") or DEFAULT_APP).rstrip("/")
    name = args.name or socket.gethostname()
    try:
        data = api(cfg, "agent/pair", {"code": args.code.strip().upper(), "name": name, "version": VERSION, "tools": catalog(cfg)}, token=False)
    except ApiError as e:
        sys.exit(f"No se pudo vincular: {e}")
    cfg.update({"token": data["token"], "topic": data["topic"], "ntfy": data["ntfy"], "name": data["name"]})
    cfg.setdefault("apps", {})
    save_config(cfg)
    print(f"Vinculado como «{data['name']}» con {data['tools']} herramientas. Configuración: {CONFIG_PATH}")
    print("Ahora arráncalo:  python3 eddie_agent.py run   (o install-service para que arranque solo)")


def cmd_test(cfg):
    for name in ["system_summary", "disk_usage", "memory_usage", "battery_status", "uptime"]:
        try:
            print(name, "→", json.dumps(run_tool(name, {}, cfg), ensure_ascii=False)[:300])
        except Exception as e:
            print(name, "→ error:", e)


def cmd_install_service(_cfg):
    unit_dir = os.path.join(os.path.expanduser("~"), ".config", "systemd", "user")
    os.makedirs(unit_dir, exist_ok=True)
    script = os.path.realpath(__file__)
    unit = (
        "[Unit]\nDescription=EDDIE Prime (agente de Eddie)\nAfter=network-online.target\n\n"
        f"[Service]\nExecStart={sys.executable} {script} run\nRestart=always\nRestartSec=10\n\n"
        "[Install]\nWantedBy=default.target\n"
    )
    path = os.path.join(unit_dir, "eddie-agent.service")
    with open(path, "w", encoding="utf-8") as f:
        f.write(unit)
    print("Servicio escrito en", path)
    for cmd in (["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", "eddie-agent"]):
        r = subprocess.run(cmd, capture_output=True, text=True)
        print("$", " ".join(cmd), "→", "ok" if r.returncode == 0 else (r.stderr.strip() or r.returncode))
    print("Ver el registro:  journalctl --user -u eddie-agent -f")


def main():
    parser = argparse.ArgumentParser(description="EDDIE Prime: el agente de Eddie en tu equipo.")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("pair", help="vincular con el código de Conectores")
    p.add_argument("code")
    p.add_argument("--app", help=f"dirección de Eddie (por defecto {DEFAULT_APP})")
    p.add_argument("--name", help="nombre del equipo")
    sub.add_parser("run", help="esperar y ejecutar trabajos")
    sub.add_parser("test", help="probar las herramientas aquí")
    sub.add_parser("install-service", help="arrancar solo con systemd de usuario")
    args = parser.parse_args()
    if args.cmd == "pair":
        return cmd_pair(args)
    cfg = load_config()
    if args.cmd == "test":
        return cmd_test(cfg)
    if args.cmd == "install-service":
        return cmd_install_service(cfg)
    if args.cmd in (None, "run"):
        try:
            return cmd_run(cfg)
        except KeyboardInterrupt:
            print()
    return None


if __name__ == "__main__":
    main()
