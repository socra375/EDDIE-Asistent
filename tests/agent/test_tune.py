"""Optimizar el equipo SIN romper nada. Estas pruebas son el «entrenamiento»: casos peligrosos que el agente nunca debe tocar,
la comprobación de último momento, que jamás se cierre un proceso y que el ensayo no haga nada. Lo corre tests/tune.test.mjs."""
import importlib.util
import inspect
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

FG = 4242
OLD = 3600  # segundos de antigüedad: lleva rato abierta


def proc(pid, name, cpu=0.0, mb=50, age=OLD, mine=True, low=False, ct=1000.0):
    return {"pid": pid, "name": name, "cpu": cpu, "rss_mb": mb, "age_s": age, "mine": mine, "low": low, "create_time": ct}


def plan(procs, fg=FG, own=(1, 2), windows=True):
    return agent.plan_tuning(procs, fg, own, windows)


class Plan(unittest.TestCase):
    def test_a_busy_background_app_gets_a_lower_priority(self):
        out = plan([proc(10, "Updater.exe", cpu=60)])
        self.assertEqual([(i["kind"], i["name"]) for i in out], [("lower_priority", "Updater")])
        self.assertIn("60 por ciento del procesador", out[0]["detail"])

    def test_an_idle_heavy_app_gets_its_memory_released(self):
        out = plan([proc(11, "Photoshop.exe", cpu=0.2, mb=900)])
        self.assertEqual([(i["kind"], i["name"]) for i in out], [("trim_memory", "Photoshop")])
        self.assertIn("parada", out[0]["detail"])

    def test_the_system_the_antivirus_and_the_desktop_are_never_touched(self):
        for name in ["svchost.exe", "MsMpEng.exe", "explorer.exe", "csrss.exe", "lsass.exe", "dwm.exe", "winlogon.exe", "System", "Registry",
                     "SecurityHealthService.exe", "audiodg.exe", "WindowServer", "systemd", "kernel_task"]:
            self.assertEqual(plan([proc(20, name, cpu=90, mb=2000)]), [], name)
            self.assertEqual(plan([proc(21, name, cpu=0, mb=2000)]), [], name)

    def test_browsers_calls_recording_vpn_and_remote_control_are_left_alone(self):
        for name in ["chrome.exe", "msedge.exe", "firefox.exe", "Zoom.exe", "Teams.exe", "Discord.exe", "obs64.exe", "Spotify.exe",
                     "AnyDesk.exe", "TeamViewer.exe", "openvpn.exe", "WireGuard.exe", "KeePassXC.exe", "OneDrive.exe"]:
            self.assertEqual(plan([proc(30, name, cpu=80, mb=1500)]), [], name)

    def test_the_app_in_front_and_the_agent_itself_are_never_touched(self):
        self.assertEqual(plan([proc(FG, "Excel.exe", cpu=90, mb=900)]), [], "the window the user is using")
        self.assertEqual(plan([proc(1, "pythonw.exe", cpu=90)], own=(1, 2)), [])
        self.assertEqual(plan([proc(2, "Whatever.exe", cpu=90)], own=(1, 2)), [], "its parent")
        self.assertEqual(plan([proc(40, "eddie_agent.py", cpu=90)]), [])
        self.assertEqual(plan([proc(41, "python3.11", cpu=90, mb=900)]), [], "any python: could be the user's own script")

    def test_other_users_processes_and_just_started_ones_are_skipped(self):
        self.assertEqual(plan([proc(50, "Other.exe", cpu=90, mine=False)]), [])
        self.assertEqual(plan([proc(51, "Starting.exe", cpu=90, age=10)]), [], "still launching")
        self.assertEqual(len(plan([proc(52, "Settled.exe", cpu=90, age=31)])), 1)

    def test_nothing_is_touched_when_the_foreground_is_unknown_or_the_system_is_not_windows(self):
        busy = [proc(60, "Updater.exe", cpu=90)]
        self.assertEqual(plan(busy, fg=None), [], "no idea which window is in front → no idea what is safe")
        self.assertEqual(plan(busy, windows=False), [])

    def test_already_low_small_or_moderate_are_not_candidates(self):
        self.assertEqual(plan([proc(70, "Calm.exe", cpu=90, low=True)]), [], "already lowered")
        self.assertEqual(plan([proc(71, "Small.exe", cpu=0, mb=80)]), [], "too little memory to bother")
        self.assertEqual(plan([proc(72, "Middle.exe", cpu=10, mb=900)]), [], "working a little: neither busy nor idle")

    def test_at_most_six_and_the_biggest_first(self):
        many = [proc(100 + i, f"App{i}.exe", cpu=30 + i) for i in range(10)]
        out = plan(many)
        self.assertEqual(len(out), agent.TUNE_MAX_ACTIONS)
        self.assertEqual(out[0]["name"], "App9", "the one that costs the most goes first")

    def test_no_processes_no_plan(self):
        self.assertEqual(plan([]), [])


