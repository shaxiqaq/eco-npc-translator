# -*- coding: utf-8 -*-
"""
透明、鼠标穿透的伤害统计悬浮窗。
"""
import argparse
import ctypes
from ctypes import wintypes
import datetime as _dt
import json
import os
import sys
import threading
import time
import tkinter as tk
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frida

from eco_damage_capture import MAP_PORT
from eco_damage_meter import DamageMeter, WATCH_OPS, fmt_time, render

HERE = os.path.dirname(os.path.abspath(__file__))
LOGDIR = os.path.join(HERE, "logs")
CONFIG_PATH = os.path.join(HERE, "damage_overlay_config.json")
TRANSPARENT = "#010203"


user32 = ctypes.windll.user32 if os.name == "nt" else None
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
LWA_COLORKEY = 0x00000001
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020

if user32:
    user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongW.restype = ctypes.c_long
    user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
    user32.SetWindowLongW.restype = ctypes.c_long
    user32.SetLayeredWindowAttributes.argtypes = [
        wintypes.HWND, wintypes.COLORREF, ctypes.c_byte, ctypes.c_ulong
    ]
    user32.SetLayeredWindowAttributes.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, ctypes.c_uint
    ]
    user32.SetWindowPos.restype = wintypes.BOOL


def find_window_for_pid(pid):
    if not user32:
        return None
    result = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        proc_id = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc_id))
        if proc_id.value == pid:
            title_len = user32.GetWindowTextLengthW(hwnd)
            if title_len > 0:
                result.append(hwnd)
                return False
        return True

    user32.EnumWindows(enum_proc, 0)
    return result[0] if result else None


def get_window_rect(hwnd):
    if not user32 or not hwnd:
        return None
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return rect.left, rect.top, rect.right, rect.bottom


def make_hwnd_clickthrough(hwnd, layered=False):
    if not user32:
        return
    exstyle = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    exstyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW
    if layered:
        exstyle |= WS_EX_LAYERED
    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, exstyle)
    if layered:
        user32.SetLayeredWindowAttributes(hwnd, 0x00030201, 0, LWA_COLORKEY)
    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)


def iter_widgets(widget):
    yield widget
    for child in widget.winfo_children():
        yield from iter_widgets(child)


def make_clickthrough(root):
    if not user32:
        return
    try:
        root.attributes("-disabled", True)
    except tk.TclError:
        pass
    for widget in iter_widgets(root):
        try:
            make_hwnd_clickthrough(widget.winfo_id(), layered=(widget is root))
        except Exception:
            pass


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_config(data):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def console_loop(meter, stop_event):
    while not stop_event.is_set():
        render(meter)
        stop_event.wait(1.0)


