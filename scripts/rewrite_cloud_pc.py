# -*- coding: utf-8 -*-
"""
Rewrite shared-dict keys on the cloud: raw player names -> {PC}.

Requires Worker /rewrite endpoint (deploy dict_node first).

Usage:
  python scripts/rewrite_cloud_pc.py           # apply
  python scripts/rewrite_cloud_pc.py --dry     # plan only
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from eco_pc_template import PC_TOKEN, load_player_names, normalize_shared_pair  # noqa: E402

DEFAULT_URL = "https://eco-npc-dict.w3145965836.workers.dev"
DEFAULT_TOKEN = "eco_NWODgbGAcW7Zd5EXsuf6P-Kq"
DATA_DIR = Path(os.environ.get("ECO_DATA_DIR") or (ROOT / "data"))


def http_json(method: str, url: str, body: dict | None = None, timeout: int = 60):
    data = None
    headers = {"User-Agent": "eco-npc-dict/rewrite-pc"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pull_all(base: str, token: str, lang: str) -> dict:
    cur = 0
    out = {}
    while True:
        q = (
            f"{base.rstrip('/')}/pull?lang={urllib.parse.quote(lang)}"
            f"&since={cur}&token={urllib.parse.quote(token)}&limit=5000"
        )
        res = http_json("GET", q)
        ents = res.get("entries") or {}
        out.update(ents)
        cur = res.get("cursor", cur)
        if not res.get("more"):
            break
    return out


def load_token_url():
    url, token = DEFAULT_URL, DEFAULT_TOKEN
    cfg_path = DATA_DIR / "sync_config.json"
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        if cfg.get("url"):
            url = str(cfg["url"]).rstrip("/")
        if cfg.get("token"):
            token = str(cfg["token"])
    except Exception:
        pass
    return url, token


def prefer_value(candidates: list[str]) -> str:
    """Prefer a translation that already uses {PC}."""
    if not candidates:
        return ""
    for v in candidates:
        if PC_TOKEN in v:
            return v
    return candidates[0]


def build_ops(entries: dict, known_names: list[str]) -> tuple[list[dict], list[dict]]:
    """Group by normalized key. Return (ops, sample_changes)."""
    groups: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    # each: (orig_k, orig_v, norm_v)
    for k, v in entries.items():
        if not k or not v:
            continue
        nk, nv = normalize_shared_pair(k, v, known_names)
        if not nk or not nv:
            continue
        groups[nk].append((k, v, nv))

    ops = []
    samples = []
    for nk, rows in groups.items():
        dirty = [k for k, _v, _nv in rows if k != nk]
        has_clean = any(k == nk for k, _v, _nv in rows)
        preferred = prefer_value([nv for _k, _v, nv in rows])
        _, preferred = normalize_shared_pair(nk, preferred, known_names)
        if not preferred:
            continue
        clean_v = next((v for k, v, _nv in rows if k == nk), None)

        # Already perfect: one clean key, value already normalized, no aliases.
        if not dirty and has_clean and clean_v == preferred:
            continue

        ops.append(
            {
                "k": nk,
                "v": preferred,
                "model": "rewrite-pc",
                "delete": dirty,
                "upsert": True,
            }
        )
        if len(samples) < 25:
            samples.append(
                {
                    "from": [d[:90] for d in (dirty[:3] if dirty else [rows[0][0]])],
                    "to": nk[:100],
                    "v": preferred[:80],
                    "delete_n": len(dirty),
                }
            )
    return ops, samples


def main():
    ap = argparse.ArgumentParser(description="Rewrite cloud dict player names to {PC}")
    ap.add_argument("--dry", action="store_true", help="Plan only, do not POST /rewrite")
    ap.add_argument("--lang", default="zh-CN")
    ap.add_argument("--batch", type=int, default=100, help="ops per /rewrite request")
    args = ap.parse_args()

    base, token = load_token_url()
    names = load_player_names(
        config_file=str(DATA_DIR / "translate_config.json"),
        data_dir=str(DATA_DIR),
    )
    print(f"url={base}")
    print(f"lang={args.lang}")
    print(f"known_names={names}")
    print("pulling...")
    entries = pull_all(base, token, args.lang)
    print(f"pulled {len(entries)} entries")

    ops, samples = build_ops(entries, names)
    print(f"rewrite ops: {len(ops)}")
    print("--- samples ---")
    for s in samples[:15]:
        print(f"  delete {s['delete_n']}: {s['from']!r}")
        print(f"    -> {s['to']!r}")
        print(f"    v  {s['v']!r}")

    if args.dry:
        print("[dry] no changes written")
        return 0

    if not ops:
        print("nothing to rewrite")
        return 0

    total_deleted = 0
    total_upserted = 0
    for i in range(0, len(ops), max(1, args.batch)):
        chunk = ops[i : i + args.batch]
        res = http_json(
            "POST",
            f"{base.rstrip('/')}/rewrite",
            {"lang": args.lang, "token": token, "ops": chunk},
        )
        print(f"batch {i // args.batch + 1}: {res}")
        if res.get("error"):
            print("FAILED", res)
            return 1
        total_deleted += int(res.get("deleted") or 0)
        total_upserted += int(res.get("upserted") or 0)

    stats = http_json("GET", f"{base.rstrip('/')}/stats?lang={urllib.parse.quote(args.lang)}")
    print(f"done deleted_rows~={total_deleted} upserted_rows~={total_upserted}")
    print(f"stats {stats}")

    # Verify: count remaining dirty-looking keys
    after = pull_all(base, token, args.lang)
    dirty = 0
    for k, v in after.items():
        nk, nv = normalize_shared_pair(k, v, names)
        if nk != k or nv != v:
            dirty += 1
    print(f"remaining non-normalized pairs: {dirty} / {len(after)}")
    return 0 if dirty == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