class FakeProc:
    """Un proceso falso que EXPLOTA si alguien intenta cerrarlo."""

    def __init__(self, pid, name, ct=1000.0, mine=True, nice=32):
        self.pid, self._name, self._ct, self._mine, self._nice = pid, name, ct, mine, nice
        self.set_to = None

    def name(self):
        return self._name

    def create_time(self):
        return self._ct

    def nice(self, value=None):
        if value is None:
            return self._nice
        self.set_to = value

    def terminate(self):
        raise AssertionError("nunca se cierra un proceso")

    def kill(self):
        raise AssertionError("nunca se mata un proceso")

    def suspend(self):
        raise AssertionError("nunca se suspende un proceso")


class Apply(unittest.TestCase):
    def run_plan(self, items, procs, fg=FG, saved=None, trim=None):
        store = {"v": saved or {}}
        with mock.patch.object(agent, "_is_mine", side_effect=lambda p: p._mine):
            out = agent.apply_tuning(items, lookup=lambda pid: procs[pid], fg=lambda: fg, trim=trim or mock.Mock(),
                                     state_io=(lambda: store["v"], lambda s: store.update(v=s)))
        return out, store["v"]

    def item(self, pid=10, name="Updater", kind="lower_priority", ct=1000.0):
        return {"pid": pid, "name": name, "kind": kind, "create_time": ct, "detail": "x"}

    def test_it_lowers_the_priority_and_remembers_what_it_was(self):
        p = FakeProc(10, "Updater.exe", nice=32)
        out, state = self.run_plan([self.item()], {10: p})
        self.assertEqual(len(out["hecho"]), 1)
        self.assertEqual(state["priorities"], [{"pid": 10, "create_time": 1000.0, "name": "Updater", "before": 32}])
        self.assertIsNotNone(p.set_to)

    def test_it_releases_memory_through_the_trim_door_only(self):
        trim = mock.Mock()
        out, _ = self.run_plan([self.item(11, "Photoshop", "trim_memory")], {11: FakeProc(11, "Photoshop.exe")}, trim=trim)
        trim.assert_called_once_with(11)
        self.assertEqual(len(out["hecho"]), 1)

    def test_a_process_that_changed_since_the_plan_is_skipped(self):
        # the pid now belongs to another program (the old one closed and the number was reused)
        out, _ = self.run_plan([self.item()], {10: FakeProc(10, "Notepad.exe")})
        self.assertEqual((out["hecho"], len(out["omitido"])), ([], 1))
        out, _ = self.run_plan([self.item()], {10: FakeProc(10, "Updater.exe", ct=5000.0)})
        self.assertEqual(out["hecho"], [], "same name but started later: another process")

    def test_the_app_the_user_just_switched_to_is_not_touched(self):
        p = FakeProc(10, "Updater.exe")
        out, _ = self.run_plan([self.item()], {10: p}, fg=10)
        self.assertEqual((out["hecho"], p.set_to), ([], None))

    def test_unknown_foreground_touches_nothing(self):
        p = FakeProc(10, "Updater.exe")
        out, _ = self.run_plan([self.item()], {10: p}, fg=None)
        self.assertEqual((out["hecho"], p.set_to), ([], None))

    def test_a_protected_or_foreign_process_that_slipped_into_a_plan_is_refused(self):
        for name, mine in [("svchost.exe", True), ("MsMpEng.exe", True), ("chrome.exe", True), ("Updater.exe", False)]:
            p = FakeProc(10, name, mine=mine)
            out, _ = self.run_plan([self.item(10, agent.friendly_name(name))], {10: p})
            self.assertEqual((out["hecho"], p.set_to), ([], None), name)

    def test_a_failing_process_does_not_stop_the_others(self):
        class Denied(FakeProc):
            def nice(self, value=None):
                if value is None:
                    return 32
                raise PermissionError("acceso denegado")
        good = FakeProc(12, "Good.exe")
        out, _ = self.run_plan([self.item(10), self.item(12, "Good")], {10: Denied(10, "Updater.exe"), 12: good})
        self.assertEqual([i["name"] for i in out["hecho"]], ["Good"])
        self.assertEqual(len(out["omitido"]), 1)

    def test_a_vanished_process_is_just_skipped(self):
        def gone(pid):
            raise ProcessLookupError("no existe")
        with mock.patch.object(agent, "_is_mine", return_value=True):
            out = agent.apply_tuning([self.item()], lookup=gone, fg=lambda: FG, trim=mock.Mock(), state_io=(lambda: {}, lambda s: None))
        self.assertEqual((out["hecho"], len(out["omitido"])), ([], 1))

    def test_never_more_than_six_even_if_asked(self):
        procs = {100 + i: FakeProc(100 + i, f"App{i}.exe") for i in range(10)}
        out, _ = self.run_plan([self.item(100 + i, f"App{i}") for i in range(10)], procs)
        self.assertEqual(len(out["hecho"]), agent.TUNE_MAX_ACTIONS)


