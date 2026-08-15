# -*- coding: utf-8 -*-
"""One Frida session for damage capture and/or NPC translation.

Electron can still spawn the two legacy backends; this agent is the
unified attach path: one device.attach(pid), then optional scripts.
Turning translation off must pause mitm only — never detach the session.
"""
from __future__ import annotations

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

from eco_paths import resolve_dirs, ensure_data_layout, log_dir

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass

_RES_DIR, DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(DATA_DIR)
HERE = _RES_DIR
LOGDIR = log_dir(DATA_DIR)


def emit(kind, **payload):
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False, separators=(",", ":")), flush=True)


def dispose_script(script, unload=True):
    """Drain hooks, then unload only if idle. Never force-unload mid-recvfrom."""
    if script is None:
        return True
    drained = True
    try:
        exports = getattr(script, "exports_sync", None) or getattr(script, "exports", None)
        if exports is not None and hasattr(exports, "dispose"):
            info = exports.dispose()
            if isinstance(info, dict):
                drained = bool(info.get("drained", True))
            time.sleep(0.35 if drained else 0.8)
    except Exception:
        pass
    if unload and drained:
        try:
            script.unload()
            time.sleep(0.3)
        except Exception:
            pass
    return drained


def _script_exports(script):
    if script is None:
        return None
    return getattr(script, "exports_sync", None) or getattr(script, "exports", None)


