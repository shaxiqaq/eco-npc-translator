# -*- coding: utf-8 -*-
import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(_DATA_DIR)
HERE = Path(_DATA_DIR)
MOB_NAMES = HERE / "mob_names.json"
MOB_NAMES_JA = HERE / "mob_names_ja.json"
CACHE = HERE / "mob_names_zh_cache.json"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
logger = setup_logger(
    "eco.translate_mob_names",
    log_dir=log_dir(_DATA_DIR),
    log_file="translate_mob_names.log",
)


def load_json(path):
    try:
        data = json.load(open(path, encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def has_japanese(text):
    return bool(re.search(r"[\u3040-\u30ff\u31f0-\u31ff]", text or ""))


def extract_list(text, expected):
    text = (text or "").strip()
    candidates = []
    try:
        candidates.append(json.loads(text))
    except Exception:
        pass
    for match in re.finditer(r"(\{.*?\}|\[.*?\])", text, re.S):
        try:
            candidates.append(json.loads(match.group(1)))
        except Exception:
            continue

    for obj in candidates:
        if isinstance(obj, list):
            vals = obj
        elif isinstance(obj, dict):
            vals = None
            for key in ("translations", "translated", "names", "result", "results"):
                if isinstance(obj.get(key), list):
                    vals = obj[key]
                    break
            if vals is None:
                list_values = [v for v in obj.values() if isinstance(v, list)]
                vals = list_values[0] if list_values else None
        else:
            vals = None
        if vals and len(vals) == expected:
            return [str(x).strip() for x in vals]
    return None


def ollama_translate(names, model, timeout):
    prompt = (
        "Translate Japanese RPG monster names into Simplified Chinese.\n"
        "Output ONLY a JSON array of strings. Same length and order. No explanation.\n"
        + json.dumps(names, ensure_ascii=False)
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0, "num_predict": max(256, len(names) * 16)},
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    data = json.loads(raw)
    return extract_list(data.get("response", ""), len(names))


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def main():
    ap = argparse.ArgumentParser(description="用本地 Ollama 把 mob_names.json 的日文怪物名翻译成中文")
    ap.add_argument("--model", default="qwen3-coder-unsloth:30b")
    ap.add_argument("--batch", type=int, default=50)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--force", action="store_true", help="重新翻译已有缓存")
    args = ap.parse_args()

    if not MOB_NAMES.exists():
        raise SystemExit("找不到 mob_names.json，请先导入 monster.csv。")
    if not MOB_NAMES_JA.exists():
        shutil.copy2(MOB_NAMES, MOB_NAMES_JA)
        logger.info("已备份日文原表: %s", MOB_NAMES_JA)

    source = load_json(MOB_NAMES_JA)
    cache = load_json(CACHE)
    todo = []
    for key, name in source.items():
        if not isinstance(name, str) or not name.strip():
            continue
        if not has_japanese(name):
            cache.setdefault(key, name)
            continue
        if args.force or key not in cache or has_japanese(str(cache.get(key, ""))):
            todo.append((key, name))

    logger.info("本地怪物名翻译")
    logger.info("================")
    logger.info("模型: %s", args.model)
    logger.info("总数: %s，待翻译: %s，已有缓存: %s", len(source), len(todo), len(cache))

    done = 0
    for part in chunks(todo, max(1, args.batch)):
        keys = [k for k, _ in part]
        names = [v for _, v in part]
        translated = None
        for attempt in range(1, 4):
            try:
                translated = ollama_translate(names, args.model, args.timeout)
                if translated:
                    break
            except Exception as exc:
                logger.warning("批次失败 %s/3: %s", attempt, exc)
            time.sleep(1.5 * attempt)
        if not translated:
            logger.warning("本批没有得到可解析结果，保留原名: %s", ", ".join(names[:5]))
            translated = names
        for key, zh in zip(keys, translated):
            zh = str(zh).strip() or source[key]
            cache[key] = zh
        done += len(part)
        save_json(CACHE, cache)
        logger.info("进度: %s/%s", done, len(todo))

    output = {}
    for key, name in source.items():
        output[key] = cache.get(key, name)
    save_json(MOB_NAMES, output)
    logger.info("已写入中文怪物名: %s", MOB_NAMES)
    logger.info("翻译缓存: %s", CACHE)


if __name__ == "__main__":
    main()
