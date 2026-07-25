# -*- coding: utf-8 -*-
"""Central path resolution for ECO toolbox scripts.

Layout (dev):
  repo/
    src/          code + Frida JS
    data/         writable configs, caches, name tables
    logs/         optional top-level logs (or data/logs)

Layout (frozen / Electron packaged):
  RES_DIR  = PyInstaller _MEIPASS (read-only resources)
  DATA_DIR = ECO_DATA_DIR or directory of the executable (writable)
"""
from __future__ import annotations

import os
import sys
from typing import Optional, Tuple


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resolve_dirs(script_file: Optional[str] = None) -> Tuple[str, str]:
    """Return (RES_DIR, DATA_DIR).

    RES_DIR: code / bundled resources (read-only after packaging)
    DATA_DIR: writable configs, caches, name tables
    """
    if script_file:
        script_dir = os.path.dirname(os.path.abspath(script_file))
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))

    env_data = os.environ.get("ECO_DATA_DIR")
    if env_data:
        data_dir = os.path.abspath(env_data)
        if _is_frozen():
            res_dir = getattr(sys, "_MEIPASS", script_dir)
        else:
            res_dir = script_dir
        return res_dir, data_dir

    if _is_frozen():
        res_dir = getattr(sys, "_MEIPASS", script_dir)
        data_dir = os.path.dirname(sys.executable)
        return res_dir, data_dir

    # Development: prefer sibling ../data when present.
    res_dir = script_dir
    sibling = os.path.abspath(os.path.join(script_dir, "..", "data"))
    data_dir = sibling if os.path.isdir(sibling) else res_dir
    return res_dir, data_dir


def ensure_data_layout(data_dir: str) -> str:
    """Create data/logs directories if needed; return data_dir."""
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "logs"), exist_ok=True)
    return data_dir


def data_path(data_dir: str, *parts: str) -> str:
    return os.path.join(data_dir, *parts)


def resource_path(res_dir: str, *parts: str) -> str:
    return os.path.join(res_dir, *parts)


def find_data_file(data_dir: str, res_dir: str, name: str) -> str:
    """Prefer writable data copy, then bundled resource copy."""
    candidates = [
        os.path.join(data_dir, name),
        os.path.join(res_dir, name),
        os.path.join(res_dir, "data", name),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    # Default write target under DATA_DIR even if missing.
    return os.path.join(data_dir, name)


def log_dir(data_dir: str) -> str:
    path = os.path.join(data_dir, "logs")
    os.makedirs(path, exist_ok=True)
    return path
