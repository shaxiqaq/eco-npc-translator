# -*- coding: utf-8 -*-
"""Display-name resolution for skills/buffs (client + Japanese wiki-aligned tables)."""
from __future__ import annotations

import json
import os
import re
from typing import Dict, Optional

from eco_paths import find_data_file, resolve_dirs

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)

_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
_KANA_RE = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def is_garbage_name(value: str) -> bool:
    if not value or not str(value).strip():
        return True
    text = str(value)
    if _CTRL_RE.search(text):
        return True
    # Private-use / replacement-heavy garbage from bad client extracts
    pua = sum(1 for c in text if 0xE000 <= ord(c) <= 0xF8FF or 0xF0000 <= ord(c) <= 0xFFFFD)
    if pua >= 3:
        return True
    if len(text) >= 24 and pua >= 1:
        return True
    return False


def looks_japanese(value: str) -> bool:
    text = str(value or "")
    if not text or is_garbage_name(text):
        return False
    return bool(_KANA_RE.search(text))


def load_id_str_map(path: str) -> Dict[int, str]:
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    out: Dict[int, str] = {}
    for key, value in data.items():
        try:
            skill_id = int(key, 0)
        except Exception:
            continue
        if not isinstance(value, str):
            continue
        text = value.strip()
        if is_garbage_name(text):
            continue
        out[skill_id] = text
    return out


def load_skill_name_tables(
    data_dir: Optional[str] = None,
    res_dir: Optional[str] = None,
) -> Dict[str, Dict[int, str]]:
    data = data_dir or _DATA_DIR
    res = res_dir or _RES_DIR
    zh_path = find_data_file(data, res, "skill_names.json")
    ja_path = find_data_file(data, res, "skill_names_ja.json")
    zh = load_id_str_map(zh_path)
    ja = load_id_str_map(ja_path)
    # Promote kana-only client entries into ja if missing.
    for skill_id, name in zh.items():
        if skill_id not in ja and looks_japanese(name):
            ja[skill_id] = name
    return {"zh": zh, "ja": ja}


def format_skill_display(
    skill_id: Optional[int],
    tables: Dict[str, Dict[int, str]],
    mode: str = "client",
    prefer: Optional[str] = None,
    fallback: str = "普通攻击",
) -> str:
    if skill_id is None:
        return prefer or fallback
    try:
        skill_id = int(skill_id)
    except (TypeError, ValueError):
        return prefer or fallback

    zh = (tables.get("zh") or {}).get(skill_id)
    ja = (tables.get("ja") or {}).get(skill_id)
    mode = (mode or "client").lower()

    if prefer and not is_garbage_name(prefer):
        # Live packet name often best; still dual with ja if requested.
        if mode == "dual" and ja and ja != prefer:
            return f"{prefer} / {ja}"
        if mode == "ja" and ja:
            return ja
        return prefer

    if mode == "ja":
        return ja or zh or f"技能#{skill_id}"
    if mode == "dual":
        if zh and ja and zh != ja:
            return f"{zh} / {ja}"
        return zh or ja or f"技能#{skill_id}"
    # client (default): prefer zh table, then ja
    return zh or ja or f"技能#{skill_id}"


def skill_wiki_url(name: Optional[str] = None, skill_id: Optional[int] = None) -> str:
    """Search-oriented wiki URL (lycolia archive)."""
    base = "https://eco.lycolia.info/wiki/"
    if name and str(name).strip() and not str(name).startswith("技能#"):
        q = urllib_quote(str(name).split(" / ")[0].strip())
        return f"{base}?cmd=search&word={q}"
    if skill_id:
        return f"{base}?Skill"
    return f"{base}?Skill"


def urllib_quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value)


def status_wiki_url() -> str:
    return "https://eco.lycolia.info/wiki/?StatusBuff"


def load_buff_meta(data_dir: Optional[str] = None, res_dir: Optional[str] = None) -> dict:
    data = data_dir or _DATA_DIR
    res = res_dir or _RES_DIR
    path = find_data_file(data, res, "buff_meta.json")
    try:
        with open(path, encoding="utf-8") as stream:
            raw = json.load(stream)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def load_job_timer_presets(data_dir: Optional[str] = None, res_dir: Optional[str] = None) -> list:
    data = data_dir or _DATA_DIR
    res = res_dir or _RES_DIR
    path = find_data_file(data, res, "job_timer_presets.json")
    try:
        with open(path, encoding="utf-8") as stream:
            raw = json.load(stream)
        if isinstance(raw, dict) and isinstance(raw.get("presets"), list):
            return raw["presets"]
        if isinstance(raw, list):
            return raw
    except Exception:
        pass
    return []