def main(argv=None):
    parser = argparse.ArgumentParser(description="ECO unified Frida agent")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--damage", action="store_true", help="Load combat capture")
    parser.add_argument("--translate", action="store_true", help="Load NPC mitm")
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--self-id", type=lambda value: int(value, 0))
    args = parser.parse_args(argv)
    if not args.damage and not args.translate:
        args.damage = True

    from eco_process import resolve_attach_pid

    emit("status", service="agent", state="starting", message="正在查找游戏进程")
    device = frida.get_local_device()
    try:
        pid, how = resolve_attach_pid(device, args.pid)
    except Exception as exc:
        emit("status", service="agent", state="error", message=str(exc))
        return 2

    emit("notice", level="info", message=f"统一挂接 {pid}（{how}） damage={args.damage} translate={args.translate}")

    session = None
    scripts = []
    meter = None
    stop_event = threading.Event()
    cleaned = {"done": False}
    tr = {"script": None, "helpers": False, "lock": threading.Lock()}

    def cleanup(reason="stop"):
        if cleaned["done"]:
            stop_event.set()
            return
        cleaned["done"] = True
        stop_event.set()
        for script in list(scripts):
            dispose_script(script)
        scripts.clear()
        tr["script"] = None
        if session is not None:
            try:
                session.detach()
                time.sleep(0.3)
            except Exception:
                pass
        if meter is not None:
            try:
                meter.close()
            except Exception:
                pass
        emit("status", service="agent", state="stopped", message=f"采集代理已停止（{reason}）")

    def _on_signal(signum, _frame):
        cleanup(f"signal-{signum}")

    try:
        signal.signal(signal.SIGINT, _on_signal)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _on_signal)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, _on_signal)
    except Exception:
        pass
    atexit.register(lambda: cleanup("atexit") if not cleaned["done"] else None)

    session = device.attach(pid)
    history_limit = 80

    def start_translate_helpers(mitm):
        if tr["helpers"]:
            return
        tr["helpers"] = True
        threading.Thread(target=mitm.warmup, daemon=True).start()
        threading.Thread(target=mitm._harvest_worker, daemon=True).start()
        if mitm.SYNC:
            mitm.SYNC.start()
            mitm.SYNC.push_all(mitm.CACHE)
        try:
            mitm.setup_hotkey()
        except Exception:
            pass

    def resume_translate(mitm):
        script = tr["script"]
        exports = _script_exports(script)
        if exports is not None and hasattr(exports, "resume"):
            exports.resume()
            emit(
                "status",
                service="translator",
                state="running",
                pid=pid,
                message=f"NPC 翻译正在运行（进程 {pid}）",
            )
            return True
        return False

    def load_translate():
        import eco_npc_mitm as mitm

        if not mitm.PROVIDER:
            emit(
                "status",
                service="translator",
                state="error",
                error_kind="translator-config",
                message="请先完成翻译设置",
            )
            return False
        with tr["lock"]:
            if tr["script"] is not None:
                if resume_translate(mitm):
                    return True
                old = tr["script"]
                if old in scripts:
                    scripts.remove(old)
                dispose_script(old)
                tr["script"] = None
                mitm.sref["s"] = None
            leftover = mitm.sref.get("s")
            if leftover is not None:
                emit("notice", level="warn", message="卸掉残留 mitm 脚本后再挂，避免双重挂钩")
                dispose_script(leftover)
                if leftover in scripts:
                    scripts.remove(leftover)
                mitm.sref["s"] = None
            tr_script = session.create_script(mitm.JS)
            tr_script.on("message", mitm.handler)
            tr_script.load()
            mitm.sref["s"] = tr_script
            mitm.sref["session"] = session
            tr["script"] = tr_script
            scripts.append(tr_script)
            start_translate_helpers(mitm)
        emit(
            "status",
            service="translator",
            state="running",
            pid=pid,
            message=f"NPC 翻译正在运行（进程 {pid}）",
        )
        return True

    def pause_translate():
        import eco_npc_mitm as mitm

        with tr["lock"]:
            script = tr["script"]
            if script is None:
                emit("status", service="translator", state="stopped", message="已停止")
                return True
            try:
                exports = _script_exports(script)
                if exports is not None and hasattr(exports, "pause"):
                    exports.pause()
                else:
                    dispose_script(script, unload=False)
            except Exception as exc:
                emit("notice", service="translator", level="warn", message=f"暂停翻译失败：{exc}")
            mitm.sref["s"] = script
        emit("notice", level="info", message="已关闭 NPC 改包（采集会话保持）")
        emit("status", service="translator", state="stopped", message="已停止")
        return True

    def apply_translate(enabled):
        if enabled:
            return load_translate()
        return pause_translate()

    def warmup_translate():
        try:
            import eco_npc_mitm as mitm
            threading.Thread(target=mitm.warmup, daemon=True).start()
            emit("notice", service="translator", level="info", message="已请求预热翻译引擎")
        except Exception as exc:
            emit("notice", service="translator", level="warn", message=f"预热失败：{exc}")

    if args.damage:
        from eco_damage_bridge import apply_command, push_snapshot
        from eco_damage_capture import MAP_PORT
        from eco_damage_meter import DamageMeter, WATCH_OPS

        os.makedirs(LOGDIR, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        log_path = os.path.join(LOGDIR, f"damage_electron_{stamp}.jsonl")
        meter = DamageMeter(out_path=log_path, self_id=args.self_id, game_chat=False)
        source = open(os.path.join(HERE, "_damage_capture.js"), encoding="utf-8").read()
        source = source.replace("__MAP_PORT__", str(MAP_PORT))
        source = source.replace("__WATCH_ALL__", "false")
        source = source.replace("__WATCH_OPS__", json.dumps(WATCH_OPS))
        script = session.create_script(source)
        script.on("message", meter.on_message)
        meter.set_script(script)
        script.load()
        scripts.append(script)
        emit("status", service="damage", state="running", pid=pid, log=log_path, message=f"已连接游戏进程 {pid}")
        history_limit = max(20, min(200, int(os.environ.get("ECO_SNAPSHOT_HISTORY", "80"))))
    else:
        apply_command = None
        push_snapshot = None

    if args.translate:
        load_translate()

    def command_reader():
        while not stop_event.is_set():
            line = sys.stdin.readline()
            if not line:
                stop_event.set()
                return
            try:
                command = json.loads(line)
            except Exception:
                continue
            action = command.get("action")
            if action == "stop":
                stop_event.set()
            elif action == "set-translate":
                apply_translate(bool(command.get("enabled")))
            elif action == "warmup":
                warmup_translate()
            elif meter is not None and apply_command is not None:
                apply_command(meter, command, history_limit)

    threading.Thread(target=command_reader, daemon=True).start()

    emit("status", service="agent", state="running", pid=pid, message="统一采集代理已运行")

    try:
        while not stop_event.wait(max(0.1, args.interval)):
            if meter is not None and push_snapshot is not None:
                push_snapshot(meter, history_limit)
    except KeyboardInterrupt:
        cleanup("keyboard-interrupt")
        return 0
    cleanup("loop-exit")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
