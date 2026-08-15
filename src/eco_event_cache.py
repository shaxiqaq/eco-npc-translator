# -*- coding: utf-8 -*-
"""EventID-keyed translation memory.

Stores what we have seen per event so a later aligner can pair
English / Japanese / Indonesian lines. Runtime does NOT auto-apply
another language's Chinese by say-index — order can differ.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Optional


class EventCache:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, Any] = {}
        self.dirty = 0
        try:
            with open(path, encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                self.data = loaded
        except Exception:
            self.data = {}

    def remember(self, eid, kind: str, source_lang: str, key: str, value: str) -> None:
        if not eid or not key or not value:
            return
        event_id = str(eid)
        with self.lock:
            entry = self.data.setdefault(event_id, {"says": [], "selects": []})
            bucket = "selects" if kind == "select" else "says"
            rows = entry.setdefault(bucket, [])
            for row in rows:
                if row.get("src") == source_lang and row.get("k") == key:
                    if row.get("v") != value:
                        row["v"] = value
                        self.dirty += 1
                    return
            rows.append({"src": source_lang, "k": key, "v": value})
            self.dirty += 1
            if self.dirty >= 8:
                self._flush_unlocked()

    def lookup(self, eid, source_lang: str, key: str) -> Optional[str]:
        if not eid or not key:
            return None
        with self.lock:
            entry = self.data.get(str(eid)) or {}
            for bucket in ("says", "selects"):
                for row in entry.get(bucket) or []:
                    if row.get("src") == source_lang and row.get("k") == key:
                        return row.get("v")
        return None

    def flush(self) -> None:
        with self.lock:
            self._flush_unlocked()

    def _flush_unlocked(self) -> None:
        if self.dirty <= 0:
            return
        try:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as handle:
                json.dump(self.data, handle, ensure_ascii=False)
            self.dirty = 0
        except Exception:
            pass
