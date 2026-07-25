# -*- coding: utf-8 -*-
"""
eid + 语义对齐: 把采到的英文(harvest_dict.json)和仓库繁中(npc_dict.json)按 eid 配对,
同 eid 内按语义(非位置)匹配, 命中用仓库官方译文(繁->简), 否则机翻兜底。
产出 英文->简中 进 npc_cache.json (+ 共享词库), 并写对账报告 align_report.txt。

用法:
  python align_repo.py                # 全量对齐
  python align_repo.py --dry          # 只出报告, 不写缓存/不上报
  python align_repo.py --limit 50     # 最多处理 50 个 eid (控制 API 量)
  python align_repo.py --no-sync      # 不上报共享词库
依赖: DeepSeek 配置(translate_config.json) 做"搭桥比对"; OpenCC(可选)做繁->简。
"""
import os, sys, json, re, time, argparse, difflib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.append(r"C:\Users\31459\Documents\自动翻译")
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

_RES_DIR, HERE = resolve_dirs(__file__)
ensure_data_layout(HERE)
SRC, TGT = "en", "zh-CN"
CONFIG = os.path.join(HERE, "translate_config.json")
HARVEST = os.path.join(HERE, "harvest_dict.json")
REPO = os.path.join(HERE, "npc_dict.json")
CACHE = os.path.join(HERE, "npc_cache.json")
BRIDGE = os.path.join(HERE, "bridge_cache.json")     # 英文->机翻简中(搭桥+兜底, 持久化省 API)
REPORT = os.path.join(HERE, "align_report.txt")
THRESH_SEL = 0.45      # 菜单整组平均相似度阈值
THRESH_SAY = 0.50      # 单句相似度阈值
logger = setup_logger(
    "eco.align_repo",
    log_dir=log_dir(HERE),
    log_file="align_repo.log",
)

def loadj(p, d):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return d

# ---- 繁->简 ----
try:
    import opencc
    _cc = opencc.OpenCC("t2s")
    def to_simp(t): return _cc.convert(t)
    OPENCC = True
except Exception:
    def to_simp(t): return t
    OPENCC = False

# ---- 日文检测(假名) ----
def is_jp(t): return bool(re.search(r"[぀-ゟ゠-ヿ]", t or ""))

# ---- 相似度(简体对简体) ----
def sim(a, b): return difflib.SequenceMatcher(None, a or "", b or "").ratio()

# ---- 玩家名模板化 ----
PC = "{PC}"
_names = loadj(os.path.join(HERE, "player_names.json"), [])
_npat = re.compile("|".join(re.escape(n) for n in sorted(_names, key=len, reverse=True))) if _names else None
def tmpl(t):
    return _npat.sub(PC, t) if (_npat and t) else t

# ---- 搭桥/兜底机翻(带持久缓存) ----
_bridge = loadj(BRIDGE, {})
_engine = {"v": None}
def engine():
    if _engine["v"] is None:
        cfg = loadj(CONFIG, None)
        if not cfg: sys.exit("缺 translate_config.json")
        _engine["v"] = create_translator(TranslationConfig(
            provider=cfg["provider"], model=cfg["model"],
            base_url=cfg.get("base_url", ""), api_key=cfg.get("api_key", "")))
    return _engine["v"]
def bridge_many(texts):
    """英文列表 -> 简中(机翻), 命中 bridge 缓存则跳过。返回 dict。"""
    miss = [t for t in texts if t and t not in _bridge]
    miss = list(dict.fromkeys(miss))
    if miss:
        outs = engine().translate_many(miss, SRC, TGT)
        for t, o in zip(miss, outs):
            o = (o or "").strip()
            if o: _bridge[t] = o
        json.dump(_bridge, open(BRIDGE, "w", encoding="utf-8"), ensure_ascii=False)
    return {t: _bridge.get(t, "") for t in texts}

def best_select(en_opts_mt, repo_selects):
    """在选项数相同的仓库菜单里找平均相似度最高的; 返回 (repo_sel, score)。"""
    best, bs = None, 0.0
    for rs in repo_selects:
        ro = rs.get("options", [])
        if len(ro) != len(en_opts_mt): continue
        ro_s = [to_simp(x) for x in ro]
        if any(is_jp(x) for x in ro_s): continue
        s = sum(sim(a, b) for a, b in zip(en_opts_mt, ro_s)) / max(1, len(ro_s))
        if s > bs: best, bs = rs, s
    return best, bs

