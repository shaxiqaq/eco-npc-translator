# -*- coding: utf-8 -*-
"""Player-name templating for NPC dialogue cache / shared dictionary.

Local config lists the player's character names. Before translate/cache/upload we
replace those with {PC}; on display we put the real name back.

Unconfigured clients used to upload raw names (e.g. Hokuto0), which never match
other players. normalize_shared_pair() also maps Latin tokens that survive
unchanged into the Chinese value — almost always a player name — onto {PC}.
"""
from __future__ import annotations

import json
import os
import re
from typing import Iterable, List, Optional, Sequence, Tuple

PC_TOKEN = "{PC}"

# Tokens that commonly appear as Latin in both EN and ZH but are NOT player names.
_NAME_DENYLIST = frozenset(
    {
        # common english / ui
        "the",
        "and",
        "for",
        "you",
        "your",
        "are",
        "was",
        "were",
        "with",
        "from",
        "this",
        "that",
        "have",
        "has",
        "will",
        "can",
        "not",
        "yes",
        "no",
        "ok",
        "next",
        "back",
        "leave",
        "quest",
        "soul",
        "storage",
        "welcome",
        "alright",
        "please",
        "thank",
        "thanks",
        "hello",
        "event",
        "navi",
        "menu",
        "auto",
        "use",
        "points",
        "status",
        "level",
        "item",
        "items",
        "gift",
        "cafe",
        "guild",
        "merchant",
        "downtown",
        "uptown",
        "bridge",
        "plains",
        "east",
        "west",
        "north",
        "south",
        "ticket",
        "tickets",
        "exchange",
        "adventure",
        "adventurer",
        "adventuring",
        "school",
        "lesson",
        "lessons",
        "weapon",
        "hammer",
        "monster",
        "monsters",
        "inventory",
        "position",
        "saved",
        "change",
        "finally",
        "woken",
        "sleep",
        "dream",
        "growth",
        "stronger",
        "directions",
        "noted",
        "ready",
        "call",
        "through",
        "after",
        "getting",
        "familiar",
        "city",
        "need",
        "help",
        "pick",
        "lost",
        "also",
        "name",
        "nice",
        "way",
        "show",
        "take",
        "leave",
        "time",
        "here",
        "there",
        "over",
        "stairs",
        "clothes",
        "hair",
        "man",
        "see",
        "phrase",
        "moment",
        "before",
        "drops",
        "pass",
        "fareast",
        "feathers",
        "atmosphere",
        "capture",
        "image",
        "someone",
        "wearing",
        "red",
        "blue",
        "young",
        "member",
        "tribe",
        "fleeing",
        "war",
        "land",
        "grow",
        "strong",
        "limit",
        "emil",
        "world",
        "invasion",
        # stats / short codes
        "hp",
        "mp",
        "sp",
        "vit",
        "str",
        "agi",
        "dex",
        "int",
        "mag",
        "exp",
        "cexp",
        "jexp",
        "eco",
        # frequent NPC / proper nouns in ECO (keep as-is)
        "angel",
        "amis",
        "primula",
        "fairy",
        "dark",
        "feather",
        "alma",
        "willydoo",
        "balulu",
        "cockko",
        "crawler",
        "crawlers",
        "kitin",
        "acropolis",
        "acronia",
        "dominion",
        "resurrection",
        "warrior",
        "one",
        "point",
        "joker",
        "older",
        "brother",
        "shabotan",
        "flower",
        "decoration",
        "handball",
        "beautiful",
        "tiny",
        "zero",
        # extra game/npc/item tokens seen in real corpus
        "mini",
        "pii",
        "ecobo",
        "bawoo",
        "pebble",
        "salamander",
        "wharton",
        "tita",
        "titania",
        "archangel",
        "cpriest",
        "godd",
        "arm",
        "part",
        "dem",
        "ep",
        "mode",
        "number",
        "carrot",
        "lunchbox",
        "airship",
        "engineer",
        "wedding",
        "event",
        "held",
        "currently",
        "beware",
        "gold",
        "sold",
        "complete",
        "managed",
        "guiding",
        "important",
        "hungry",
        "ordered",
        "breathe",
        "underwater",
        "coming",
        "machine",
        "form",
        "equipment",
        "configuration",
        "living",
        "beings",
        "strength",
        "based",
        "own",
        "points",
        "participation",
        "entrusted",
        "guidance",
        "ns44",
    }
)