class Undo(unittest.TestCase):
    def test_only_the_same_process_gets_its_priority_back(self):
        same, reused = FakeProc(10, "Updater.exe", ct=1000.0), FakeProc(11, "Other.exe", ct=9999.0)
        saved = {"priorities": [{"pid": 10, "create_time": 1000.0, "name": "Updater", "before": 32}, {"pid": 11, "create_time": 1000.0, "name": "Old", "before": 32}, {"pid": 12, "create_time": 1.0, "name": "Gone", "before": 32}]}
        store = {"v": saved}
        out = agent.undo_tuning(lookup=lambda pid: {10: same, 11: reused}[pid], state_io=(lambda: store["v"], lambda s: store.update(v=s)))
        self.assertEqual(out["restauradas"], ["Updater"])
        self.assertEqual(sorted(out["ya_no_estaban"]), ["Gone", "Old"])
        self.assertEqual((same.set_to, reused.set_to), (32, None))
        self.assertEqual(store["v"]["priorities"], [])


class Safety(unittest.TestCase):
    def test_no_tuning_code_can_close_or_delete_anything(self):
        for fn in [agent.plan_tuning, agent.apply_tuning, agent.undo_tuning, agent.run_tuning, agent.collect_processes, agent.t_pc_tune_plan,
                   agent.t_pc_tune_run, agent.t_pc_tune_undo, agent._win_trim, agent.describe_plan]:
            code = inspect.getsource(fn)
            for banned in [".terminate(", ".kill(", ".suspend(", "os.remove", "os.unlink", "shutil.rmtree", "send_signal", "os.kill", "taskkill"]:
                self.assertNotIn(banned, code, f"{fn.__name__} uses {banned}")

    def test_tools_are_declared_with_the_right_risk(self):
        tools = {t["name"]: t for t in agent.catalog({})}
        self.assertEqual(tools["pc_tune_plan"]["risk"], "read")
        self.assertEqual(tools["pc_tune_run"]["risk"], "confirm", "changing anything always asks")
        self.assertEqual(tools["pc_tune_undo"]["risk"], "confirm")
        self.assertLessEqual(len(tools), 24)

    def test_the_plan_tool_changes_nothing(self):
        with mock.patch.object(agent, "collect_processes", return_value=[proc(10, "Updater.exe", cpu=90)]), \
             mock.patch.object(agent, "foreground_pid", return_value=FG), mock.patch.object(agent, "IS_WINDOWS", True), \
             mock.patch.object(agent, "apply_tuning", side_effect=AssertionError("no debe aplicar")):
            out = agent.t_pc_tune_plan({}, {})
        self.assertEqual(out["plan"][0]["name"], "Updater")

    def test_the_spoken_lines_say_what_happened_honestly(self):
        item = {"kind": "lower_priority", "name": "Updater", "detail": "usa el 60 por ciento del procesador sin que la estés usando"}
        self.assertEqual(agent.describe_plan([item])["spoken"], "En ensayo: podría ajustar Updater. No he tocado nada.")
        self.assertEqual(agent.describe_plan([item], applied=True)["spoken"], "Optimicé el equipo en segundo plano: ajusté Updater. No cerré nada.")
        self.assertEqual(agent.describe_plan([]), {"spoken": "", "lines": []})
        self.assertTrue(agent.describe_plan([item])["lines"][0].startswith("Bajaría la prioridad de Updater"))
        self.assertTrue(agent.describe_plan([item], applied=True)["lines"][0].startswith("Bajé la prioridad de Updater"))


