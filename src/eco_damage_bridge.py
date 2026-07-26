# -*- coding: utf-8 -*-
"""JSON-lines bridge between the existing damage meter and Electron."""
import argparse
import atexit
import datetime as dt
import json
import os
import signal
import sys
import threading
import time

import frida

from eco_damage_capture import MAP_PORT
from eco_damage_meter import DamageMeter, WATCH_OPS


for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass


from eco_paths import resolve_dirs, ensure_data_layout, log_dir, resource_path

_RES_DIR, DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(DATA_DIR)
HERE = _RES_DIR
LOGDIR = log_dir(DATA_DIR)


def emit(kind, **payload):
    message = {"type": kind, **payload}
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)


def safe_frida_teardown(script, session, reason="stop"):
    """Detach Interceptors then unload/detach so eco.exe keeps receiving packets.

    Force-killing the Python bridge mid-hook is a common cause of eco.exe crashes
    on Windows (ws2_32 send/recv hooks left in a half-removed state).

    On Windows, Node's child.kill() is an unconditional process kill — so Electron
    must wait for this function to finish and the process to exit on its own.
    """
    # 1) Agent-side: arm=false, drain in-flight callbacks, Interceptor.detachAll().
    if script is not None:
        try:
            exports = getattr(script, "exports_sync", None) or getattr(script, "exports", None)
            if exports is not None and hasattr(exports, "dispose"):
                # dispose() may spin up to ~4s waiting for IN_HOOK == 0
                exports.dispose()
                time.sleep(0.25)
        except Exception:
            pass
        try:
            script.unload()
            time.sleep(0.35)
        except Exception:
            pass
    # 2) Detach session after hooks are gone.
    if session is not None:
        try:
            session.detach()
            time.sleep(0.35)
        except Exception:
            pass
    try:
        emit("status", service="damage", state="stopped", message=f"伤害采集已安全停止（{reason}）")
    except Exception:
        pass


def command_loop(meter, stop_event):
    while not stop_event.is_set():
        line = sys.stdin.readline()
        if not line:
            # Electron closed the pipe — request cooperative stop.
            stop_event.set()
            return
        try:
            command = json.loads(line)
        except Exception:
            continue
        action = command.get("action")
        if action == "reset":
            meter.reset()
            emit("notice", level="success", message="伤害统计已清空")
        elif action == "set-categories":
            meter.set_capture_categories(command.get("categories"))
            emit(
                "notice",
                level="success",
                message="战斗采集项目已更新",
                categories=dict(meter.capture_categories),
            )
        elif action == "reload-custom-buffs":
            durations = command.get("durations")
            loaded = meter.reload_custom_durations(durations)
            emit(
                "notice",
                level="success",
                message=f"已重载自定义 buff 持续时间（{len(loaded)} 条）",
                custom_durations=loaded,
            )
        elif action == "stop":
            stop_event.set()


def main():
    parser = argparse.ArgumentParser(description="ECO damage data bridge")
    parser.add_argument("--pid", type=int, help="要连接的 eco.exe 进程编号")
    parser.add_argument("--self-id", type=lambda value: int(value, 0))
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()

    os.makedirs(LOGDIR, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join(LOGDIR, f"damage_electron_{stamp}.jsonl")

    emit("status", service="damage", state="starting", message="正在查找游戏进程")
    device = frida.get_local_device()
    try:
        from eco_process import resolve_attach_pid

        pid, how = resolve_attach_pid(device, args.pid)
        emit(
            "notice",
            level="info",
            message=f"目标进程 {pid}（{how}）",
        )
    except Exception as exc:
        emit("status", service="damage", state="error", message=str(exc))
        return 2
    meter = DamageMeter(out_path=log_path, self_id=args.self_id, game_chat=False)
    source = open(os.path.join(HERE, "_damage_capture.js"), encoding="utf-8").read()
    source = source.replace("__MAP_PORT__", str(MAP_PORT))
    source = source.replace("__WATCH_ALL__", "false")
    source = source.replace("__WATCH_OPS__", json.dumps(WATCH_OPS))

    session = None
    script = None
    stop_event = threading.Event()
    cleaned = {"done": False}
    refs = {"script": None, "session": None}

    def cleanup(reason="stop"):
        if cleaned["done"]:
            stop_event.set()
            return
        cleaned["done"] = True
        stop_event.set()
        safe_frida_teardown(refs.get("script"), refs.get("session"), reason=reason)
        refs["script"] = None
        refs["session"] = None
        try:
            meter.close()
        except Exception:
            pass

    def _on_signal(signum, _frame):
        cleanup(f"signal-{signum}")

    try:
        signal.signal(signal.SIGINT, _on_signal)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _on_signal)
        if hasattr(signal, "SIGBREAK"):
            # Windows console Ctrl+Break / some terminate paths.
            signal.signal(signal.SIGBREAK, _on_signal)
    except Exception:
        pass
    atexit.register(lambda: cleanup("atexit") if not cleaned["done"] else None)

    try:
        session = device.attach(pid)
        script = session.create_script(source)
        script.on("message", meter.on_message)
        meter.set_script(script)
        script.load()
        refs["script"] = script
        refs["session"] = session
        emit(
            "status",
            service="damage",
            state="running",
            pid=pid,
            log=log_path,
            message=f"已连接游戏进程 {pid}",
        )

        reader = threading.Thread(target=command_loop, args=(meter, stop_event), daemon=True)
        reader.start()
        # Keep history modest — UI shows recent rows; full dumps bloat IPC.
        history_limit = max(20, min(200, int(os.environ.get("ECO_SNAPSHOT_HISTORY", "80"))))
        while not stop_event.wait(max(0.1, args.interval)):
            snapshot = meter.snapshot(history_limit=history_limit)
            emit("snapshot", data=snapshot)
    except KeyboardInterrupt:
        cleanup("keyboard-interrupt")
    except Exception as exc:
        raw = str(exc)
        low = raw.lower()
        if "access" in low or "denied" in low or "权限" in raw:
            code = "ECO_E03"
            text = f"连接进程 {pid} 失败：{exc}。请尝试以管理员身份运行 ECO 工具箱。"
        elif "不存在" in raw or "not found" in low or "exited" in low:
            code = "ECO_E02"
            text = f"连接进程 {pid} 失败：{exc}"
        else:
            code = "ECO_E04"
            text = f"连接进程 {pid} 失败：{exc}"
        emit(
            "status",
            service="damage",
            state="error",
            message=f"[{code}] {text}",
            error_code=code,
        )
        cleanup("error")
        return 1
    finally:
        cleanup("finally")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