# Latin player-like token: starts with a letter, 3–20 chars, may include digits.
_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9]{2,19}")
_HAS_DIGIT_RE = re.compile(r"\d")
# Common dialogue slots where the player name is inserted by the server.
_NAME_SLOT_RE = re.compile(
    r"(?:"
    r"Welcome back,\s*"
    r"|Oh!\s*"
    r"|Alright\s+"
    r"|for\s+"
    r"|you are\s+"
    r"|Your name\s+is(?:\.\.\.)?\s*"
    r"|It seems you are\s+"
    r"|nice name♪?\s*"
    r"|directions\s+for\s+"
    r"|show the way for\s+"
    r"|take\s+"
    r"|Leave it to me!\s*"
    r"|Finally,\s*"
    r"|woken up\?\s*"
    r")"
    r"([A-Za-z][A-Za-z0-9]{2,19})",
    re.IGNORECASE,
)
_BRACKET_RE = re.compile(r"\[[^\]]*\]")


def load_player_names(
    config_file: Optional[str] = None,
    data_dir: Optional[str] = None,
    extra: Optional[Sequence[str]] = None,
) -> List[str]:
    """Load configured character names (order preserved, de-duped)."""
    names: List[str] = []
    if config_file and os.path.isfile(config_file):
        try:
            with open(config_file, encoding="utf-8") as stream:
                cfg = json.load(stream)
            pn = cfg.get("player_names") or cfg.get("player_name")
            if isinstance(pn, str):
                names.append(pn)
            elif isinstance(pn, list):
                names.extend(str(x) for x in pn)
        except Exception:
            pass
    if data_dir:
        path = os.path.join(data_dir, "player_names.json")
        try:
            with open(path, encoding="utf-8") as stream:
                raw = json.load(stream)
            if isinstance(raw, list):
                names.extend(str(x) for x in raw)
            elif isinstance(raw, str):
                names.append(raw)
        except Exception:
            pass
    if extra:
        names.extend(str(x) for x in extra)
    out: List[str] = []
    for n in names:
        n = str(n).strip()
        if n and n not in out:
            out.append(n)
    return out


def load_player_names_from_data_dir(data_dir: str) -> List[str]:
    return load_player_names(
        config_file=os.path.join(data_dir, "translate_config.json"),
        data_dir=data_dir,
    )


def _name_pattern(names: Sequence[str]) -> Optional[re.Pattern]:
    cleaned = [str(n).strip() for n in names if str(n).strip()]
    if not cleaned:
        return None
    cleaned.sort(key=len, reverse=True)
    # Word boundaries so "shaxi" does not eat "shaxiqaq".
    body = "|".join(re.escape(n) for n in cleaned)
    return re.compile(rf"(?<![A-Za-z0-9_])(?:{body})(?![A-Za-z0-9_])")


def templatize(text: Optional[str], names: Sequence[str]) -> Tuple[Optional[str], Optional[str]]:
    """Replace configured player names with {PC}. Returns (text, hit_name)."""
    if not text:
        return text, None
    pat = _name_pattern(names)
    if not pat:
        return text, None
    hit = {"n": None}

    def _sub(m):
        hit["n"] = m.group(0)
        return PC_TOKEN

    return pat.sub(_sub, text), hit["n"]


def untemplatize(text: Optional[str], name: Optional[str]) -> Optional[str]:
    if name and text and PC_TOKEN in text:
        return text.replace(PC_TOKEN, name)
    return text


