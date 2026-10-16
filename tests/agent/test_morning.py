"""Pruebas del agente EDDIE Prime para «buenos días al encender»: el chequeo del equipo, los procesos protegidos, la voz y el
saludo completo. Sin equipo real: todo lo externo (voz, navegador, medidas, red) se sustituye. Lo corre tests/morning.test.mjs."""
import importlib.util
import os
import sys
import unittest
from unittest import mock

sys.dont_write_bytecode = True  # no dejar .pyc dentro de public/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("eddie_agent", os.path.join(ROOT, "public", "eddie_agent.py"))
agent = importlib.util.module_from_spec(spec)
sys.modules["eddie_agent"] = agent
spec.loader.exec_module(agent)

MB = 1024 * 1024
GOOD = {"ram_percent": 45, "cpu_percent": 12, "disk_free_gb": 120, "disk_free_percent": 40, "uptime_hours": 30, "session_minutes": 20, "battery": None, "heavy": []}


def checkup(**over):
    return agent.build_checkup({**GOOD, **over})


class Checkup(unittest.TestCase):
    def test_all_good_says_so_with_numbers(self):
        out = checkup()
        self.assertEqual(out["findings"], [])
        self.assertEqual(out["spoken"], "Revisé tu equipo y está bien: la memoria va al 45 por ciento y quedan 120 gigas libres en el disco.")

    def test_high_memory_names_the_biggest_apps_and_offers_help(self):
        out = checkup(ram_percent=91, heavy=[{"nombre": "Chrome", "mb": 2400}, {"nombre": "Teams", "mb": 800}, {"nombre": "Spotify", "mb": 400}])
        self.assertEqual(out["findings"][0]["level"], "warn")
        self.assertIn("91 por ciento, sobre todo por Chrome y Teams", out["spoken"])
        self.assertNotIn("Spotify", out["spoken"], "only the two biggest")
        self.assertTrue(out["spoken"].endswith("Si quieres, dime qué cerrar y lo hago."))

    def test_medium_memory_is_a_remark_not_a_warning(self):
        out = checkup(ram_percent=75, heavy=[{"nombre": "Chrome", "mb": 2400}])
        self.assertEqual([f["level"] for f in out["findings"]], ["info"])
        self.assertNotIn("dime qué cerrar", out["spoken"])

    def test_cpu_busy_right_after_boot_is_not_an_alarm(self):
        out = checkup(cpu_percent=90, session_minutes=2)
        self.assertEqual(out["findings"][0]["level"], "info")
        self.assertIn("aún termina de arrancar", out["spoken"])
        late = checkup(cpu_percent=90, session_minutes=30)
        self.assertEqual(late["findings"][0]["level"], "warn")
        self.assertEqual(checkup(cpu_percent=70, session_minutes=30)["findings"], [], "busy but not alarming, and not booting")

    def test_disk(self):
        self.assertEqual(checkup(disk_free_gb=6, disk_free_percent=3)["findings"][0]["key"], "disk")
        self.assertEqual(checkup(disk_free_gb=6, disk_free_percent=3)["findings"][0]["level"], "warn")
        self.assertEqual(checkup(disk_free_gb=40, disk_free_percent=7)["findings"][0]["level"], "warn", "7 % free is low even with 40 GB")
        self.assertEqual(checkup(disk_free_gb=30, disk_free_percent=12)["findings"][0]["level"], "info")
        self.assertEqual(checkup(disk_free_gb=80, disk_free_percent=40)["findings"], [])

    def test_a_long_uptime_recommends_a_real_restart(self):
        out = checkup(uptime_hours=24 * 9)
        self.assertIn("Llevas 9 días sin reiniciar el equipo del todo", out["spoken"])
        self.assertIn("y no solo apagarlo", out["spoken"])
        self.assertEqual(checkup(uptime_hours=24 * 15)["findings"][0]["level"], "warn")
        self.assertEqual(checkup(uptime_hours=24 * 6)["findings"], [])

    def test_low_battery_only_when_not_charging(self):
        self.assertIn("batería está al 15 por ciento", checkup(battery={"percent": 15, "cargando": False})["spoken"])
        self.assertEqual(checkup(battery={"percent": 15, "cargando": True})["findings"], [])
        self.assertEqual(checkup(battery={"percent": 60, "cargando": False})["findings"], [])

    def test_warnings_go_first_and_it_never_talks_for_long(self):
        out = checkup(ram_percent=92, cpu_percent=95, session_minutes=40, disk_free_gb=5, disk_free_percent=2, uptime_hours=24 * 20, battery={"percent": 10, "cargando": False}, heavy=[{"nombre": "Chrome", "mb": 3000}])
        self.assertTrue(all(f["level"] == "warn" for f in out["findings"][:5]))
        self.assertEqual(out["spoken"].count("Revisé"), 1)
        sentences = [s for s in out["spoken"].split(". ") if s]
        self.assertLessEqual(len(out["spoken"]), 420, out["spoken"])
        self.assertLessEqual(len(sentences), 6)

    def test_missing_measures_do_not_break_it(self):
        out = agent.build_checkup({})
        self.assertEqual(out["spoken"], "Revisé tu equipo y está bien.")


