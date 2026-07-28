# -*- coding: utf-8 -*-
"""
离线批量预翻 —— 把见过的 NPC 英文原文提前翻好存进 npc_cache.json,
游戏时由 eco_npc_mitm 纯查表即时出中文, 不再临场调 API。

语料来源:
  npc_seen.json  —— eco_npc_mitm 运行时自动记录的「见过的英文原文」(精确 key, 与运行时查表完全一致)
用法:
  python pretranslate.py              # 翻 npc_seen.json 里还没翻过的, 增量补全
  python pretranslate.py --force      # 全部重翻(换了更好的模型时用)
  python pretranslate.py --from cache # 重翻已有 npc_cache.json 的所有 key(换服务商时用)
  python pretranslate.py --batch 60   # 每批条数(默认 40)
配置沿用 translate_config.json(配置工具生成), 与主程序同一套。
"""
import os, sys, json, time, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

RES_DIR, DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(DATA_DIR)
sys.path.insert(0, RES_DIR)
sys.path.append(r"C:\Users\31459\Documents\自动翻译")
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig
from eco_log import setup_logger

SOURCE_LANG, TARGET_LANG = "en", "zh-CN"
CONFIG_FILE = os.path.join(DATA_DIR, "translate_config.json")
CACHE_FILE  = os.path.join(DATA_DIR, "npc_cache.json")
SEEN_FILE   = os.path.join(DATA_DIR, "npc_seen.json")
logger = setup_logger(
    "eco.pretranslate",
    log_dir=log_dir(DATA_DIR),
    log_file="pretranslate.log",
)

def load_json(path, default):
    try: return json.load(open(path, encoding="utf-8"))
    except Exception: return default

def load_provider():
    cfg = load_json(CONFIG_FILE, None)
    if not cfg or not cfg.get("provider") or not cfg.get("model"):
        sys.exit("没有可用的翻译配置(translate_config.json)。先用配置工具填好服务商和模型。")
    if cfg["provider"] not in ("ollama", "echo") and not cfg.get("api_key"):
        sys.exit("该服务商需要 API Key, 但 translate_config.json 里没有。")
    return dict(provider=cfg["provider"], model=cfg["model"],
                base_url=cfg.get("base_url", ""), api_key=cfg.get("api_key", ""))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已翻过的也重翻(覆盖)")
    ap.add_argument("--from", dest="src", choices=["seen", "cache"], default="seen",
                    help="英文来源: seen=见过的语料(默认), cache=已有缓存的key(换服务商重翻)")
    ap.add_argument("--batch", type=int, default=40, help="每批翻译条数")
    args = ap.parse_args()

    cache = load_json(CACHE_FILE, {})
    provider = load_provider()

    # 先把共享词库拉下来合并(别人翻过的就不用再花 API 翻了)
    sync = None
    try:
        import cache_sync
        def _merge(d):
            n = 0
            for k, v in d.items():
                if k and v and k not in cache: cache[k] = v; n += 1
            return n
        # 用真实模型名上报，以便通过共享库可信模型门禁
        sync = cache_sync.Sync(DATA_DIR, TARGET_LANG, provider.get("model") or "?", _merge)
        if sync.enabled:
            logger.info("先拉取共享词库...")
            sync._pull_once()
            json.dump(cache, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception as e:
        logger.warning("共享词库不可用(忽略): %s", e)
        sync = None

    if args.src == "seen":
        keys = load_json(SEEN_FILE, [])
        if not keys:
            logger.warning("npc_seen.json 为空。先用新版 eco_npc_mitm 跟 NPC 对几句话, 它会自动记录语料, 再回来运行本脚本。")
            return
    else:
        keys = list(cache.keys())

    todo = [k for k in keys if k and (args.force or k not in cache)]
    logger.info("语料来源: %s  总计 %s 条  待翻 %s 条  (已缓存 %s)",
                args.src, len(keys), len(todo), len(keys) - len(todo))
    if not todo:
        logger.info("没有需要翻译的, 缓存已是最新。")
        return

    eng = create_translator(TranslationConfig(**provider))
    t0 = time.time(); done = 0; bs = max(1, args.batch)
    for i in range(0, len(todo), bs):
        chunk = todo[i:i+bs]
        try:
            outs = eng.translate_many(chunk, SOURCE_LANG, TARGET_LANG)
        except Exception as e:
            logger.error("  批 %s 失败(%s), 跳过", i // bs + 1, e)
            continue
        for src, out in zip(chunk, outs):
            out = (out or "").strip()
            if out:
                cache[src] = out; done += 1
                if sync and sync.enabled: sync.enqueue(src, out)     # 上报共享词库
        json.dump(cache, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)  # 每批落盘, 断了也不丢
        if sync and sync.enabled: sync._flush_once()
        logger.info("  进度 %s/%s  已写入 %s  用时 %.0fs",
                    min(i + bs, len(todo)), len(todo), done, time.time() - t0)

    if sync and sync.enabled:               # 收尾: 全量补传(含被跳过/命中缓存现已翻的) + 排空队列
        sync.push_all(cache)
        for _ in range(50):
            with sync.qlock: rest = len(sync.q)
            if not rest: break
            sync._flush_once()
    logger.info("完成: 新翻 %s 条 -> %s  共用时 %.0fs", done, CACHE_FILE, time.time() - t0)

if __name__ == "__main__":
    main()
