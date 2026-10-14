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
  python3 eddie_agent.py run            # se queda esperando trabajos (si no lo deja hecho "pair")
  python3 eddie_agent.py test           # prueba las herramientas aquí mismo
  python3 eddie_agent.py install-service  # vuelve a dejarlo arrancando solo (systemd de usuario en Linux, LaunchAgent en Mac)

"pair" ya deja el equipo arrancando solo desde que se encuentra encendido (al iniciar
sesión): en Linux y Mac lo hace él mismo justo después de vincularse, sin ningún paso
aparte; en Windows no hace falta nada de esto a mano, el instalador de un clic que
descargas en Conectores → «Tu equipo (EDDIE Prime)» lo instala, lo vincula y lo deja
arrancando solo (en segundo plano, sin ventana) cada vez que inicias sesión.

Requisitos: Python 3.8+ y psutil (pip install psutil).
Configuración: ~/.config/eddie-agent/config.json en Linux y %APPDATA%\\eddie-agent\\config.json
en Windows (solo tu usuario puede leerla). open_app busca cualquier app instalada por su nombre
(registro de Windows y menú Inicio; /Applications en Mac; .desktop en Linux); "apps" ahí solo
hace falta para darle un nombre propio a algo que no encuentra solo, por ejemplo:
  "apps": {"mi script": ["/home/yo/bin/cosa.sh"]}
"""

import argparse
import glob
import ipaddress
import json
import os
import platform
import re
import select
import shlex
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

VERSION = "1.9.0"
DEFAULT_APP = "https://eddie-asistent.vercel.app"
IS_WINDOWS = os.name == "nt"


def detect_platform():
    """Qué sistema es este equipo, para que Eddie distinga tus equipos: windows, mac, chromebook o linux."""
    if IS_WINDOWS:
        return "windows"
    if sys.platform == "darwin":
        return "mac"
    # Linux dentro de ChromeOS (Crostini): el equipo en realidad es un Chromebook.
    if os.path.exists("/dev/.cros_milestone") or socket.gethostname() == "penguin":
        return "chromebook"
    return "linux"


def config_dir():
    """Dónde vive la configuración: %APPDATA% en Windows, ~/.config en Linux y Mac."""
    if IS_WINDOWS:
        base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")
        return os.path.join(base, "eddie-agent")
    return os.path.join(os.path.expanduser("~"), ".config", "eddie-agent")


CONFIG_DIR = config_dir()
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
LOG_PATH = os.path.join(CONFIG_DIR, "agent.log")
LOCK_PATH = os.path.join(CONFIG_DIR, "agent.lock")
ALIVE_PATH = os.path.join(CONFIG_DIR, "alive.json")
ALIVE_EVERY = 20  # segundos entre una marca de «sigo vivo» y la siguiente
NEW_START_GAP = 90  # tanto sin marcas = el equipo estuvo apagado (un reinicio del agente dura menos)
FRESH_BOOT_SECS = 900  # sin marcas previas, solo cuenta si el equipo arrancó hace menos de esto
MAX_LOG_BYTES = 512 * 1024
HOME = os.path.realpath(os.path.expanduser("~"))
# Apps que se pueden abrir en Windows sin configurar nada (son de Windows, siempre están).
WINDOWS_APPS = {
    "calculadora": ["calc.exe"],
    "bloc de notas": ["notepad.exe"],
    "explorador": ["explorer.exe"],
    "paint": ["mspaint.exe"],
}
MAX_LIST = 50
MIN_FETCH_GAP = 1.0  # segundos entre pedidos de trabajo, por si alguien abusa del aviso
STREAM_TIMEOUT = 75  # ntfy manda un latido cada ~45 s: más silencio que esto es una conexión muerta
POLL_SECS = 10  # además de la conexión abierta, se mira cada tanto lo reciente del tema (ver Aviso)

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
    if hasattr(os, "getloadavg"):  # no existe en Windows
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


def _app_paths_value_to_exe(raw):
    """App Paths' default value is always just the executable's path, quoted
    or not, never arguments after it — so an unquoted one with spaces (e.g.
    msedge.exe: C:\\Program Files (x86)\\...) must be kept whole, not cut at
    its first space. A quoted one keeps only what is inside the quotes
    (some entries add a trailing `"%1"` placeholder after the path)."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    return raw[1 : raw.find('"', 1)] if raw.startswith('"') else raw


def _find_windows_app(name):
    """Registro (App Paths) y accesos directos del menú Inicio, luego el PATH."""
    needle = name.lower()
    try:
        import winreg
    except ImportError:
        winreg = None
    if winreg:
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                key = winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\App Paths")
            except OSError:
                continue
            with key:
                i = 0
                while True:
                    try:
                        sub = winreg.EnumKey(key, i)
                    except OSError:
                        break
                    i += 1
                    stem = sub[:-4] if sub.lower().endswith(".exe") else sub
                    if needle not in stem.lower():
                        continue
                    try:
                        with winreg.OpenKey(key, sub) as sk:
                            raw = winreg.QueryValue(sk, None)
                    except OSError:
                        continue
                    exe = _app_paths_value_to_exe(raw)
                    if exe:
                        return [exe]
    # Accesos directos del menú Inicio (.lnk): Windows abre uno tal cual con
    # os.startfile, sin que haga falta resolver a qué programa apunta.
    for base in (
        os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "Microsoft", "Windows", "Start Menu", "Programs"),
        os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
    ):
        if not base or not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.lower().endswith(".lnk") and needle in f[:-4].lower():
                    return [os.path.join(root, f)]
    which = shutil.which(name) or shutil.which(f"{name}.exe")
    return [which] if which else None


def _find_mac_app(name):
    """/Applications (y las otras carpetas de apps habituales), luego el PATH."""
    needle = name.lower()
    fallback = None
    for base in ("/Applications", "/System/Applications", os.path.join(os.path.expanduser("~"), "Applications")):
        if not os.path.isdir(base):
            continue
        try:
            entries = os.listdir(base)
        except OSError:
            continue
        for e in entries:
            if not e.lower().endswith(".app"):
                continue
            stem = e[:-4].lower()
            path = os.path.join(base, e)
            if stem == needle:
                return ["open", path]
            if fallback is None and needle in stem:
                fallback = path
    if fallback:
        return ["open", fallback]
    which = shutil.which(name)
    return [which] if which else None


def _find_linux_app(name):
    """Un .desktop cuyo Name coincida (usando su Exec), luego el PATH."""
    needle = name.lower()
    fallback = None
    for base in ("/usr/share/applications", "/usr/local/share/applications", os.path.join(os.path.expanduser("~"), ".local", "share", "applications")):
        if not os.path.isdir(base):
            continue
        try:
            entries = os.listdir(base)
        except OSError:
            continue
        for fname in entries:
            if not fname.endswith(".desktop"):
                continue
            try:
                with open(os.path.join(base, fname), "r", encoding="utf-8", errors="ignore") as fh:
                    text = fh.read()
            except OSError:
                continue
            label = re.search(r"^Name=(.*)$", text, re.MULTILINE)
            run = re.search(r"^Exec=(.*)$", text, re.MULTILINE)
            if not label or not run:
                continue
            title = label.group(1).strip()
            if needle not in title.lower():
                continue
            cleaned = re.sub(r"%[a-zA-Z]", "", run.group(1)).strip()
            try:
                argv = shlex.split(cleaned)
            except ValueError:
                continue
            if not argv:
                continue
            if title.lower() == needle:
                return argv
            if fallback is None:
                fallback = argv
    if fallback:
        return fallback
    which = shutil.which(name)
    return [which] if which else None


