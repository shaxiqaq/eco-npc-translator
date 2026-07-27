# -*- coding: utf-8 -*-
"""Build cleaned skill tables + Japanese overlays for display.

Reads data/skill_names.json, writes:
  - data/skill_names.json (garbage stripped, backup once)
  - data/skill_names_ja.json (kana names + seed JP aliases)
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SKILL_PATH = DATA / "skill_names.json"
JA_PATH = DATA / "skill_names_ja.json"

CTRL = re.compile(r"[\x00-\x1f\x7f]")
KANA = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")

# High-value JP names aligned with classic ECO / lycolia wiki usage.
# Keys are skill_id; values are Japanese display names.
SEED_JA = {
    "2100": "パリイ",
    "6418": "パリイ(ペット)",
    "3114": "マジックシールド",
    "3100": "ファイアシールド",
    "3113": "アイスシールド",
    "4026": "アタックアシスト",
    "4025": "ディフェンスアシスト",
    "4028": "パワーアシスト",
    "2486": "アサシンマーク",
    "3271": "ライフマーク",
    "2004": "アボイドステップ",
    "6647": "アボイドステップ",
}


def is_garbage(text: str) -> bool:
    if not text or not str(text).strip():
        return True
    if CTRL.search(text):
        return True
    pua = sum(1 for c in text if 0xE000 <= ord(c) <= 0xF8FF)
    return pua >= 3


def main() -> None:
    raw = json.loads(SKILL_PATH.read_text(encoding="utf-8"))
    cleaned = {}
    ja = dict(SEED_JA)
    removed = 0
    for key, value in raw.items():
        if not isinstance(value, str) or is_garbage(value):
            removed += 1
            continue
        text = value.strip()
        cleaned[str(int(key, 0)) if str(key).isdigit() or str(key).startswith("0x") else str(key)] = text
        try:
            kid = str(int(key, 0))
        except Exception:
            kid = str(key)
        cleaned[kid] = text
        if KANA.search(text):
            ja[kid] = text

    # Normalize keys to decimal strings without leading zeros issues
    cleaned_norm = {}
    for key, value in cleaned.items():
        try:
            cleaned_norm[str(int(key, 0))] = value
        except Exception:
            cleaned_norm[str(key)] = value

    backup = SKILL_PATH.with_suffix(".json.bak")
    if not backup.exists():
        shutil.copy2(SKILL_PATH, backup)

    SKILL_PATH.write_text(json.dumps(cleaned_norm, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    JA_PATH.write_text(json.dumps(ja, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"skills cleaned: {len(cleaned_norm)} (removed {removed})")
    print(f"ja names: {len(ja)} -> {JA_PATH}")


if __name__ == "__main__":
    main()