class Processes(unittest.TestCase):
    def test_what_must_never_be_touched_is_protected(self):
        for name in ["svchost.exe", "MsMpEng.exe", "explorer.exe", "csrss.exe", "winlogon.exe", "lsass.exe", "dwm.exe", "System", "Registry",
                     "systemd", "init", "kernel_task", "WindowServer", "python.exe", "pythonw.exe", "eddie_agent.py", "SecurityHealthService.exe", "audiodg.exe"]:
            self.assertTrue(agent.is_protected(name.replace(".py", "")), name)
        for name in ["chrome.exe", "Teams.exe", "Spotify.exe", "Discord.exe", "WINWORD.EXE"]:
            self.assertFalse(agent.is_protected(name), name)

    def test_heavy_apps_group_by_app_skip_the_system_and_the_small(self):
        procs = [("chrome.exe", 800 * MB), ("chrome.exe", 1600 * MB), ("chrome.exe", 5 * MB), ("svchost.exe", 900 * MB), ("MsMpEng.exe", 700 * MB),
                 ("Teams.exe", 350 * MB), ("tiny.exe", 5 * MB), ("python.exe", 800 * MB), ("", 900 * MB)]
        self.assertEqual(agent.heavy_apps(procs=procs), [{"nombre": "Chrome", "mb": 2405}, {"nombre": "Teams", "mb": 350}])
        self.assertEqual(agent.heavy_apps(procs=procs, limit=1), [{"nombre": "Chrome", "mb": 2405}])
        self.assertEqual(agent.heavy_apps(procs=[]), [])

    def test_spoken_sizes(self):
        self.assertEqual(agent.spoken_size(2400), "2 coma 3 gigas")
        self.assertEqual(agent.spoken_size(350), "350 megas")

    def test_browser_running(self):
        self.assertTrue(agent.browser_running(["explorer.exe", "Chrome.exe"]))
        self.assertTrue(agent.browser_running(["msedge.exe"]))
        self.assertTrue(agent.browser_running(["Google Chrome"]))
        self.assertFalse(agent.browser_running(["explorer.exe", "Teams.exe", "chrome_proxy_helper_fake"]))
        self.assertFalse(agent.browser_running([]))