def _find_app(name):
    if IS_WINDOWS:
        return _find_windows_app(name)
    if detect_platform() == "mac":
        return _find_mac_app(name)
    return _find_linux_app(name)  # linux y chromebook


def t_open_app(args, cfg):
    apps = cfg.get("apps") or {}
    name = str(args.get("name") or "").strip()
    if not name:
        raise ValueError("Dime el nombre de la app a abrir.")
    match = next((k for k in apps if k.lower() == name.lower()), None)
    argv = apps[match] if match else _find_app(name)
    if isinstance(argv, str):
        argv = [argv]
    if not argv:
        hint = f" Lo que ya tienes a mano: {', '.join(sorted(apps))}." if apps else ""
        raise ValueError(f"No encuentro «{name}» instalada en este equipo.{hint} Si se llama distinto, agrégala en \"apps\" de config.json.")
    exe = argv[0]
    if exe != "open" and not os.path.exists(exe) and not shutil.which(exe):
        raise ValueError(f"No encuentro el programa de «{match or name}» ({exe}).")
    label = match or name
    if IS_WINDOWS and exe.lower().endswith(".lnk"):
        os.startfile(exe)  # type: ignore[attr-defined]  # un acceso directo: Windows resuelve a qué apunta
    else:
        kwargs = {"creationflags": getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)} if IS_WINDOWS else {"start_new_session": True}
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
    return {"abierta": label, "summary": f"Abrí {label}"}


MAX_OPEN_URLS = 8


def _clean_urls(raw):
    """Las direcciones https públicas de un texto (separadas por espacios, comas o saltos de línea)."""
    urls = []
    for part in re.split(r"[\s,;]+", str(raw or "")):
        part = part.strip()
        if not part:
            continue
        if len(part) > 2000:
            raise ValueError("Una dirección es demasiado larga.")
        u = urllib.parse.urlparse(part)
        host = (u.hostname or "").lower()
        if u.scheme != "https" or not host or u.username or u.password or "." not in host or host.endswith(".local") or host == "localhost":
            raise ValueError(f"Solo abro direcciones https públicas: «{part[:60]}» no sirve.")
        try:
            ipaddress.ip_address(host)
            raise ValueError(f"No abro direcciones IP: «{part[:60]}».")
        except ValueError as e:
            if "No abro" in str(e):
                raise
        if part not in urls:
            urls.append(part)
    if not urls:
        raise ValueError("Dame al menos una dirección https para abrir.")
    if len(urls) > MAX_OPEN_URLS:
        raise ValueError(f"Máximo {MAX_OPEN_URLS} páginas a la vez.")
    return urls


def t_open_urls(args, _cfg):
    """Abre páginas en el navegador predeterminado (aunque no esté abierto), una pestaña por dirección."""
    urls = _clean_urls(args.get("urls"))
    for i, url in enumerate(urls):
        if i == 0:
            webbrowser.open(url, new=2)
        else:
            time.sleep(0.8)  # que el navegador alcance a abrirse antes de la siguiente pestaña
            webbrowser.open_new_tab(url)
    return {"abiertas": urls, "summary": f"Abrí {len(urls)} página{'s' if len(urls) != 1 else ''} en el navegador"}


def t_say_text(args, _cfg):
    """Dice un texto en voz alta con la voz del propio sistema (sin internet; no es la voz de Eddie en la nube)."""
    text = re.sub(r"\s+", " ", str(args.get("text") or "")).strip()[:300]
    if not text:
        raise ValueError("Dime qué decir.")
    if IS_WINDOWS:
        ps = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak($env:EDDIE_SAY)"
        argv = ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps]
    elif detect_platform() == "mac":
        argv = ["say", text]
    else:
        tool = shutil.which("spd-say") or shutil.which("espeak")
        if not tool:
            raise ValueError("Este equipo no tiene voz instalada (spd-say o espeak).")
        argv = [tool, text]
    env = dict(os.environ, EDDIE_SAY=text)
    kwargs = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if IS_WINDOWS else {"start_new_session": True}
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, **kwargs)
    return {"dicho": text, "summary": "Lo dije en voz alta"}


PARTIAL_DOWNLOAD_EXT = (".crdownload", ".part", ".download", ".tmp")
RECENT_DOWNLOAD_SECS = 120  # qué tan reciente cuenta como "recién terminado"


def t_check_downloads(_args, _cfg):
    """Para las rutinas de evento ("cuando termine la descarga, avísame"): no
    sabe qué se está descargando ni de dónde, solo mira la carpeta Descargas —
    archivos a medio bajar (.crdownload, .part…) cuentan como "descargando";
    el resto, modificados hace poco, como "recién llegados". Eddie compara
    esto con lo que vio la última vez para notar cuándo una descarga termina."""
    target = os.path.join(HOME, "Downloads")
    if not os.path.isdir(target):
        return {"descargando": False, "recientes": [], "summary": "No encuentro una carpeta de Descargas."}
    now = time.time()
    downloading = False
    recent = []
    try:
        with os.scandir(target) as it:
            for e in it:
                if e.name.startswith("."):
                    continue
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if e.name.lower().endswith(PARTIAL_DOWNLOAD_EXT):
                    downloading = True
                    continue
                if e.is_file(follow_symlinks=False) and now - st.st_mtime < RECENT_DOWNLOAD_SECS:
                    recent.append({"nombre": e.name, "hace_s": round(now - st.st_mtime)})
    except OSError:
        return {"descargando": False, "recientes": [], "summary": "No pude leer la carpeta Descargas."}
    recent.sort(key=lambda x: x["hace_s"])
    recent = recent[:5]
    summary = "Descargando…" if downloading else (f"Recién llegó {recent[0]['nombre']}" if recent else "Sin descargas recientes.")
    return {"descargando": downloading, "recientes": recent, "summary": summary}


# ------------------------------------------------------------------- video
# Marketing: editar videos con ffmpeg (gratis, instalado en el equipo). Solo
# operaciones de una lista cerrada, solo con archivos de tu carpeta personal, y
# el resultado va siempre a una carpeta aparte (Videos/Eddie): el original
# nunca se toca ni se pisa. Un video tarda más que los 15 s que Eddie espera la
# respuesta, así que se edita en segundo plano y se consulta con video_status.

VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v")
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")
VIDEO_OPS = ("trim", "join", "vertical", "caption", "music", "compress")
VIDEO_LABELS = {"trim": "recorte", "join": "union", "vertical": "vertical", "caption": "texto", "music": "musica", "compress": "ligero"}
MAX_VIDEO_SECS = 1800  # una entrada más larga que esto se rechaza
VIDEO_TIMEOUT = 1800  # un trabajo que pasa de esto se corta
VIDEO_WAIT = 8  # cuánto espera edit_video por si el trabajo es corto (Eddie espera 15 s)
FOLDER_ALIASES = {"descargas": "Downloads", "escritorio": "Desktop", "documentos": "Documents", "peliculas": "Movies", "videos": "Videos", "musica": "Music"}
VIDEO_JOBS = {}
VIDEO_LOCK = threading.Lock()
ENC_V = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
ENC_A = ["-c:a", "aac", "-b:a", "128k"]
MP4_FAST = ["-movflags", "+faststart"]


def _plain(text):
    return unicodedata.normalize("NFD", str(text)).encode("ascii", "ignore").decode("ascii").lower().strip()


def _hidden():
    """Para que en Windows ffmpeg no abra una ventana de consola."""
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if IS_WINDOWS else {}


