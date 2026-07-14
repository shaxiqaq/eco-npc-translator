# -*- coding: utf-8 -*-
"""JSON-lines bridge between the existing damage meter and Electron."""
import argparse
import datetime as dt
import json
import os
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


HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("ECO_DATA_DIR") or HERE
LOGDIR = os.path.join(DATA_DIR, "logs")


def emit(kind, **payload):
    message = {"type": kind, **payload}
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)


def command_loop(meter, stop_event):
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
        if action == "reset":
            meter.reset()
            emit("notice", level="success", message="伤害统计已清空")
        elif action == "stop":
            stop_event.set()


def main():
    parser = argparse.ArgumentParser(description="ECO damage data bridge")
    parser.add_argument("--self-id", type=lambda value: int(value, 0))
    parser.add_argument("--interval", type=float, default=0.25)
    args = parser.parse_args()

    os.makedirs(LOGDIR, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join(LOGDIR, f"damage_electron_{stamp}.jsonl")

    emit("status", service="damage", state="starting", message="正在查找游戏进程")
    device = frida.get_local_device()
    games = [process for process in device.enumerate_processes() if process.name.lower() == "eco.exe"]
    if not games:
        emit("status", service="damage", state="error", message="没有找到 eco.exe，请先进入游戏")
        return 2

    pid = max(games, key=lambda process: process.pid).pid
    meter = DamageMeter(out_path=log_path, self_id=args.self_id, game_chat=False)
    meter.event_sink = lambda event: emit("damage-event", event=event)

    source = open(os.path.join(HERE, "_damage_capture.js"), encoding="utf-8").read()
    source = source.replace("__MAP_PORT__", str(MAP_PORT))
    source = source.replace("__WATCH_ALL__", "false")
    source = source.replace("__WATCH_OPS__", json.dumps(WATCH_OPS))

    session = None
    stop_event = threading.Event()
    try:
        session = device.attach(pid)
        script = session.create_script(source)
        script.on("message", meter.on_message)
        meter.set_script(script)
        script.load()
        emit(
            "status",
            service="damage",
            state="running",
            pid=pid,
            log=log_path,
            message=f"已连接 eco.exe（进程 {pid}）",
        )

        reader = threading.Thread(target=command_loop, args=(meter, stop_event), daemon=True)
        reader.start()
        while not stop_event.wait(max(0.1, args.interval)):
            snapshot = meter.snapshot()
            snapshot["damage_history"] = snapshot.get("damage_history", [])[-500:]
            emit("snapshot", data=snapshot)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        emit("status", service="damage", state="error", message=str(exc))
        return 1
    finally:
        stop_event.set()
        meter.close()
        if session is not None:
            try:
                session.detach()
            except Exception:
                pass
        emit("status", service="damage", state="stopped", message="伤害采集已停止")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