class Voice(unittest.TestCase):
    def test_windows_passes_the_text_in_the_environment_never_in_the_command(self):
        argv, env = agent.speech_command('Hola "Ana"; Remove-Item C:\\ -Recurse', plat="windows")
        self.assertEqual(argv[0], "powershell")
        self.assertNotIn("Remove-Item", " ".join(argv), "the words are data, never part of the script")
        self.assertIn("Remove-Item", env["EDDIE_SAY"])
        self.assertIn("$env:EDDIE_SAY", argv[-1])

    def test_windows_picks_a_spanish_voice_and_can_insist_on_it(self):
        argv, env = agent.speech_command("hola", plat="windows")
        script = argv[-1]
        self.assertIn("Culture.Name -like 'es*'", script)
        self.assertIn("SelectVoice", script)
        self.assertIn("exit 3", script, "no Spanish voice: a code the agent understands")
        self.assertEqual(env["EDDIE_NEED_ES"], "0")
        self.assertEqual(agent.speech_command("hola", plat="windows", require_spanish=True)[1]["EDDIE_NEED_ES"], "1")

    def test_mac_uses_a_spanish_voice(self):
        with mock.patch.object(agent, "mac_spanish_voice", return_value="Monica"):
            self.assertEqual(agent.speech_command("hola   mundo\n", plat="mac")[0], ["say", "-v", "Monica", "hola mundo"])
        with mock.patch.object(agent, "mac_spanish_voice", return_value=None):
            self.assertEqual(agent.speech_command("hola", plat="mac")[0], ["say", "hola"], "best effort for a plain say_text")
            with self.assertRaises(agent.NoSpanishVoice):
                agent.speech_command("hola", plat="mac", require_spanish=True)

    def test_mac_voice_list_is_read(self):
        listing = "Alex                en_US    # Most people recognize me by my voice.\nMonica              es_ES    # Hola, me llamo Mónica.\nPaulina             es_MX    # Hola, me llamo Paulina.\n"
        fake = mock.Mock(return_value=mock.Mock(stdout=listing))
        self.assertEqual(agent.mac_spanish_voice(run=fake), "Monica")
        self.assertIsNone(agent.mac_spanish_voice(run=mock.Mock(return_value=mock.Mock(stdout="Alex  en_US  # hi\n"))))
        self.assertIsNone(agent.mac_spanish_voice(run=mock.Mock(side_effect=OSError("no say"))))

    def test_linux_speaks_spanish(self):
        with mock.patch.object(agent.shutil, "which", side_effect=lambda n: "/usr/bin/" + n if n == "spd-say" else None):
            self.assertEqual(agent.speech_command("hola", plat="linux", wait=True)[0], ["/usr/bin/spd-say", "-l", "es", "-w", "hola"])
            self.assertEqual(agent.speech_command("hola", plat="linux")[0], ["/usr/bin/spd-say", "-l", "es", "hola"])
        with mock.patch.object(agent.shutil, "which", side_effect=lambda n: "/usr/bin/" + n if n == "espeak" else None):
            self.assertEqual(agent.speech_command("hola", plat="linux")[0], ["/usr/bin/espeak", "-v", "es", "hola"])
        with mock.patch.object(agent.shutil, "which", return_value=None):
            with self.assertRaisesRegex(ValueError, "no tiene voz"):
                agent.speech_command("hola", plat="linux")

    def test_no_spanish_voice_on_windows_is_noticed_through_the_exit_code(self):
        proc = mock.Mock(returncode=3)
        with mock.patch.object(agent.subprocess, "Popen", return_value=proc), mock.patch.object(agent, "detect_platform", return_value="windows"):
            with self.assertRaises(agent.NoSpanishVoice):
                agent.speak("hola", wait=True, require_spanish=True)
            agent.speak("hola", wait=True)  # without insisting it is just best effort

    def test_nothing_to_say_is_an_error(self):
        for empty in ["", "   ", None]:
            with self.assertRaises(ValueError):
                agent.speech_command(empty, plat="mac")

    def test_speak_waits_only_when_asked(self):
        proc = mock.Mock()
        with mock.patch.object(agent.subprocess, "Popen", return_value=proc) as popen, mock.patch.object(agent, "detect_platform", return_value="mac"), \
             mock.patch.object(agent, "mac_spanish_voice", return_value=None):
            agent.speak("hola")
            proc.wait.assert_not_called()
            agent.speak("hola", wait=True)
            proc.wait.assert_called_once()
            self.assertEqual(popen.call_args[0][0], ["say", "hola"])

    def test_a_voice_that_hangs_is_cut(self):
        proc = mock.Mock()
        proc.wait.side_effect = agent.subprocess.TimeoutExpired("say", 1)
        with mock.patch.object(agent.subprocess, "Popen", return_value=proc), mock.patch.object(agent, "detect_platform", return_value="mac"):
            agent.speak("hola", wait=True)
        proc.kill.assert_called_once()


