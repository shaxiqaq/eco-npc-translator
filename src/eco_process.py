# -*- coding: utf-8 -*-
"""Resolve ECO game process for Frida attach.

Electron finds processes via PowerShell (Get-Process -Name eco). Frida's
enumerate_processes() can return empty/different names on some Windows
machines (permissions, AV, non-standard process name). When the UI already
selected a PID, we must prefer attaching by PID instead of requiring a name
match first.
"""
from __future__ import annotations

import ctypes
import os
import sys
from typing import Any, List, Optional, Sequence, Tuple


def is_eco_process_name(name: Optional[str]) -> bool:
    value = str(name or "").strip().lower()
    if not value:
        return False
    base = os.path.basename(value.replace("/", "\\"))
    return base in ("eco.exe", "eco") or base.startswith("eco.")


def process_exists_windows(pid: int) -> Optional[bool]:
    """Return True/False if we can check, or None if check unavailable."""
    if sys.platform != "win32":
        return None
    try:
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid)
        )
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        # Access denied often means the process exists but we lack rights.
        err = ctypes.GetLastError()
        if err in (5,):  # ERROR_ACCESS_DENIED
            return True
        return False
    except Exception:
        return None


def list_eco_processes(device) -> List[Any]:
    try:
        processes = list(device.enumerate_processes())
    except Exception:
        return []
    return [process for process in processes if is_eco_process_name(getattr(process, "name", ""))]


def resolve_attach_pid(
    device,
    preferred_pid: Optional[int] = None,
) -> Tuple[int, str]:
    """Return (pid, how) for Frida attach.

    Prefer explicit PID from Electron even when Frida name enumeration is empty.
    """
    preferred = int(preferred_pid) if preferred_pid else None
    if preferred is not None and preferred <= 0:
        preferred = None

    processes: Sequence[Any] = []
    try:
        processes = list(device.enumerate_processes())
    except Exception as exc:
        if preferred is None:
            raise RuntimeError(f"无法枚举进程（Frida）：{exc}") from exc
        processes = []

    by_pid = {int(p.pid): p for p in processes if getattr(p, "pid", None)}
    games = [p for p in processes if is_eco_process_name(getattr(p, "name", ""))]

    if preferred is not None:
        match = by_pid.get(preferred)
        if match is not None:
            name = getattr(match, "name", "") or "unknown"
            # Trust the PID chosen in the toolbox UI even if Frida's process name
            # is not exactly eco.exe (some environments report odd names).
            return preferred, f"pid-match name={name}"
        # Frida list missed it — still try attach if OS says process exists.
        exists = process_exists_windows(preferred)
        if exists is False:
            raise RuntimeError(
                f"指定的进程不存在或已退出（进程 {preferred}）。请刷新进程列表后重选。"
            )
        return preferred, "pid-direct"

    if not games:
        # Helpful diagnostics for remote support.
        sample = ", ".join(
            f"{getattr(p, 'name', '?')}#{getattr(p, 'pid', '?')}"
            for p in list(processes)[:12]
        ) or "(empty)"
        raise RuntimeError(
            "没有找到 eco.exe。请确认已进入游戏；"
            f"若顶部已选中 PID，请重试或用管理员身份运行工具箱。"
            f" Frida 枚举示例: {sample}"
        )

    chosen = max(games, key=lambda process: int(process.pid))
    return int(chosen.pid), f"latest-eco name={getattr(chosen, 'name', 'eco.exe')}"