def _replace_token(text: str, token: str, repl: str) -> str:
    return re.sub(
        rf"(?<![A-Za-z0-9_]){re.escape(token)}(?![A-Za-z0-9_])",
        repl,
        text,
    )


def _strip_brackets(text: str) -> str:
    return _BRACKET_RE.sub(" ", text)


def _slot_names(text: str) -> set:
    return {m.group(1) for m in _NAME_SLOT_RE.finditer(_strip_brackets(text or ""))}


def _candidate_foreign_names(key: str, value: str) -> List[str]:
    """High-confidence foreign player names only (conservative).

    Auto-detect only Latin tokens that:
    1. Appear as whole words in both source and translation (outside [item] tags),
    2. Are not known NPC/UI tokens,
    3. Contain a digit (handles like Hokuto0) — pure alphabetic names must come
       from configured player_names to avoid eating NPC names (Mini, Tentacle…).
    """
    if not key or not value:
        return []
    key_plain = _strip_brackets(key)
    val_plain = _strip_brackets(value)
    key_tokens = set(_TOKEN_RE.findall(key_plain))
    val_tokens = set(_TOKEN_RE.findall(val_plain))
    shared = key_tokens & val_tokens
    out: List[str] = []
    for tok in shared:
        low = tok.lower()
        if low in _NAME_DENYLIST:
            continue
        if tok.upper() == tok and len(tok) <= 4:
            continue
        if low == "pc":
            continue
        # Digit handles are the only safe auto foreign names.
        if _HAS_DIGIT_RE.search(tok):
            out.append(tok)
    out.sort(key=len, reverse=True)
    return out


def normalize_shared_pair(
    key: Optional[str],
    value: Optional[str],
    known_names: Optional[Sequence[str]] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Normalize a (source, translation) pair for cache / shared-dict use.

    1. Replace configured local player names with {PC} in both sides.
    2. Replace Latin tokens that appear unchanged in both sides (foreign player
       names uploaded without config) with {PC}.
    """
    if key is None or value is None:
        return key, value
    k, v = str(key), str(value)
    # Drop NULs / other controls so cloud keys match local lookup form.
    k = "".join(ch for ch in k if ch in "\n\r\t" or ord(ch) >= 32).strip()
    v = "".join(ch for ch in v if ch in "\n\r\t" or ord(ch) >= 32).strip()
    names = list(known_names or [])

    if names:
        k, _ = templatize(k, names)
        v, _ = templatize(v, names)

    # Already fully templated on the source side — still clean value leftovers.
    for tok in _candidate_foreign_names(k, v):
        if tok == PC_TOKEN:
            continue
        # Do not replace if token is one of the configured names already handled
        k2 = _replace_token(k, tok, PC_TOKEN)
        v2 = _replace_token(v, tok, PC_TOKEN)
        if k2 != k or v2 != v:
            k, v = k2, v2

    # Collapse accidental doubled placeholders
    k = re.sub(r"(?:\{PC\}){2,}", PC_TOKEN, k)
    v = re.sub(r"(?:\{PC\}){2,}", PC_TOKEN, v)
    return k, v


def normalize_cache_dict(
    cache: dict,
    known_names: Optional[Sequence[str]] = None,
) -> Tuple[dict, int]:
    """Rewrite a cache map onto templated keys. Returns (new_dict, changed_count)."""
    rebuilt = {}
    changed = 0
    for raw_k, raw_v in list(cache.items()):
        if not raw_k or not raw_v:
            changed += 1
            continue
        nk, nv = normalize_shared_pair(raw_k, raw_v, known_names)
        if not nk or not nv:
            changed += 1
            continue
        if nk != raw_k or nv != raw_v:
            changed += 1
        # Prefer first-seen; if both raw and templated exist, keep existing templated
        if nk not in rebuilt:
            rebuilt[nk] = nv
        elif PC_TOKEN in nk and PC_TOKEN not in str(raw_k):
            rebuilt[nk] = nv
    return rebuilt, changed