class GoodMorning(unittest.TestCase):
    BRIEF = {"pieces": ["Buenos días, Ana.", "Hoy tienes 1 evento: a las 9, clase."], "pages": ["Tu correo"], "launch_browser": True, "checkup": True, "seconds": 8}

    def run_it(self, brief=None, opts=None, running=False, measure=None, start_browser=None, say=None):
        said, started = [], []
        with mock.patch.object(agent, "browser_running", return_value=running):
            done = agent.run_morning(
                {}, "job1", opts,
                ask=lambda: brief or self.BRIEF,
                say=say or said.append,
                start_browser=start_browser or (lambda: started.append(1) or True),
                measure=measure or (lambda: {"spoken": "Revisé tu equipo y está bien."}),
            )
        return done, said, started

    def test_it_says_everything_in_order_and_then_the_checkup(self):
        done, said, started = self.run_it()
        self.assertEqual(said, ["Buenos días, Ana.", "Hoy tienes 1 evento: a las 9, clase.", "Revisé tu equipo y está bien."])
        self.assertEqual(done, {"dicho": 3, "navegador": True, "chequeo": True, "ajuste": "off", "voz": "ok"})
        self.assertEqual(started, [1], "the browser was closed: it is started so the extension can show the pages")

    def test_it_does_not_start_a_browser_that_is_already_open_or_not_needed(self):
        self.assertEqual(self.run_it(running=True)[2], [])
        self.assertEqual(self.run_it(brief={**self.BRIEF, "launch_browser": False})[2], [])

    def test_no_checkup_when_the_routine_or_the_server_says_so(self):
        self.assertEqual(self.run_it(opts={"checkup": False})[1], self.BRIEF["pieces"])
        self.assertEqual(self.run_it(brief={**self.BRIEF, "checkup": False})[1], self.BRIEF["pieces"])

    def test_a_failure_measuring_does_not_spoil_the_greeting(self):
        def boom():
            raise RuntimeError("psutil")
        done, said, _ = self.run_it(measure=boom)
        self.assertEqual(said, self.BRIEF["pieces"])
        self.assertFalse(done["chequeo"])

    def test_a_failure_starting_the_browser_does_not_stop_the_words(self):
        def boom():
            raise OSError("no browser")
        done, said, _ = self.run_it(start_browser=boom)
        self.assertEqual(len(said), 3)
        self.assertFalse(done["navegador"])

    def test_nothing_to_say_is_fine(self):
        done, said, _ = self.run_it(brief={"pieces": [], "checkup": False})
        self.assertEqual((said, done["dicho"]), ([], 0))

    def test_the_tool_needs_its_pass_and_runs_in_the_background_once(self):
        with self.assertRaisesRegex(ValueError, "rutina de encendido"):
            agent.t_morning_brief({}, {})
        calls, gate = [], __import__("threading").Event()

        def slow(cfg, job, opts=None, **_):
            calls.append(job)
            gate.wait(2)
            return {"dicho": 0}

        with mock.patch.object(agent, "run_morning", slow):
            first = agent.t_morning_brief({"_job": "j1"}, {})
            self.assertTrue(first["iniciado"], "answers at once, the speech goes on in the background")
            second = agent.t_morning_brief({"_job": "j2"}, {})
            self.assertEqual(second["summary"], "Ya estoy dándote los buenos días.")
            gate.set()
            for _ in range(100):
                if agent._MORNING_LOCK.acquire(blocking=False):
                    agent._MORNING_LOCK.release()
                    break
                __import__("time").sleep(0.02)
        self.assertEqual(calls, ["j1"])

    def test_the_agent_hands_the_job_id_to_the_morning_tool_only(self):
        seen, queue = [], [{"id": "J9", "tool": "morning_brief", "args": {"routine": "r1"}}, {"id": "J10", "tool": "say_text", "args": {"text": "hola"}}, None]
        with mock.patch.object(agent, "api", side_effect=lambda cfg, path, body=None, **kw: {"job": queue.pop(0)} if path == "agent/next" else {}), \
             mock.patch.object(agent, "run_tool", side_effect=lambda name, args, cfg: seen.append((name, args)) or {}):
            agent.drain({})
        self.assertEqual(seen[0], ("morning_brief", {"routine": "r1", "_job": "J9"}))
        self.assertEqual(seen[1], ("say_text", {"text": "hola"}))