def find_ffmpeg(cfg, name="ffmpeg"):
    """Dónde está ffmpeg (o ffprobe): el que diga la configuración ("ffmpeg": ruta), el PATH o los sitios
    habituales de cada sistema (el agente arranca con un PATH corto y no ve lo recién instalado)."""
    exe = name + (".exe" if IS_WINDOWS else "")
    custom = str((cfg or {}).get("ffmpeg") or "")
    if custom:
        cand = os.path.join(os.path.dirname(custom), exe)
        if os.path.isfile(cand):
            return cand
    found = shutil.which(name)
    if found:
        return found
    places = []
    if IS_WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or ""
        places.append(os.path.join(local, "Microsoft", "WinGet", "Links", exe))
        places += sorted(glob.glob(os.path.join(local, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "ffmpeg-*", "bin", exe)), reverse=True)
        for base in (os.environ.get("ProgramFiles"), "C:\\"):
            if base:
                places.append(os.path.join(base, "ffmpeg", "bin", exe))
    elif sys.platform == "darwin":
        places += ["/opt/homebrew/bin/" + exe, "/usr/local/bin/" + exe]
    return next((p for p in places if os.path.isfile(p)), None)


def ffmpeg_hint():
    how = {"windows": "winget install Gyan.FFmpeg  (en una terminal) y vuelve a pedírmelo", "mac": "brew install ffmpeg"}.get(detect_platform(), "sudo apt install ffmpeg")
    return f"Falta ffmpeg (es gratis) en este equipo: instálalo con  {how}."


def out_dir_path():
    return os.path.join(HOME, "Movies" if sys.platform == "darwin" else "Videos", "Eddie")


def _media_folders():
    names = ("Videos", "Movies", "Downloads", "Desktop", "Documents", "Music")
    folders = [os.path.join(HOME, n) for n in names] + [out_dir_path()]
    return [f for f in folders if os.path.isdir(f)]


def _ci_child(folder, name):
    """El nombre real de `name` dentro de `folder`, sin importar mayúsculas."""
    try:
        for entry in os.listdir(folder):
            if entry.lower() == name.lower():
                return entry
    except OSError:
        pass
    return None


def resolve_media(raw, exts, what):
    """Un archivo de video o audio dentro de tu carpeta personal. Acepta una ruta («Videos/clip.mp4»,
    «Descargas/clip.mp4») o solo el nombre («clip.mp4», «clip»), que se busca en Videos, Descargas,
    Escritorio, Documentos y Música (el más reciente)."""
    text = str(raw or "").strip().strip("\"'").replace("\\", "/")
    if not text:
        raise ValueError(f"Dime qué {what} usar.")
    if "/" in text or text.startswith("~"):
        if text.startswith("/") or re.match(r"^[A-Za-z]:/", text):
            full = inside_home(text)
        else:
            cur = HOME
            parts = [p for p in text.split("/") if p and p != "~"]
            for i, part in enumerate(parts):
                if part in (".", ".."):
                    raise ValueError("Solo uso archivos dentro de tu carpeta personal.")
                alias = FOLDER_ALIASES.get(_plain(part)) if i == 0 and len(parts) > 1 else None
                hit = _ci_child(cur, part) or (alias and _ci_child(cur, alias))
                cur = os.path.join(cur, hit or part)
            full = inside_home(cur)
        if not full:
            raise ValueError("Solo uso archivos dentro de tu carpeta personal.")
    else:
        wanted = text.lower()
        found = []
        for folder in _media_folders():
            try:
                with os.scandir(folder) as it:
                    for e in it:
                        low = e.name.lower()
                        if low.endswith(exts) and (low == wanted or os.path.splitext(low)[0] == wanted) and e.is_file(follow_symlinks=False):
                            found.append((e.stat().st_mtime, e.path))
            except OSError:
                continue
        if not found:
            raise ValueError(f"No encuentro «{text[:60]}» en Videos, Descargas, Escritorio, Documentos ni Música. Dime la carpeta (ej. Videos/{text[:40]}).")
        found.sort(reverse=True)
        full = inside_home(found[0][1])
        if not full:
            raise ValueError("Solo uso archivos dentro de tu carpeta personal.")
    if not os.path.isfile(full):
        raise ValueError(f"No existe el archivo {short_path(full)}.")
    if not full.lower().endswith(exts):
        raise ValueError(f"Ese archivo no sirve: uso {', '.join(exts)}.")
    return full