class Overlay:
    def __init__(self, meter, pid, anchor="top-right", x=None, y=None, follow=None):
        self.meter = meter
        self.pid = pid
        self.anchor = anchor
        self.fixed_x = x
        self.fixed_y = y
        self.follow = follow if follow is not None else (x is None or y is None)
        self.events = deque(maxlen=8)
        self.events_lock = threading.Lock()
        self.hwnd = find_window_for_pid(pid)

        self.root = tk.Tk()
        self.root.title("技能伤害明细悬浮窗")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.configure(bg=TRANSPARENT)
        try:
            self.root.attributes("-transparentcolor", TRANSPARENT)
        except tk.TclError:
            pass

        self.frame = tk.Frame(self.root, bg=TRANSPARENT)
        self.frame.pack()
        title_font = ("Microsoft YaHei UI", 10, "bold")
        main_font = ("Microsoft YaHei UI", 11, "bold")
        sub_font = ("Microsoft YaHei UI", 10, "bold")
        float_font = ("Microsoft YaHei UI", 14, "bold")

        self.title = tk.Label(self.frame, text="技能伤害", fg="#f7f7f7", bg=TRANSPARENT,
                              font=title_font, anchor="e")
        self.title.grid(row=0, column=0, sticky="e")

        self.detail_labels = []
        for row in range(1, 7):
            lab = tk.Label(self.frame, text="", fg="#ffffff", bg=TRANSPARENT,
                           justify="right", font=main_font, anchor="e", width=34)
            lab.grid(row=row, column=0, sticky="e")
            self.detail_labels.append(lab)

        self.sub = tk.Label(self.frame, text="", fg="#d7e8ff", bg=TRANSPARENT,
                            justify="right", font=sub_font, anchor="e")
        self.sub.grid(row=7, column=0, sticky="e", pady=(2, 8))

        self.float_labels = []
        for i in range(3):
            lab = tk.Label(self.frame, text="", bg=TRANSPARENT, justify="right",
                           font=float_font, anchor="e", width=8)
            lab.grid(row=8 + i, column=0, sticky="e")
            self.float_labels.append(lab)

        self.root.update_idletasks()
        make_clickthrough(self.root)
        self.root.after(500, lambda: make_clickthrough(self.root))
        self.tick()

    def save_position(self):
        save_config({
            "follow": self.follow,
            "anchor": self.anchor,
            "x": self.fixed_x,
            "y": self.fixed_y,
        })

    def move_by(self, dx, dy):
        self.root.update_idletasks()
        if self.fixed_x is None or self.fixed_y is None:
            self.fixed_x = self.root.winfo_x()
            self.fixed_y = self.root.winfo_y()
        self.fixed_x = max(0, int(self.fixed_x) + dx)
        self.fixed_y = max(0, int(self.fixed_y) + dy)
        self.follow = False
        self.save_position()
        self.place_near_game()

    def set_follow(self, enabled=True):
        self.follow = bool(enabled)
        self.save_position()
        self.place_near_game()

    def add_event(self, rec):
        with self.events_lock:
            self.events.appendleft(rec)

    def place_near_game(self):
        rect = get_window_rect(self.hwnd)
        if rect is None:
            self.hwnd = find_window_for_pid(self.pid)
            rect = get_window_rect(self.hwnd)
        width = max(360, self.frame.winfo_reqwidth())
        height = max(150, self.frame.winfo_reqheight())
        if not self.follow and self.fixed_x is not None and self.fixed_y is not None:
            x, y = int(self.fixed_x), int(self.fixed_y)
        elif rect:
            left, top, right, bottom = rect
            if self.anchor == "top-left":
                x, y = left + 18, top + 52
            else:
                x, y = right - width - 24, top + 52
        else:
            x, y = 100, 100
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = min(max(0, x), max(0, screen_w - width - 8))
        y = min(max(0, y), max(0, screen_h - height - 48))
        self.root.geometry(f"{width}x{height}+{x}+{y}")
        make_clickthrough(self.root)

    def tick(self):
        snap = self.meter.snapshot()
        lines = [
            ("#f7f7f7", f"技能 {snap['skill_dealt']}   普攻 {snap['normal_dealt']}"),
            ("#b9ff9d", f"宠物 {snap.get('pet_dealt', 0)}   战斗 {fmt_time(snap['active'])}"),
            ("#d7e8ff", f"受到 {snap['taken']}"),
        ]
        recent_hits = list(reversed(snap["damage_history"][-3:]))
        for item in recent_hits:
            side = "造成" if item.get("side") == "dealt" else "受到" if item.get("side") == "taken" else "宠物" if item.get("side") == "pet_dealt" else "其他"
            kind = "技" if item.get("skill_id") is not None else "普"
            color = "#b9ff9d" if item.get("side") == "pet_dealt" else "#ffe36e" if item.get("side") == "dealt" else "#ff7777"
            peer = item.get("target") if item.get("side") in ("dealt", "pet_dealt") else item.get("source")
            lines.append((color, f"{side}{kind} {item['damage']}  {item['skill']}  {peer}"))
        for i, lab in enumerate(self.detail_labels):
            if i >= len(lines):
                lab.configure(text="", fg="#ffffff")
                continue
            color, text = lines[i]
            lab.configure(text=text, fg=color)
        self.sub.configure(text="Ctrl+Alt+方向移动  Ctrl+Alt+Home跟随")

        now = time.time()
        with self.events_lock:
            events = [e for e in self.events if now - e.get("ts", now) < 4.0]
            self.events = deque(events, maxlen=8)

        for i, lab in enumerate(self.float_labels):
            if i >= len(events):
                lab.configure(text="")
                continue
            ev = events[i]
            side = ev.get("side")
            age = now - ev.get("ts", now)
            color = "#b9ff9d" if side == "pet_dealt" else "#ffe36e" if side == "dealt" else "#ff7777"
            prefix = "宠" if side == "pet_dealt" else "+" if side == "dealt" else "-"
            lab.configure(text=f"{prefix}{ev.get('damage', 0)} {ev.get('skill', '')}", fg=color)
            if age > 2.8:
                lab.configure(fg="#aaaaaa")

        self.place_near_game()
        self.root.after(150, self.tick)

    def run(self):
        self.root.mainloop()


