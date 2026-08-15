# -*- coding: utf-8 -*-
"""Detect NPC dialogue source language and isolate cache / sync buckets.

English stays the default unprefixed key so existing npc_cache.json and the
public zh-CN cloud bucket keep working. Japanese / Indonesian get their own
local prefixes and cloud lang buckets (zh-CN-ja, zh-CN-id).
"""
from __future__ import annotations

import re
from typing import Optional

SOURCE_LANGS = ("en", "ja", "id", "zh", "und")
SYNC_SOURCE_BUCKETS = ("en", "ja", "id")

_KANA_RE = re.compile(r"[\u3040-\u30ff]")
_HANGUL_RE = re.compile(r"[\uac00-\ud7af]")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z\u00C0-\u024F]")
_ZH_PARTICLE_RE = re.compile(r"[的了是在吗呢吧啊您这那和与把被给]")
_WORD_RE = re.compile(r"[A-Za-z\u00C0-\u024F]+")

# Whole-word Indonesian function words that almost never appear in ECO English.
_ID_MARKERS = frozenset(
    {
        "kamu",
        "tidak",
        "apakah",
        "sudah",
        "dengan",
        "mereka",
        "sebagai",
        "ingin",
        "adalah",
        "untuk",
        "dari",
        "mendapatkan",
        "mamasang",
        "melepas",
        "jumlah",
        "buah",
        "saya",
        "kami",
        "bisa",
        "akan",
        "atau",
        "pada",
        "ini",
        "itu",
        "yang",
        "boleh",
        "tolong",
        "terima",
        "kasih",
        "silakan",
        "selamat",
        "datang",
        "pergi",
        "kembali",
        "benar",
        "salah",
        "nanti",
        "sekarang",
        "mengapa",
        "bagaimana",
        "dimana",
        "kemana",
    }
)

_CACHE_PREFIX = {
    "ja": "ja::",
    "id": "id::",
    "zh": "zh::",
}


def normalize_source_lang(value: Optional[str]) -> str:
    raw = (value or "").strip().lower().replace("_", "-")
    if raw in ("auto", "", "unknown", "?"):
        return "auto"
    if raw in ("en", "eng", "english"):
        return "en"
    if raw in ("ja", "jp", "jpn", "japanese"):
        return "ja"
    if raw in ("id", "ind", "in", "indonesian", "indonesia", "bahasa"):
        return "id"
    if raw.startswith("zh"):
        return "zh"
    if raw in SOURCE_LANGS:
        return raw
    return "auto"


def detect_source_lang(text: Optional[str]) -> str:
    """Best-effort source language for one NPC line.

    Order: Japanese kana → Korean → Chinese particles/CJK-heavy →
    Indonesian markers → Latin default English → und.
    """
    if not text:
        return "und"
    sample = str(text)
    if _KANA_RE.search(sample):
        return "ja"
    if _HANGUL_RE.search(sample):
        return "und"
    cjk = _CJK_RE.findall(sample)
    if cjk:
        if _ZH_PARTICLE_RE.search(sample) or len(cjk) >= 4:
            return "zh"
        if not _LATIN_RE.search(sample) and len(cjk) >= 2:
            return "zh"
    words = [w.lower() for w in _WORD_RE.findall(sample)]
    id_hits = sum(1 for w in words if w in _ID_MARKERS)
    if id_hits >= 2:
        return "id"
    if id_hits == 1 and len(words) >= 4:
        return "id"
    if _LATIN_RE.search(sample):
        return "en"
    if cjk:
        return "zh"
    return "und"


def resolve_source_lang(text: Optional[str], mode: Optional[str] = "auto") -> str:
    normalized = normalize_source_lang(mode)
    if normalized != "auto":
        return normalized
    return detect_source_lang(text)


def is_already_chinese(text: Optional[str]) -> bool:
    return detect_source_lang(text) == "zh"


def is_ambiguous_short(text: Optional[str]) -> bool:
    """Yes / No / OK / Next — unsafe as a cross-language cloud key."""
    if not text:
        return True
    compact = re.sub(r"\s+", " ", str(text)).strip()
    if not compact:
        return True
    letters = _LATIN_RE.findall(compact)
    words = compact.split()
    return len(compact) <= 16 and len(words) <= 3 and len(letters) <= 16


def cache_storage_key(text: str, source_lang: Optional[str]) -> str:
    src = normalize_source_lang(source_lang)
    if src == "auto":
        src = detect_source_lang(text)
    prefix = _CACHE_PREFIX.get(src)
    if not prefix:
        return text
    return prefix + text


def parse_storage_key(key: str) -> tuple[str, str]:
    if not key:
        return "en", key
    for src, prefix in _CACHE_PREFIX.items():
        if key.startswith(prefix):
            return src, key[len(prefix) :]
    return "en", key


def sync_bucket(target_lang: str, source_lang: Optional[str]) -> str:
    """Cloud `lang` field. English keeps `zh-CN` for old clients."""
    target = (target_lang or "zh-CN").strip() or "zh-CN"
    src = normalize_source_lang(source_lang)
    if src == "auto":
        src = "en"
    if src in ("en", "und", ""):
        return target
    return f"{target}-{src}"


def source_from_bucket(bucket: str, target_lang: str) -> str:
    target = (target_lang or "zh-CN").strip() or "zh-CN"
    if not bucket or bucket == target:
        return "en"
    prefix = target + "-"
    if bucket.startswith(prefix):
        return normalize_source_lang(bucket[len(prefix) :]) or "en"
    return "en"


def api_source_code(source_lang: Optional[str]) -> str:
    """Value sent to translation backends. `und` becomes auto."""
    src = normalize_source_lang(source_lang)
    if src in ("auto", "und"):
        return "auto"
    return src