def probe_media(cfg, path):
    """Duración, tamaño de imagen y si trae audio, con ffprobe."""
    ffprobe = find_ffmpeg(cfg, "ffprobe")
    if not ffprobe:
        raise ValueError(ffmpeg_hint())
    try:
        res = subprocess.run([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                             stdin=subprocess.DEVNULL, capture_output=True, timeout=30, **_hidden())
        data = json.loads(res.stdout.decode("utf-8", "replace") or "{}")
    except subprocess.TimeoutExpired:
        raise ValueError("No pude leer el archivo: tardó demasiado.")
    except ValueError:
        raise ValueError("No pude leer el archivo: no parece un video válido.")
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    fmt = data.get("format") or {}
    try:
        duration = float(fmt.get("duration") or (video or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    return {
        "duration": duration,
        "width": int((video or {}).get("width") or 0),
        "height": int((video or {}).get("height") or 0),
        "has_video": video is not None,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "size_mb": round(os.path.getsize(path) / (1024 * 1024), 1),
    }


def parse_time(raw, what="tiempo"):
    """90, 90.5, 1:30 o 1:02:03 → segundos."""
    s = str(raw).strip().replace(",", ".")
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return float(s)
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", s)
    if not m:
        raise ValueError(f"No entiendo el {what} «{str(raw)[:20]}»: usa segundos (90) o minutos:segundos (1:30).")
    return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def clean_caption(raw):
    """El texto que se pondrá en el video: sin etiquetas ni caracteres de control, en pocas líneas."""
    t = re.sub(r"[<>{}\\]", "", str(raw or ""))
    t = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", t)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in t.splitlines()]
    return "\n".join(line for line in lines if line)[:200]


def srt_time(sec):
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def _fmt_dur(sec):
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _plan_edit(op, args, cfg, workdir):
    """Entradas y opciones de ffmpeg para una operación → (opciones, segundos esperados, entrada principal)."""
    inp = resolve_media(args.get("path"), VIDEO_EXTS, "video")
    info = probe_media(cfg, inp)
    if not info["has_video"]:
        raise ValueError("Ese archivo no tiene imagen.")
    if info["duration"] <= 0:
        raise ValueError("No pude saber cuánto dura ese video.")
    if info["duration"] > MAX_VIDEO_SECS:
        raise ValueError(f"Ese video dura {_fmt_dur(info['duration'])}: por ahora edito hasta {MAX_VIDEO_SECS // 60} minutos.")
    dur = info["duration"]
    audio_enc = ENC_A if info["has_audio"] else ["-an"]

    if op == "trim":
        start = parse_time(args["start"], "inicio") if str(args.get("start") or "").strip() else 0.0
        end = parse_time(args["end"], "final") if str(args.get("end") or "").strip() else dur
        end = min(end, dur)
        if start >= dur:
            raise ValueError(f"El inicio ({_fmt_dur(start)}) está después del final del video ({_fmt_dur(dur)}).")
        if end <= start:
            raise ValueError("El final tiene que ir después del inicio.")
        length = end - start
        return ["-ss", f"{start:.3f}", "-i", inp, "-t", f"{length:.3f}"] + ENC_V + audio_enc + MP4_FAST, length, inp

    if op == "vertical":
        vf = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,setsar=1"
        return ["-i", inp, "-vf", vf] + ENC_V + audio_enc + MP4_FAST, dur, inp

    if op == "compress":
        vf = "scale='min(1280,iw)':-2"
        return ["-i", inp, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p"] + (["-c:a", "aac", "-b:a", "96k"] if info["has_audio"] else ["-an"]) + MP4_FAST, dur, inp

    if op == "caption":
        text = clean_caption(args.get("text"))
        if not text:
            raise ValueError("Dime qué texto poner en el video.")
        start = parse_time(args["start"], "inicio") if str(args.get("start") or "").strip() else 0.0
        end = min(parse_time(args["end"], "final") if str(args.get("end") or "").strip() else dur, dur)
        if start >= end:
            raise ValueError("El texto tiene que empezar antes de donde termina.")
        # El texto se escribe en un .srt dentro de la carpeta de trabajo y ffmpeg corre allí: así no hay que escapar rutas.
        with open(os.path.join(workdir, "eddie.srt"), "w", encoding="utf-8") as f:
            f.write(f"1\n{srt_time(start)} --> {srt_time(end)}\n{text}\n")
        portrait = info["height"] > info["width"]
        style = f"Alignment=2,FontName=Arial,Bold=1,FontSize={14 if portrait else 16},Outline=2,Shadow=0,MarginV={70 if portrait else 30}"
        vf = f"subtitles=eddie.srt:force_style='{style}'"
        return ["-i", inp, "-vf", vf] + ENC_V + (["-c:a", "copy"] if info["has_audio"] else ["-an"]) + MP4_FAST, dur, inp

    if op == "music":
        music = resolve_media(args.get("second"), AUDIO_EXTS, "audio")
        if info["has_audio"]:
            fc = "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:weights='1 0.35'[a]"
        else:
            fc = "[1:a]volume=0.8[a]"
        copy_ok = inp.lower().endswith((".mp4", ".mov", ".m4v"))
        return (["-i", inp, "-stream_loop", "-1", "-i", music, "-filter_complex", fc, "-map", "0:v", "-map", "[a]"]
                + (["-c:v", "copy"] if copy_ok else ENC_V) + ENC_A + ["-t", f"{dur:.3f}", "-shortest"] + MP4_FAST), dur, inp

    # join
    other = resolve_media(args.get("second"), VIDEO_EXTS, "segundo video")
    info2 = probe_media(cfg, other)
    if not info2["has_video"] or info2["duration"] <= 0:
        raise ValueError("El segundo archivo no tiene imagen.")
    if info["duration"] + info2["duration"] > MAX_VIDEO_SECS:
        raise ValueError(f"Juntos duran más de {MAX_VIDEO_SECS // 60} minutos.")
    w, h = (info["width"] // 2) * 2, (info["height"] // 2) * 2
    if w < 2 or h < 2:
        raise ValueError("No pude leer el tamaño del primer video.")
    parts = [f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}]" for i in (0, 1)]
    both_audio = info["has_audio"] and info2["has_audio"]
    if both_audio:
        parts += [f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo[a{i}]" for i in (0, 1)]
        parts.append("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]")
    else:
        parts.append("[v0][v1]concat=n=2:v=1:a=0[v]")
    mid = ["-i", inp, "-i", other, "-filter_complex", ";".join(parts), "-map", "[v]"] + (["-map", "[a]"] if both_audio else []) + ENC_V + (ENC_A if both_audio else ["-an"]) + MP4_FAST
    return mid, info["duration"] + info2["duration"], inp


def _job_percent(job):
    """Por dónde va ffmpeg, leyendo el archivo de progreso que él mismo escribe."""
    if job["state"] == "done":
        return 100
    try:
        with open(os.path.join(job["workdir"], "progress.txt"), "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 2048))
            tail = f.read().decode("utf-8", "replace")
    except OSError:
        return 0
    marks = re.findall(r"out_time_(?:us|ms)=(\d+)", tail)
    if not marks or job["expected"] <= 0:
        return 0
    return max(0, min(99, int(int(marks[-1]) / 1_000_000 / job["expected"] * 100)))


def _watch_video_job(job, err):
    timed_out = False
    try:
        job["proc"].wait(timeout=VIDEO_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        job["proc"].kill()
        job["proc"].wait()
    finally:
        err.close()
    detail = ""
    try:
        with open(os.path.join(job["workdir"], "error.txt"), "rb") as f:
            lines = [l.strip() for l in f.read().decode("utf-8", "replace").splitlines() if l.strip()]
        detail = lines[-1][:300] if lines else ""
    except OSError:
        pass
    size = os.path.getsize(job["output"]) if os.path.isfile(job["output"]) else 0
    if job["proc"].returncode == 0 and size > 0 and not timed_out:
        job["size_mb"] = round(size / (1024 * 1024), 1)
        job["state"] = "done"
    else:
        try:
            os.remove(job["output"])  # nunca dejar un video a medias
        except OSError:
            pass
        job["error"] = f"Se cortó: tardó más de {VIDEO_TIMEOUT // 60} minutos." if timed_out else (detail or "ffmpeg no pudo terminar la edición.")
        job["state"] = "error"
    job["ended"] = time.time()
    shutil.rmtree(job["workdir"], ignore_errors=True)


def _job_view(job):
    name = short_path(job["output"])
    base = {"id": job["id"], "operacion": job["op"], "archivo": name, "carpeta": short_path(os.path.dirname(job["output"]))}
    if job["state"] == "running":
        pct = _job_percent(job)
        return {**base, "estado": "editando", "porcentaje": pct, "summary": f"Editando el video… {pct}%"}
    if job["state"] == "done":
        return {**base, "estado": "listo", "tamano_mb": job.get("size_mb"), "summary": f"Listo: {name}"}
    return {**base, "estado": "error", "error": job.get("error"), "summary": f"No se pudo editar: {job.get('error')}"}


def t_edit_video(args, cfg):
    op = str(args.get("operation") or "").strip().lower()
    if op not in VIDEO_OPS:
        raise ValueError(f"Operación desconocida. Puedo: {', '.join(VIDEO_OPS)}.")
    ffmpeg = find_ffmpeg(cfg)
    if not ffmpeg:
        raise ValueError(ffmpeg_hint())
    with VIDEO_LOCK:
        busy = next((j for j in VIDEO_JOBS.values() if j["state"] == "running"), None)
        if busy:
            raise ValueError(f"Ya estoy editando «{os.path.basename(busy['input'])}» ({_job_percent(busy)}%). Espera a que termine.")
        workdir = tempfile.mkdtemp(prefix="eddie-video-")
        try:
            mid, expected, inp = _plan_edit(op, args, cfg, workdir)
            os.makedirs(out_dir_path(), exist_ok=True)
            stem = re.sub(r"[^\w\-]+", "_", os.path.splitext(os.path.basename(inp))[0]).strip("_")[:40] or "video"
            out = os.path.join(out_dir_path(), f"{stem}-{VIDEO_LABELS[op]}-{time.strftime('%Y%m%d-%H%M%S')}.mp4")
            argv = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", os.path.join(workdir, "progress.txt")] + mid + [out]
            err = open(os.path.join(workdir, "error.txt"), "wb")
            proc = subprocess.Popen(argv, cwd=workdir, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err, **_hidden())
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        job = {"id": os.urandom(4).hex(), "op": op, "input": inp, "output": out, "workdir": workdir, "expected": expected,
               "state": "running", "started": time.time(), "proc": proc}
        VIDEO_JOBS[job["id"]] = job
        for old in sorted(VIDEO_JOBS.values(), key=lambda j: j["started"])[:-10]:
            if old["state"] != "running":
                VIDEO_JOBS.pop(old["id"], None)
    threading.Thread(target=_watch_video_job, args=(job, err), daemon=True).start()
    log("Edición de video:", op, short_path(inp), "→", short_path(out))
    deadline = time.time() + VIDEO_WAIT
    while time.time() < deadline and job["state"] == "running":
        time.sleep(0.25)
    view = _job_view(job)
    if job["state"] == "running":
        view["summary"] = f"Empecé a editar el video ({view['porcentaje']}%); tarda un poco, pregunta cómo va"
    return view


def t_video_status(args, _cfg):
    want = str(args.get("id") or "").strip()
    with VIDEO_LOCK:
        jobs = sorted(VIDEO_JOBS.values(), key=lambda j: j["started"], reverse=True)
    job = next((j for j in jobs if not want or j["id"] == want), None)
    if job:
        return _job_view(job)
    recent = []
    try:
        names = [n for n in os.listdir(out_dir_path()) if n.lower().endswith(".mp4")]
        names.sort(key=lambda n: os.path.getmtime(os.path.join(out_dir_path(), n)), reverse=True)
        recent = names[:5]
    except OSError:
        pass
    return {"estado": "sin_trabajos", "ultimos_videos": recent, "carpeta": short_path(out_dir_path()), "summary": "No estoy editando nada ahora."}


def t_video_info(args, cfg):
    if not find_ffmpeg(cfg):
        return {"ffmpeg": False, "instalar": ffmpeg_hint(), "summary": "Este equipo todavía no tiene ffmpeg."}
    out = {"ffmpeg": True, "carpeta_de_salida": short_path(out_dir_path())}
    if str(args.get("path") or "").strip():
        path = resolve_media(args.get("path"), VIDEO_EXTS + AUDIO_EXTS, "archivo")
        info = probe_media(cfg, path)
        out.update({"archivo": short_path(path), "duracion_s": round(info["duration"], 1), "ancho": info["width"], "alto": info["height"],
                    "con_audio": info["has_audio"], "tamano_mb": info["size_mb"]})
        size = f", {info['width']}x{info['height']}" if info["has_video"] else ""
        out["summary"] = f"{os.path.basename(path)}: {_fmt_dur(info['duration'])}{size}"
        return out
    recent = []
    for folder in _media_folders():
        try:
            with os.scandir(folder) as it:
                for e in it:
                    if e.name.lower().endswith(VIDEO_EXTS) and e.is_file(follow_symlinks=False):
                        st = e.stat()
                        recent.append((st.st_mtime, e.path, st.st_size))
        except OSError:
            continue
    recent.sort(reverse=True)
    out["videos_recientes"] = [{"archivo": short_path(p), "modificado": time.strftime("%Y-%m-%d %H:%M", time.localtime(m)), "tamano_mb": round(sz / (1024 * 1024), 1)} for m, p, sz in recent[:12]]
    out["summary"] = f"ffmpeg listo; {len(recent)} video{'s' if len(recent) != 1 else ''} en tus carpetas"
    return out


def _is_mine(proc):
    """¿El proceso es de este usuario? (uids en Linux/Mac; nombre de usuario en Windows)."""
    if hasattr(proc, "uids") and hasattr(os, "getuid"):
        return proc.uids().real == os.getuid()
    try:
        return proc.username().lower() == psutil.Process().username().lower()
    except psutil.Error:
        return False


def t_kill_process(args, _cfg):
    need_psutil()
    pid = int(args.get("pid") or 0)
    if pid <= 1 or pid == os.getpid():
        raise ValueError("Ese proceso no se puede cerrar.")
    try:
        p = psutil.Process(pid)
        if not _is_mine(p):
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


# ---------------------------------------------------------------- red local
# Qué hay conectado a la red de este equipo. Sin ataques ni escaneo de puertos:
# se manda un paquete suelto a cada dirección (para que el sistema aprenda su MAC
# y aparezca en su tabla de vecinos) y se escucha lo que los propios dispositivos
# anuncian (mDNS: impresoras, Chromecast, altavoces… y SSDP: televisores, routers).
# Solo la red privada a la que estamos conectados, nunca más de una /24.

NET_LISTEN_S = 2.5
MDNS_ADDR = ("224.0.0.251", 5353)
SSDP_ADDR = ("239.255.255.250", 1900)
SSDP_SEARCH = (
    'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'
).encode()
MDNS_QUERIES = [
    "_services._dns-sd._udp.local",
    "_googlecast._tcp.local",
    "_airplay._tcp.local",
    "_spotify-connect._tcp.local",
    "_ipp._tcp.local",
    "_smb._tcp.local",
    "_hap._tcp.local",
    "_http._tcp.local",
]
MAX_DEVICES_SHOWN = 40
MAC_RE = re.compile(r"\b([0-9A-Fa-f]{2}(?:[-:][0-9A-Fa-f]{2}){5})\b")
IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


# Solo las redes privadas de verdad (casa, oficina). Python también marca como «privadas»
# rangos de documentación y similares: aquí no nos sirven.
PRIVATE_RANGES = [ipaddress.IPv4Network(r) for r in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]


def private_networks():
    """Las redes privadas a las que está conectado este equipo: [(IP de este equipo, red)]."""
    found = []
    if psutil is None:
        return found
    for name, addrs in psutil.net_if_addrs().items():
        if name.lower().startswith("lo"):
            continue
        for a in addrs:
            if a.family != socket.AF_INET or not a.netmask:
                continue
            try:
                iface = ipaddress.IPv4Interface(f"{a.address}/{a.netmask}")
            except ValueError:
                continue
            if any(iface.ip in net for net in PRIVATE_RANGES):
                found.append((iface.ip, iface.network))
    return found


def parse_neighbors(text, net):
    """La tabla de vecinos del sistema (arp -a, ip neigh…) → {ip: mac}, solo las IP de la red."""
    out = {}
    for line in text.splitlines():
        ip_m, mac_m = IPV4_RE.search(line), MAC_RE.search(line)
        if not ip_m or not mac_m:
            continue
        try:
            ip = ipaddress.IPv4Address(ip_m.group(1))
        except ValueError:
            continue
        mac = mac_m.group(1).lower().replace("-", ":")
        if ip not in net or mac in ("00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff") or int(mac[:2], 16) & 1:
            continue
        out[str(ip)] = mac
    return out


def read_neighbors(net):
    commands = [["arp", "-a"]] if IS_WINDOWS else [["ip", "neigh"], ["arp", "-an"]]
    table = {}
    for cmd in commands:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=5)
        except (OSError, subprocess.SubprocessError):
            continue
        table.update(parse_neighbors(r.stdout, net))
    return table


def poke(hosts):
    """Un paquete suelto a cada dirección: el sistema tiene que preguntar su MAC (así aparece en la tabla)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for host in hosts:
            try:
                s.sendto(b"\x00", (str(host), 9))
            except OSError:
                pass  # una dirección inalcanzable no es un error
    finally:
        s.close()


def _dns_name(name):
    out = b""
    for label in name.split("."):
        raw = label.encode("utf-8")
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def _dns_query(names):
    body = b"".join(_dns_name(n) + struct.pack("!HH", 12, 1) for n in names)  # PTR, clase IN
    return struct.pack("!HHHHHH", 0, 0, len(names), 0, 0, 0) + body


def _read_name(buf, pos, depth=0):
    """Un nombre DNS (con sus punteros de compresión) → (texto, posición siguiente)."""
    labels, end = [], None
    while True:
        if pos >= len(buf) or depth > 16:
            raise ValueError("nombre DNS fuera de rango")
        ln = buf[pos]
        if ln & 0xC0 == 0xC0:
            if end is None:
                end = pos + 2
            pos = ((ln & 0x3F) << 8) | buf[pos + 1]
            depth += 1
            continue
        if ln == 0:
            return ".".join(labels), (end if end is not None else pos + 1)
        if pos + 1 + ln > len(buf):
            raise ValueError("etiqueta DNS fuera de rango")
        labels.append(buf[pos + 1 : pos + 1 + ln].decode("utf-8", "replace"))
        pos += 1 + ln


def _txt(rdata):
    parts, i = [], 0
    while i < len(rdata):
        ln = rdata[i]
        parts.append(rdata[i + 1 : i + 1 + ln].decode("utf-8", "replace"))
        i += 1 + ln
    return " ".join(parts)


def parse_mdns(buf):
    """Una respuesta mDNS → [(dueño, tipo, valor)]: direcciones, servicios, nombres y textos. Una pregunta da []."""
    if len(buf) < 12:
        return []
    _id, flags, qd, an, ns, ar = struct.unpack("!HHHHHH", buf[:12])
    if not flags & 0x8000:
        return []
    pos = 12
    for _ in range(qd):
        _, pos = _read_name(buf, pos)
        pos += 4
    out = []
    for _ in range(an + ns + ar):
        owner, pos = _read_name(buf, pos)
        rtype, _cls, _ttl, rdlen = struct.unpack("!HHIH", buf[pos : pos + 10])
        pos += 10
        rdata = buf[pos : pos + rdlen]
        if len(rdata) != rdlen:
            raise ValueError("registro DNS cortado")
        if rtype == 1 and rdlen == 4:
            out.append((owner, "A", socket.inet_ntoa(rdata)))
        elif rtype == 12:
            out.append((owner, "PTR", _read_name(buf, pos)[0]))
        elif rtype == 33:
            out.append((owner, "SRV", _read_name(buf, pos + 6)[0]))
        elif rtype == 16:
            out.append((owner, "TXT", _txt(rdata)))
        pos += rdlen
    return out


def mdns_summary(entries):
    """Lo que dice un dispositivo de sí mismo → (nombres, servicios)."""
    names, services = set(), set()
    for owner, kind, value in entries:
        if kind == "PTR":
            first = value.split(".")[0]
            if first.startswith("_"):  # una lista de servicios: el servicio es el valor (p. ej. _googlecast._tcp)
                services.add(".".join(value.split(".")[:2]))
            elif first:
                names.add(first)  # una instancia anunciada: su nombre (p. ej. Sala-TV)
            if owner.startswith("_") and not owner.startswith("_services."):  # y el dueño dice el servicio
                services.add(".".join(owner.split(".")[:2]))
        elif kind == "SRV":
            host = value.split(".")[0]
            if host:
                names.add(host)
        elif kind == "TXT":
            m = re.search(r"(?:^| )fn=(.+?)(?= [A-Za-z]{2,}=|$)", value)  # nombre amigable (Chromecast…)
            if m:
                names.add(m.group(1).strip())
    return {n[:60] for n in names}, services


def parse_ssdp(text):
    """Una respuesta SSDP → sus cabeceras en minúsculas (o {} si no es una respuesta)."""
    lines = text.replace("\r", "").split("\n")
    if not lines or not lines[0].upper().startswith(("HTTP/1.1 200", "NOTIFY")):
        return {}
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return headers


def discover(net, *, mdns_dest=MDNS_ADDR, ssdp_dest=SSDP_ADDR, listen_s=NET_LISTEN_S):
    """Pregunta por mDNS y SSDP y escucha un rato lo que contestan los de esta red.
    → {ip: {"nombres": set, "servicios": set, "anuncia": set}}"""
    found = {}

    def entry(ip):
        return found.setdefault(ip, {"nombres": set(), "servicios": set(), "anuncia": set()})

    socks = []
    try:
        mdns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        socks.append(mdns)
        ssdp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        socks.append(ssdp)
        # Desde un puerto libre (no el 5353): así los dispositivos contestan directo a este equipo.
        for dest, payload, sock in ((mdns_dest, _dns_query(MDNS_QUERIES), mdns), (ssdp_dest, SSDP_SEARCH, ssdp)):
            try:
                sock.sendto(payload, dest)
            except OSError:
                pass  # sin red para este tipo de anuncio: se sigue con el otro
        end = time.time() + listen_s
        while True:
            left = end - time.time()
            if left <= 0:
                break
            ready, _, _ = select.select(socks, [], [], left)
            for sock in ready:
                try:
                    data, (src, _port) = sock.recvfrom(9000)
                except OSError:
                    continue
                if ipaddress.IPv4Address(src) not in net:
                    continue
                if sock is mdns:
                    try:
                        entries = parse_mdns(data)
                    except Exception:  # un paquete mal formado de un dispositivo: se ignora
                        continue
                    names, services = mdns_summary(entries)
                    entry(src)["nombres"] |= names
                    entry(src)["servicios"] |= services
                    for owner, kind, value in entries:
                        if kind == "A" and ipaddress.IPv4Address(value) in net and not owner.startswith("_"):
                            entry(value)["nombres"].add(owner.split(".")[0][:60])
                else:
                    server = parse_ssdp(data.decode("utf-8", "replace")).get("server")
                    if server:
                        entry(src)["anuncia"].add(server[:60])
    finally:
        for sock in socks:
            sock.close()
    return found


def t_scan_network(_args, _cfg):
    nets = private_networks()
    if not nets:
        return {"dispositivos": [], "total": 0, "summary": "No estoy conectado a una red privada (casa u oficina).", "nota": "Revisa la conexión del equipo."}
    me, net = nets[0]
    if net.num_addresses > 256:  # una red enorme: solo la /24 de este equipo
        net = ipaddress.IPv4Network(f"{me}/24", strict=False)
    poke(list(net.hosts()))
    found = discover(net)
    table = read_neighbors(net)
    rows = []
    for ip in sorted(set(table) | set(found), key=ipaddress.IPv4Address):
        f = found.get(ip, {"nombres": set(), "servicios": set(), "anuncia": set()})
        names = sorted(f["nombres"])
        rows.append(
            {
                "ip": ip,
                "mac": table.get(ip),
                "nombre": names[0] if names else None,
                "servicios": sorted(f["servicios"])[:4],
                "anuncia": sorted(f["anuncia"])[:1],
                "este_equipo": ipaddress.IPv4Address(ip) == me,
            }
        )
    if str(me) not in {r["ip"] for r in rows}:
        rows.append({"ip": str(me), "mac": None, "nombre": socket.gethostname(), "servicios": [], "anuncia": [], "este_equipo": True})
        rows.sort(key=lambda r: ipaddress.IPv4Address(r["ip"]))
    notes = []
    if detect_platform() == "chromebook":
        notes.append("Este equipo es un Chromebook: Linux corre dentro de una red virtual, así que puede que no vea los dispositivos reales de tu red.")
    if len(rows) <= 1:
        notes.append("Solo aparece este equipo: los demás pueden estar apagados o el router puede aislar a los clientes entre sí.")
    if len(rows) > MAX_DEVICES_SHOWN:
        notes.append(f"Muestro {MAX_DEVICES_SHOWN} de {len(rows)}.")
    named = sum(1 for r in rows if r["nombre"])
    out = {
        "red": str(net),
        "total": len(rows),
        "dispositivos": rows[:MAX_DEVICES_SHOWN],
        "summary": f"{len(rows)} dispositivo{'s' if len(rows) != 1 else ''} en {net} ({named} con nombre)",
    }
    if notes:
        out["nota"] = " ".join(notes)
    return out


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
    "open_app": (t_open_app, "Abrir una app", "Busca y abre cualquier app instalada por su nombre.", "confirm", {"name": S("Nombre de la app a abrir.")}),
    "kill_process": (t_kill_process, "Cerrar un proceso", "Cierra un proceso de tu usuario por su pid.", "confirm", {"pid": I("Id del proceso.")}),
    "scan_network": (t_scan_network, "Dispositivos en tu red", "Qué hay conectado a la misma red (IP, MAC y el nombre que cada uno anuncia). Solo mira; no ataca ni escanea puertos.", "read", {}),
    "open_urls": (t_open_urls, "Abrir páginas web", "Abre una o varias páginas https en el navegador predeterminado, aunque el navegador esté cerrado.", "confirm", {"urls": S("Direcciones https separadas por espacios o saltos de línea.")}),
    "say_text": (t_say_text, "Decir algo en voz alta", "Dice un texto en voz alta con la voz del sistema.", "confirm", {"text": S("Qué decir (máx. 300 caracteres).")}),
    "check_downloads": (t_check_downloads, "Revisar descargas", "Dice si hay una descarga en curso en la carpeta Descargas y qué llegó hace poco. Lo usan las rutinas automáticas por evento.", "read", {}),
    "video_info": (t_video_info, "Ver videos y ffmpeg", "Dice si ffmpeg está instalado; con una ruta, la duración y el tamaño de un video; sin ruta, tus videos recientes.", "read", {"path": S("Video o audio: nombre (ej. clip.mp4) o ruta dentro de tu carpeta personal (opcional).")}),
    "edit_video": (t_edit_video, "Editar un video", "Con ffmpeg crea un video NUEVO en Videos/Eddie (el original no se toca): recortar, unir, formato vertical 9:16, poner un texto, añadir música o aligerarlo.", "confirm", {
        "operation": {"type": "string", "enum": list(VIDEO_OPS), "description": "trim, join, vertical, caption, music o compress."},
        "path": S("Video a editar: nombre (clip.mp4) o ruta (Videos/clip.mp4)."),
        "second": S("join: el segundo video. music: el audio (mp3, wav…)."),
        "start": S("trim y caption: inicio (90 o 1:30). Opcional."),
        "end": S("trim y caption: final (90 o 1:30). Opcional."),
        "text": S("caption: el texto a mostrar (máx. 200 caracteres)."),
    }),
    "video_status": (t_video_status, "Cómo va la edición", "Dice cómo va la edición del video (porcentaje y archivo listo).", "read", {"id": S("Id del trabajo (opcional; sin él, el último).")}),
}

REQUIRED = {"list_directory": ["path"], "open_app": ["name"], "kill_process": ["pid"], "open_urls": ["urls"], "say_text": ["text"], "edit_video": ["operation", "path"]}


def catalog(cfg):
    out = []
    for name, (_fn, label, desc, risk, params) in TOOLS.items():
        if name == "open_app" and cfg.get("apps"):
            desc = f"{desc} Con nombre propio en la configuración: {', '.join(sorted(cfg['apps']))}."
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


def ntfy_url(cfg, suffix):
    return f"{cfg['ntfy'].rstrip('/')}/{cfg['topic']}/{suffix}"


def remember(state, msg):
    """Guarda hasta qué aviso ya se vio, para no atender dos veces el mismo."""
    if msg.get("id"):
        state["since"] = msg["id"]


def stream_forever(cfg, on_ring, stop, state):
    """Escucha el tema secreto de ntfy con una conexión abierta (avisa al instante).

    Una conexión así puede morir en silencio (un router, un antivirus o una VPN que la retienen):
    por eso tiene un tiempo máximo de silencio y, ocurra lo que ocurra, vuelve a conectar.
    """
    backoff = 2
    while not stop.is_set():
        try:
            req = urllib.request.Request(ntfy_url(cfg, "json"), headers={"User-Agent": f"eddie-agent/{VERSION}"})
            with urllib.request.urlopen(req, timeout=STREAM_TIMEOUT) as res:
                log("Esperando trabajos (aviso:", cfg["ntfy"] + ")")
                backoff = 2
                for raw in res:
                    if stop.is_set():
                        return
                    line = raw.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if msg.get("event") == "message":
                        remember(state, msg)
                        on_ring()
            on_ring()  # la conexión se cerró limpia: por si llegó algo mientras tanto
        except Exception as e:  # cualquier fallo: se reconecta, nunca se cae el agente
            if stop.is_set():
                return
            log(f"Aviso desconectado ({e}); reintento en {backoff} s")
            stop.wait(backoff)
            backoff = min(backoff * 2, 60)
            on_ring()


def poll_once(cfg, state):
    """Mira los avisos recientes del tema (una petición corta, sin conexión abierta). → ¿hubo alguno nuevo?"""
    req = urllib.request.Request(ntfy_url(cfg, f"json?poll=1&since={state['since']}"), headers={"User-Agent": f"eddie-agent/{VERSION}"})
    rang = False
    with urllib.request.urlopen(req, timeout=15) as res:
        for raw in res:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("event") == "message":
                remember(state, msg)
                rang = True
    return rang


def setup_logging():
    """Sin terminal (pythonw en Windows, un servicio…) lo que se imprime va a agent.log."""
    stream = sys.stdout
    if stream is not None and getattr(stream, "isatty", lambda: False)():
        return
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > MAX_LOG_BYTES:
            os.replace(LOG_PATH, LOG_PATH + ".old")
        f = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
    except OSError:
        return
    sys.stdout = f
    sys.stderr = f


def pid_is_agent(pid):
    """¿Ese pid es otro eddie_agent.py en marcha?"""
    if psutil is None or pid == os.getpid():
        return False
    try:
        return any("eddie_agent" in part for part in psutil.Process(pid).cmdline())
    except (psutil.Error, OSError):
        return False


def acquire_lock():
    """Una sola copia del agente a la vez (la tarea de inicio y una terminal no se pisan)."""
    try:
        with open(LOCK_PATH, "r", encoding="utf-8") as f:
            other = int(f.read().strip() or 0)
    except (OSError, ValueError):
        other = 0
    if other and pid_is_agent(other):
        return False
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(LOCK_PATH, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    return True


def release_lock():
    try:
        with open(LOCK_PATH, "r", encoding="utf-8") as f:
            if int(f.read().strip() or 0) != os.getpid():
                return
        os.remove(LOCK_PATH)
    except (OSError, ValueError):
        pass


def cmd_run(cfg):
    if not cfg.get("token"):
        sys.exit("Este equipo no está vinculado. Usa: python3 eddie_agent.py pair CÓDIGO")
    setup_logging()
    if not acquire_lock():
        log("Ya hay otro EDDIE Prime en marcha en este equipo; no abro una segunda copia.")
        return
    try:
        run_loop(cfg)
    finally:
        release_lock()


def os_boot_time():
    """Cuándo se encendió el equipo (segundos desde 1970), para que Eddie sepa si es un encendido nuevo o solo el agente que se reinició."""
    try:
        return int(psutil.boot_time()) if psutil else None
    except Exception:
        return None


def read_alive():
    try:
        with open(ALIVE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_alive(boot):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        tmp = ALIVE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "boot": boot}, f)
        os.replace(tmp, ALIVE_PATH)
    except OSError:
        pass  # sin esto solo se pierde la detección de «recién encendido»


def detect_new_start(now=None, boot=None, prev=None):
    """¿Este arranque del agente es un encendido nuevo del equipo (y no un simple reinicio del agente)?

    La hora de arranque del sistema no basta: con el «inicio rápido» de Windows, apagar y encender NO la
    cambia. Por eso el agente anota cada ~20 s que sigue vivo; si al arrancar la última marca es de hace más de
    NEW_START_GAP segundos, el equipo estuvo apagado. También cuenta si la hora de arranque cambió.
    """
    now = time.time() if now is None else now
    if prev is None:
        # Primera vez con marcas: solo es un encendido si el equipo arrancó hace poco (no si el agente se acaba de instalar).
        return bool(boot) and now - boot < FRESH_BOOT_SECS
    try:
        gap = now - float(prev.get("t", 0))
    except (TypeError, ValueError):
        return False
    if gap > NEW_START_GAP:
        return True
    old_boot = prev.get("boot")
    return bool(boot and old_boot and abs(boot - old_boot) > 120)


def run_loop(cfg):
    stop = threading.Event()
    state = {"since": "all", "fatal": None}
    signal.signal(signal.SIGTERM, lambda *_: stop.set() or sys.exit(0))
    last = {"t": 0.0}
    busy = threading.Lock()
    again = threading.Event()

    def ring():
        # La conexión abierta y la consulta periódica pueden avisar a la vez: uno trabaja y el otro lo deja anotado.
        if not busy.acquire(blocking=False):
            again.set()
            return
        try:
            while True:
                again.clear()
                if time.time() - last["t"] < MIN_FETCH_GAP:
                    time.sleep(MIN_FETCH_GAP)
                last["t"] = time.time()
                try:
                    drain(cfg)
                except ApiError as e:
                    if e.status == 401:
                        state["fatal"] = "Eddie rechazó el token: el equipo se desvinculó. Vuelve a vincularlo desde Conectores."
                        stop.set()
                        return
                    log("Error al pedir trabajo:", e)
                except (urllib.error.URLError, OSError) as e:
                    log("Sin conexión con Eddie:", e)
                if not again.is_set():
                    return
        finally:
            busy.release()

    # ¿Encendido nuevo? Se calcula antes de saludar y se anota ya que sigue vivo.
    boot = os_boot_time()
    new_start = detect_new_start(boot=boot, prev=read_alive())
    write_alive(boot)
    log("Encendido nuevo del equipo." if new_start else "Reinicio del agente (el equipo ya estaba encendido).")
    last_alive = time.time()

    # Al arrancar: se presenta (catálogo actualizado) y recoge lo pendiente.
    wait = 5
    while True:
        try:
            hello = api(cfg, "agent/hello", {"version": VERSION, "platform": detect_platform(), "tools": catalog(cfg), "boot_time": boot, "new_start": new_start})
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
    threading.Thread(target=stream_forever, args=(cfg, ring, stop, state), daemon=True).start()
    failing = False
    while not stop.is_set():
        stop.wait(POLL_SECS)
        if stop.is_set():
            break
        if time.time() - last_alive >= ALIVE_EVERY:
            write_alive(boot)
            last_alive = time.time()
        try:
            if poll_once(cfg, state):
                ring()
            if failing:
                log("La consulta de avisos se recuperó.")
                failing = False
        except Exception as e:
            if not failing:
                log(f"No pude consultar los avisos ({e}); sigo intentándolo.")
                failing = True
    if state["fatal"]:
        sys.exit(state["fatal"])


def cmd_pair(args):
    cfg = load_config()
    cfg["app"] = (args.app or cfg.get("app") or DEFAULT_APP).rstrip("/")
    name = args.name or socket.gethostname()
    try:
        data = api(cfg, "agent/pair", {"code": args.code.strip().upper(), "name": name, "version": VERSION, "platform": detect_platform(), "tools": catalog(cfg)}, token=False)
    except ApiError as e:
        sys.exit(f"No se pudo vincular: {e}")
    cfg.update({"token": data["token"], "topic": data["topic"], "ntfy": data["ntfy"], "name": data["name"]})
    cfg.setdefault("apps", dict(WINDOWS_APPS) if IS_WINDOWS else {})
    save_config(cfg)
    print(f"Vinculado como «{data['name']}» con {data['tools']} herramientas. Configuración: {CONFIG_PATH}")
    if os.environ.get("EDDIE_INSTALLER"):
        return  # el instalador (Windows) se encarga él mismo del arranque automático
    if IS_WINDOWS:
        print("Ahora arráncalo:  python3 eddie_agent.py run   (o usa el instalador de un clic para que arranque solo)")
        return
    try:
        cmd_install_service(cfg)
        print("Listo: EDDIE Prime ya arranca solo cada vez que enciendes el equipo.")
    except Exception as e:
        print(f"Vinculado, pero no pude dejarlo arrancando solo ({e}). Arráncalo a mano:  python3 eddie_agent.py run")


def cmd_test(cfg):
    for name in ["system_summary", "disk_usage", "memory_usage", "battery_status", "uptime"]:
        try:
            print(name, "→", json.dumps(run_tool(name, {}, cfg), ensure_ascii=False)[:300])
        except Exception as e:
            print(name, "→ error:", e)


MAC_LAUNCH_AGENT_LABEL = "com.eddie.agent"


def _install_service_mac():
    """LaunchAgent de usuario: arranca solo al iniciar sesión y Mac lo reinicia si se cae."""
    agents_dir = os.path.join(os.path.expanduser("~"), "Library", "LaunchAgents")
    os.makedirs(agents_dir, exist_ok=True)
    script = os.path.realpath(__file__)
    log = os.path.join(config_dir(), "agent.log")
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>{MAC_LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array><string>{sys.executable}</string><string>{script}</string><string>run</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>{log}</string>
    <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"""
    path = os.path.join(agents_dir, f"{MAC_LAUNCH_AGENT_LABEL}.plist")
    with open(path, "w", encoding="utf-8") as f:
        f.write(plist)
    print("LaunchAgent escrito en", path)
    uid = os.getuid()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{MAC_LAUNCH_AGENT_LABEL}"], capture_output=True, text=True)
    r = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", path], capture_output=True, text=True)
    print("$ launchctl bootstrap →", "ok" if r.returncode == 0 else (r.stderr.strip() or r.returncode))
    print("Ver el registro: ", log)


def _install_service_linux():
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


def cmd_install_service(_cfg):
    if IS_WINDOWS:
        sys.exit("En Windows usa el instalador de un clic de Conectores → «Tu equipo (EDDIE Prime)»: deja el agente arrancando solo al iniciar sesión.")
    if sys.platform == "darwin":
        return _install_service_mac()
    return _install_service_linux()


def main():
    parser = argparse.ArgumentParser(description="EDDIE Prime: el agente de Eddie en tu equipo.")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("pair", help="vincular con el código de Conectores")
    p.add_argument("code")
    p.add_argument("--app", help=f"dirección de Eddie (por defecto {DEFAULT_APP})")
    p.add_argument("--name", help="nombre del equipo")
    sub.add_parser("run", help="esperar y ejecutar trabajos")
    sub.add_parser("test", help="probar las herramientas aquí")
    sub.add_parser("install-service", help="arrancar solo (systemd en Linux, LaunchAgent en Mac); «pair» ya lo hace")
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
