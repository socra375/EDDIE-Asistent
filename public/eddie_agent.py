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
import threading
import time
import urllib.error
import urllib.request

VERSION = "1.7.0"
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
    "check_downloads": (t_check_downloads, "Revisar descargas", "Dice si hay una descarga en curso en la carpeta Descargas y qué llegó hace poco. Lo usan las rutinas automáticas por evento.", "read", {}),
}

REQUIRED = {"list_directory": ["path"], "open_app": ["name"], "kill_process": ["pid"]}


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

    # Al arrancar: se presenta (catálogo actualizado) y recoge lo pendiente.
    wait = 5
    while True:
        try:
            hello = api(cfg, "agent/hello", {"version": VERSION, "platform": detect_platform(), "tools": catalog(cfg)})
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