def main():
    ap = argparse.ArgumentParser(description="透明伤害统计悬浮窗")
    ap.add_argument("self_actor_id", nargs="?", type=lambda x: int(x, 0), help="可选：自己的角色编号")
    ap.add_argument("--anchor", choices=("top-right", "top-left"), help="跟随游戏窗口的指定角落")
    ap.add_argument("--x", type=int, help="固定屏幕横坐标")
    ap.add_argument("--y", type=int, help="固定屏幕纵坐标")
    ap.add_argument("--follow", action="store_true", help="忽略已保存坐标，重新跟随游戏窗口")
    ap.add_argument("--no-console", action="store_true", help="不显示控制台完整统计")
    args = ap.parse_args()
    config = load_config()

    os.makedirs(LOGDIR, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(LOGDIR, f"damage_overlay_{stamp}.jsonl")

    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos:
        print("eco.exe is not running")
        return 1
    pid = max(ecos, key=lambda x: x.pid).pid

    meter = DamageMeter(out_path=out_path, self_id=args.self_actor_id, game_chat=False)
    anchor = args.anchor or config.get("anchor") or "top-right"
    x = args.x if args.x is not None else config.get("x")
    y = args.y if args.y is not None else config.get("y")
    follow = True if args.follow else config.get("follow")
    overlay = Overlay(meter, pid, anchor=anchor, x=x, y=y, follow=follow)
    meter.event_sink = overlay.add_event

    js = open(os.path.join(HERE, "_damage_capture.js"), encoding="utf-8").read()
    js = js.replace("__MAP_PORT__", str(MAP_PORT))
    js = js.replace("__WATCH_ALL__", "false")
    js = js.replace("__WATCH_OPS__", json.dumps(WATCH_OPS))

    session = dev.attach(pid)
    script = session.create_script(js)
    script.on("message", meter.on_message)
    meter.set_script(script)
    script.load()

    stop_console = threading.Event()
    console_thread = None
    if not args.no_console:
        console_thread = threading.Thread(target=console_loop, args=(meter, stop_console), daemon=True)
        console_thread.start()

    try:
        import keyboard
        keyboard.add_hotkey("f8", meter.reset)
        keyboard.add_hotkey("f9", lambda: overlay.root.after(0, overlay.root.quit))
        keyboard.add_hotkey("ctrl+alt+left", lambda: overlay.root.after(0, overlay.move_by, -10, 0))
        keyboard.add_hotkey("ctrl+alt+right", lambda: overlay.root.after(0, overlay.move_by, 10, 0))
        keyboard.add_hotkey("ctrl+alt+up", lambda: overlay.root.after(0, overlay.move_by, 0, -10))
        keyboard.add_hotkey("ctrl+alt+down", lambda: overlay.root.after(0, overlay.move_by, 0, 10))
        keyboard.add_hotkey("ctrl+alt+home", lambda: overlay.root.after(0, overlay.set_follow, True))
    except Exception:
        pass

    try:
        overlay.run()
    finally:
        stop_console.set()
        if console_thread:
            console_thread.join(timeout=1.5)
        meter.close()
        try:
            session.detach()
        except Exception:
            pass
        print(f"Saved {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