class BrowserAndVoiceInTheMorning(unittest.TestCase):
    BRIEF = {"pieces": ["Buenos días.", "Hoy no tienes nada."], "checkup": False, "launch_browser": True, "browser": "chrome"}

    def go(self, brief=None, say=None, running=False, launch=None):
        said, voice, launched = [], [], []
        agent.run_morning({}, "j1", {}, ask=lambda: brief or self.BRIEF, say=say or said.append,
                          start_browser=launch or (lambda: launched.append(1) or True), is_running=lambda: running, voice_report=voice.append)
        return said, voice, launched

    def test_it_starts_the_browser_that_has_the_extension_when_it_is_closed(self):
        self.assertEqual(self.go()[2], [1])
        self.assertEqual(self.go(running=True)[2], [])

    def test_running_means_that_browser_not_any_browser(self):
        self.assertFalse(agent.browser_running(["msedge.exe", "explorer.exe"], kind="chrome"), "Edge open, the extension lives in Chrome")
        self.assertTrue(agent.browser_running(["chrome.exe"], kind="chrome"))
        self.assertTrue(agent.browser_running(["msedge.exe"], kind="edge"))
        self.assertTrue(agent.browser_running(["msedge.exe"]), "no kind: any browser")
        self.assertFalse(agent.browser_running(["msedge.exe"], kind="brave"))

    def test_launch_browser_runs_the_right_program_not_the_default_one(self):
        popen = mock.Mock()
        found = agent.launch_browser("chrome", finder=lambda name: ["C:/Chrome/chrome.exe"] if name == "chrome" else None, popen=popen)
        self.assertTrue(found)
        self.assertEqual(popen.call_args[0][0], ["C:/Chrome/chrome.exe"])
        with mock.patch.object(agent.webbrowser, "open") as default:
            self.assertFalse(agent.launch_browser("chrome", finder=lambda name: None, popen=popen), "not installed: say so, do not open another browser")
            default.assert_not_called()
            agent.launch_browser(None)
            default.assert_called_once()

    def test_a_browser_that_cannot_be_found_does_not_stop_the_greeting(self):
        said, _, _ = self.go(launch=lambda: False)
        self.assertEqual(said, self.BRIEF["pieces"])

    def test_the_server_note_is_said_once_after_the_words(self):
        said, _, _ = self.go(brief={**self.BRIEF, "note": "Tu extensión es antigua."})
        self.assertEqual(said[-1], "Tu extensión es antigua.")

    def test_without_a_spanish_voice_it_stops_talking_and_reports_in_writing_once(self):
        calls = []

        def say(text):
            calls.append(text)
            raise agent.NoSpanishVoice()

        said, voice, _ = self.go(say=say)
        self.assertEqual(calls, ["Buenos días."], "it does not insist on every sentence")
        self.assertEqual(len(voice), 1)
        self.assertEqual(voice[0]["problem"], "no_spanish_voice")
        self.assertEqual(voice[0]["pieces"], self.BRIEF["pieces"], "the whole greeting goes in writing")

    def test_with_a_voice_nothing_is_reported(self):
        _, voice, _ = self.go()
        self.assertEqual(voice, [])


class Catalog(unittest.TestCase):
    def test_version_and_tool(self):
        major, minor, _ = (int(n) for n in agent.VERSION.split("."))
        self.assertGreaterEqual((major, minor), (1, 13))
        tool = next(t for t in agent.catalog({}) if t["name"] == "morning_brief")
        self.assertEqual(tool["risk"], "confirm", "it is never a plain read: only a routine starts it")
        self.assertLessEqual(len(agent.catalog({})), 24)

    def test_say_text_still_works(self):
        with mock.patch.object(agent, "speak") as speak:
            out = agent.t_say_text({"text": "  Hola   a todos "}, {})
        speak.assert_called_once_with("Hola a todos")
        self.assertEqual(out["dicho"], "Hola a todos")
        with self.assertRaises(ValueError):
            agent.t_say_text({"text": "  "}, {})


if __name__ == "__main__":
    unittest.main(verbosity=1)
