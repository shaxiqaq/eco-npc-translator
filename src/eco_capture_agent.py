# -*- coding: utf-8 -*-
"""One Frida session for damage capture and/or NPC translation.

Electron can still spawn the two legacy backends; this agent is the
unified attach path: one device.attach(pid), then optional scripts.
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


def dispose_script(script):
    if script is None:
        return
    try:
        exports = getattr(script, "exports_sync", None) or getattr(script, "exports", None)
        if exports is not None and hasattr(exports, "dispose"):
            exports.dispose()
            time.sleep(0.25)
    except Exception:
        pass
    try:
        script.unload()
        time.sleep(0.3)
    except Exception:
        pass


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

    def cleanup(reason="stop"):
        if cleaned["done"]:
            stop_event.set()
            return
        cleaned["done"] = True
        stop_event.set()
        for script in scripts:
            dispose_script(script)
        scripts.clear()
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

    if args.damage:
        from eco_damage_bridge import command_loop, push_snapshot
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
        threading.Thread(
            target=command_loop, args=(meter, stop_event, history_limit), daemon=True
        ).start()
    else:
        history_limit = 80

        def _control_loop():
            while not stop_event.is_set():
                line = sys.stdin.readline()
                if not line:
                    stop_event.set()
                    return
                try:
                    command = json.loads(line)
                except Exception:
                    continue
                if command.get("action") == "warmup":
                    try:
                        import eco_npc_mitm as mitm
                        threading.Thread(target=mitm.warmup, daemon=True).start()
                        emit("notice", service="translator", level="info", message="已请求预热翻译引擎")
                    except Exception as exc:
                        emit("notice", service="translator", level="warn", message=f"预热失败：{exc}")
                elif command.get("action") == "stop":
                    stop_event.set()

        threading.Thread(target=_control_loop, daemon=True).start()

    if args.translate:
        import eco_npc_mitm as mitm

        if not mitm.PROVIDER:
            emit(
                "status",
                service="translator",
                state="error",
                error_kind="translator-config",
                message="请先完成翻译设置",
            )
        else:
            tr_script = session.create_script(mitm.JS)
            tr_script.on("message", mitm.handler)
            tr_script.load()
            mitm.sref["s"] = tr_script
            mitm.sref["session"] = session
            scripts.append(tr_script)
            threading.Thread(target=mitm.warmup, daemon=True).start()
            threading.Thread(target=mitm._harvest_worker, daemon=True).start()
            if mitm.SYNC:
                mitm.SYNC.start()
                mitm.SYNC.push_all(mitm.CACHE)
            try:
                mitm.setup_hotkey()
            except Exception:
                pass
            emit(
                "status",
                service="translator",
                state="running",
                pid=pid,
                message=f"NPC 翻译正在运行（进程 {pid}）",
            )

    emit("status", service="agent", state="running", pid=pid, message="统一采集代理已运行")

    try:
        while not stop_event.wait(max(0.1, args.interval)):
            if meter is not None:
                from eco_damage_bridge import push_snapshot

                push_snapshot(meter, history_limit)
    except KeyboardInterrupt:
        cleanup("keyboard-interrupt")
        return 0
    cleanup("loop-exit")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