class InTheMorning(unittest.TestCase):
    BRIEF = {"pieces": ["Buenos días."], "checkup": False, "launch_browser": False}
    RESULT = {"plan": [{"kind": "lower_priority", "name": "Updater", "detail": "d", "pid": 1, "create_time": 1}], "applied": [], "skipped": []}

    def go(self, tune, tuner=None, report=None, result=None):
        said, reports = [], []
        tuned = []

        def fake_tuner(mode):
            tuned.append(mode)
            return result or {**self.RESULT, "mode": mode, "applied": self.RESULT["plan"] if mode == "activo" else []}

        done = agent.run_morning({}, "j1", {}, ask=lambda: {**self.BRIEF, "tune": tune}, say=said.append, start_browser=lambda: None,
                                 tuner=tuner or fake_tuner, report=report or reports.append)
        return done, said, reports, tuned

    def test_off_does_not_even_look(self):
        done, said, reports, tuned = self.go("off")
        self.assertEqual((tuned, reports, said), ([], [], ["Buenos días."]))
        self.assertEqual(done["ajuste"], "off")

    def test_an_unknown_mode_counts_as_off(self):
        for bad in [None, "", "yes", "ACTIVO", "activar"]:
            self.assertEqual(self.go(bad)[3], [], str(bad))

    def test_rehearsal_says_what_it_would_do_and_reports_it(self):
        done, said, reports, tuned = self.go("ensayo")
        self.assertEqual(tuned, ["ensayo"])
        self.assertEqual(said[-1], "En ensayo: podría ajustar Updater. No he tocado nada.")
        self.assertEqual(reports[0]["mode"], "ensayo")
        self.assertEqual(reports[0]["applied"], [])
        self.assertEqual(reports[0]["plan"], [{"kind": "lower_priority", "name": "Updater", "detail": "d"}])
        self.assertEqual(done["ajuste"], "ensayo")

    def test_active_says_what_it_did(self):
        _, said, reports, _ = self.go("activo")
        self.assertEqual(said[-1], "Optimicé el equipo en segundo plano: ajusté Updater. No cerré nada.")
        self.assertEqual(reports[0]["applied"][0]["name"], "Updater")

    def test_the_real_tuner_in_rehearsal_never_applies(self):
        with mock.patch.object(agent, "collect_processes", return_value=[proc(10, "Updater.exe", cpu=90)]), \
             mock.patch.object(agent, "foreground_pid", return_value=FG), mock.patch.object(agent, "IS_WINDOWS", True), \
             mock.patch.object(agent, "apply_tuning", side_effect=AssertionError("el ensayo no aplica nada")):
            result = agent.run_tuning("ensayo")
        self.assertEqual((len(result["plan"]), result["applied"]), (1, []))

    def test_nothing_to_adjust_says_nothing(self):
        _, said, reports, _ = self.go("ensayo", result={"plan": [], "applied": [], "skipped": []})
        self.assertEqual(said, ["Buenos días."])
        self.assertEqual(len(reports), 1, "it still reports: an empty rehearsal counts as one")

    def test_a_tuning_failure_never_spoils_the_greeting(self):
        def boom(mode):
            raise RuntimeError("psutil")
        done, said, reports, _ = self.go("activo", tuner=boom)
        self.assertEqual(said, ["Buenos días."])
        self.assertEqual((reports, done["ajuste"]), ([], "off"))

    def test_a_failing_report_does_not_matter(self):
        def no_net(payload):
            raise OSError("sin red")
        done, said, _, _ = self.go("ensayo", report=no_net)
        self.assertEqual(said[-1], "En ensayo: podría ajustar Updater. No he tocado nada.")


if __name__ == "__main__":
    unittest.main(verbosity=1)