def best_say(en_mt, repo_say_simp):
    best, bs = None, 0.0
    for rs in repo_say_simp:
        s = sim(en_mt, rs)
        if s > bs: best, bs = rs, s
    return best, bs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-sync", action="store_true")
    ap.add_argument("--thresh-sel", type=float, default=THRESH_SEL)
    ap.add_argument("--thresh-say", type=float, default=THRESH_SAY)
    args = ap.parse_args()

    harvest = loadj(HARVEST, {})
    repo = loadj(REPO, {})
    cache = loadj(CACHE, {})
    if not OPENCC:
        logger.warning("[!] 未装 OpenCC, 官方译文将保留繁体(且繁简差异会拉低匹配率)。pip install opencc 更佳。")

    rep = []          # 报告行
    emit = {}         # 英文(模板化) -> 简中
    stat = dict(eid=0, no_repo=0, jp=0, sel_hit=0, sel_mt=0, say_hit=0, say_mt=0)

    eids = [e for e in harvest if e not in ("None", None)]
    if args.limit: eids = eids[:args.limit]
    for eid in eids:
        h = harvest[eid]; r = repo.get(str(eid))
        if not r:
            stat["no_repo"] += 1
            rep.append(f"■ eid={eid} npc={h.get('npc')!r} → 仓库无, 全部机翻")
            # 仍机翻兜底
            texts = list(h.get("says", [])) + [h2 for se in h.get("selects", []) for h2 in [se["q"]] + se["options"]]
            mt = bridge_many(texts)
            for t in texts:
                if t and mt.get(t): emit[tmpl(t)] = tmpl(mt[t]);
            continue
        stat["eid"] += 1
        repo_says = r.get("says", []); repo_sels = r.get("selects", [])
        repo_say_simp = [to_simp(s["text"]) for s in repo_says if not is_jp(s["text"])]
        rep.append(f"\n■ eid={eid} EN={h.get('npc')!r} 仓库={r.get('npc')} (仓库 say={len(repo_says)} sel={len(repo_sels)})")

        # ---- 先批量搭桥翻译本 eid 的所有英文 ----
        all_en = list(h.get("says", []))
        for se in h.get("selects", []): all_en += [se["q"]] + se["options"]
        mt = bridge_many([t for t in all_en if t])

        # ---- 菜单 ----
        for se in h.get("selects", []):
            opts = se["options"]; q = se["q"]
            en_opts_mt = [mt.get(o, "") for o in opts]
            rs, score = best_select(en_opts_mt, repo_sels)
            if rs and score >= args.thresh_sel:
                stat["sel_hit"] += 1
                emit[tmpl(q)] = tmpl(to_simp(rs.get("title", "")) or mt.get(q, ""))
                for o, ro in zip(opts, rs["options"]):
                    emit[tmpl(o)] = tmpl(to_simp(ro))
                rep.append(f"  [菜单✓ {score:.2f}] {q[:24]} ↔ {to_simp(rs.get('title',''))[:24]}")
            else:
                stat["sel_mt"] += 1
                emit[tmpl(q)] = tmpl(mt.get(q, q))
                for o in opts: emit[tmpl(o)] = tmpl(mt.get(o, o))
                rep.append(f"  [菜单·机翻 best={score:.2f}] {q[:24]}")

        # ---- 对话 ----
        for s in h.get("says", []):
            m = mt.get(s, "")
            rs, score = best_say(m, repo_say_simp)
            if rs and score >= args.thresh_say:
                stat["say_hit"] += 1
                emit[tmpl(s)] = tmpl(rs)
                rep.append(f"  [对话✓ {score:.2f}] {s[:30]} ↔ {rs[:30]}")
            else:
                stat["say_mt"] += 1
                if m: emit[tmpl(s)] = tmpl(m)
                rep.append(f"  [对话·机翻 best={score:.2f}] {s[:30]}")

    # ---- 写出 ----
    rep.append(f"\n=== eid命中仓库 {stat['eid']}, 仓库无 {stat['no_repo']}；"
               f"菜单 官方{stat['sel_hit']}/机翻{stat['sel_mt']}；对话 官方{stat['say_hit']}/机翻{stat['say_mt']} ===")
    open(REPORT, "w", encoding="utf-8").write("\n".join(rep))
    if rep:
        logger.info("%s", rep[-1])
    logger.info("报告 -> %s  共产出 %s 条", REPORT, len(emit))

    if args.dry:
        logger.info("[dry] 未写缓存/未上报。")
        return
    cache.update(emit)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    logger.info("已并入 npc_cache.json, 现 %s 条", len(cache))

    if not args.no_sync:
        try:
            import cache_sync
            s = cache_sync.Sync(HERE, TGT, "align_repo", lambda d: 0)
            if s.enabled:
                s.push_all(cache)            # 全量上报: 本次产出 + 以前被跳过/没上报但现已翻的
                for _ in range(50):
                    with s.qlock:
                        if not s.q: break
                    s._flush_once()
                logger.info("已上报共享词库。")
        except Exception as e:
            logger.warning("上报跳过: %s", e)

if __name__ == "__main__":
    main()
