# -*- coding: utf-8 -*-
"""
Stage B (方案A): recvfrom 进程内改包, 把 NPC 对话英文替换成中文, 重加密写回 -> 游戏原生框显示中文
  * _mitm.js: 内置 AES-128-ECB(已验证), recvfrom 当场解密/重建/重加密
  * 缓存门控: 命中缓存的对话即时改中文; 未命中放行英文 + 后台翻译入缓存(下次生效)
  * 翻译复用 自动翻译/screen_translator, 带磁盘缓存
用法: python eco_npc_mitm.py   (eco.exe 在线; 首次见到的对话英文, 再次见到变中文)
"""
import argparse
import os, sys, json, time, threading, re, queue

# Electron reads child-process output as UTF-8. Frozen Python otherwise uses
# the current Windows console code page (usually GBK on Chinese systems).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass

# 资源目录(只读, 打包后在临时解包目录) 与 数据目录(可写, exe 同目录)
if os.environ.get("ECO_DATA_DIR"):
    RES_DIR = sys._MEIPASS if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    DATA_DIR = os.environ["ECO_DATA_DIR"]
elif getattr(sys, "frozen", False):
    RES_DIR = sys._MEIPASS
    DATA_DIR = os.path.dirname(sys.executable)
else:
    RES_DIR = DATA_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(DATA_DIR, exist_ok=True)
HERE = DATA_DIR
sys.path.insert(0, RES_DIR)                           # 优先用随程序打包的 screen_translator
sys.path.append(r"C:\Users\31459\Documents\自动翻译")  # 后备: 开发机原路径
import frida
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig

SOURCE_LANG = "en"; TARGET_LANG = "zh-CN"
CONFIG_FILE = os.path.join(DATA_DIR, "translate_config.json")   # 由配置工具生成(exe 同目录)
def load_provider():
    """从 translate_config.json 读取翻译服务配置; 不存在/不完整返回 None"""
    try:
        cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
    except Exception:
        return None
    if not cfg.get("provider") or not cfg.get("model"):
        return None
    # ollama 等本地服务无需 key; 其余必须有 key
    if cfg["provider"] not in ("ollama", "echo") and not cfg.get("api_key"):
        return None
    return dict(provider=cfg["provider"], model=cfg["model"],
                base_url=cfg.get("base_url", ""), api_key=cfg.get("api_key", ""))
PROVIDER = load_provider()
CACHE_FILE = os.path.join(DATA_DIR, "npc_cache.json")
MAP_PORT = 12002
SEG_MAX = 240            # 每段中文 UTF-8 字节上限 (段长用1字节, <255)
SYNC_FIRST = True        # True: 命中缓存的对话同帧改中文(纯查表, 不阻塞游戏)
# 命中缓存即时出中文; 未命中时:
#   FIRST_WAIT > 0  : 最多扣住游戏 FIRST_WAIT 秒等翻译, 抢"第一次就中文"(略停顿), 超时放行英文+后台回填
#   FIRST_WAIT <= 0 : 不等待, 第一次直接放行英文, 后台翻译, 第二次才中文(完全不卡)
# 默认 0(安全, 绝不扣线程不会被踢)。想抢第一次中文可在配置里调小值(<=1.0), 但有掉线风险。
FIRST_WAIT = 0
try:
    _cfg0 = json.load(open(CONFIG_FILE, encoding="utf-8"))
    FIRST_WAIT = float(_cfg0.get("first_wait", FIRST_WAIT))     # 可在配置工具里改
    TARGET_LANG = _cfg0.get("target_lang", TARGET_LANG)         # 简体 zh-CN / 繁体 zh-TW
except Exception: pass
SEEN_FILE = os.path.join(DATA_DIR, "npc_seen.json")   # 见过的英文原文语料(供离线预翻 pretranslate.py 用)

# 翻译缓存
try: CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception: CACHE = {}
clock = threading.Lock()
def cache_put(k, v):
    with clock:
        CACHE[k] = v
        try: json.dump(CACHE, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception: pass

# 共享词库同步(可选): 自动上报本地新译文 + 自动拉取别人贡献
def _merge_pulled(d):
    """把拉到的 {英文:中文} 合并进本地缓存(本地已有的不覆盖, 先到先得), 落盘, 返回新增数。"""
    new = 0
    with clock:
        for k, v in d.items():
            if k and v and k not in CACHE:
                CACHE[k] = v; new += 1
        if new:
            try: json.dump(CACHE, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
            except Exception: pass
    return new
try:
    import cache_sync
    SYNC = cache_sync.Sync(DATA_DIR, TARGET_LANG, (PROVIDER or {}).get("model", "?"), _merge_pulled)
except Exception as _e:
    print("[同步] 模块加载失败(忽略, 仅本地):", _e, flush=True); SYNC = None
# 见过的英文原文语料(去重落盘, 供离线批量预翻 pretranslate.py 使用)
try: SEEN = set(json.load(open(SEEN_FILE, encoding="utf-8")))
except Exception: SEEN = set()
seen_lock = threading.Lock()
def record_seen(texts):
    new = False
    with seen_lock:
        for t in texts:
            if t and t not in SEEN: SEEN.add(t); new = True
        if new:
            try: json.dump(sorted(SEEN), open(SEEN_FILE, "w", encoding="utf-8"), ensure_ascii=False)
            except Exception: pass

_tr = {"v": None}
def _engine():
    if _tr["v"] is None: _tr["v"] = create_translator(TranslationConfig(**PROVIDER))
    return _tr["v"]
def translate(text, cache_only=False):
    with clock: c = CACHE.get(text)
    if c: return c
    if cache_only: return None          # 纯查表: 未命中不调 API, 交给后台
    out = (_engine().translate(text, SOURCE_LANG, TARGET_LANG) or "").strip()
    if out:
        cache_put(text, out)
        if SYNC: SYNC.enqueue(text, out)         # 本地新译文 -> 上报共享词库
    return out
def translate_batch(texts, cache_only=False):
    """批量翻译(缓存命中跳过, 未命中一次 API 调用), 返回与 texts 等长的中文列表。
       cache_only=True 时未命中处保留 None, 不调用 API。"""
    res = [None] * len(texts); miss = []
    for i, t in enumerate(texts):
        with clock: c = CACHE.get(t)
        if c: res[i] = c
        else: miss.append(i)
    if miss and not cache_only:
        outs = _engine().translate_many([texts[i] for i in miss], SOURCE_LANG, TARGET_LANG)
        for j, i in enumerate(miss):
            o = ((outs[j] if j < len(outs) else "") or "").strip()
            res[i] = o
            if o:
                cache_put(texts[i], o)
                if SYNC: SYNC.enqueue(texts[i], o)
    return res

def clean_from_subdata(sub):
    s = sub[2:].decode("utf-8", "replace")
    runs = [r.strip() for r in re.findall(r"[^\x00-\x1f�]{2,}", s) if r.strip()]
    if not runs: return None, None
    name = runs[-1] if len(runs) > 1 else ""
    dia = " ".join(runs[:-1]) if len(runs) > 1 else runs[0]
    dia = dia.replace("$R", "\n").replace("$P", "\n")
    dia = re.sub(r"\$[A-Za-z]", "", dia); dia = re.sub(r"[ \t]+", " ", dia)
    dia = re.sub(r"\n[ \t]+", "\n", dia).strip()
    return dia, name

def split_utf8(s, maxb):
    out = []; cur = b""
    for ch in s:
        cb = ch.encode("utf-8")
        if len(cur) + len(cb) > maxb: out.append(cur); cur = b""
        cur += cb
    if cur: out.append(cur)
    return out

def wrap_cjk(s, max_units=20):
    """按显示宽度折行: 每段≈一行(全角=1, 半角=0.5), 避免游戏框内自动折行导致重叠"""
    lines = []
    for raw in s.split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        cur = ""; w = 0.0
        for ch in raw:
            cw = 1.0 if ord(ch) > 0x2e80 else 0.5
            if w + cw > max_units and cur:
                lines.append(cur); cur = ""; w = 0.0
            cur += ch; w += cw
        if cur:
            lines.append(cur)
    return lines

def _clean_text(t):
    t = t.replace("$R", "\n").replace("$P", "\n")
    t = re.sub(r"\$[A-Za-z]", "", t); t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n[ \t]+", "\n", t).strip()

# ===== 玩家角色名识别/模板化 =====
# 对话里服务器会把你的角色名(pc.Name)替进去, 如 "Welcome back, sakiqaq."
# 这种句子每个玩家都不同, 直接缓存/上报会污染词库且永不命中。
# 做法: 把角色名换成占位符 {PC} 再翻译/缓存/共享, 显示时填回真名。
# 译文里的 {PC} 跨玩家通用, 一次翻译人人可用。
PC_TOKEN = "{PC}"
def _load_player_names():
    names = []
    try:
        cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
        pn = cfg.get("player_names") or cfg.get("player_name")
        if isinstance(pn, str): names = [pn]
        elif isinstance(pn, list): names = list(pn)
    except Exception: pass
    try:                                  # 兼容独立文件 player_names.json (一个字符串数组)
        extra = json.load(open(os.path.join(DATA_DIR, "player_names.json"), encoding="utf-8"))
        if isinstance(extra, list): names += list(extra)
        elif isinstance(extra, str): names.append(extra)
    except Exception: pass
    seen = []
    for n in names:
        n = str(n).strip()
        if n and n not in seen: seen.append(n)
    return seen
PLAYER_NAMES = _load_player_names()
_NAMEPAT = (re.compile("|".join(re.escape(n) for n in
            sorted(PLAYER_NAMES, key=len, reverse=True))) if PLAYER_NAMES else None)
if PLAYER_NAMES:
    print(f"[玩家名] 已加载 {len(PLAYER_NAMES)} 个角色名, 对话中将模板化为 {PC_TOKEN}: {PLAYER_NAMES}", flush=True)

def templatize(text):
    """把角色名替换成 {PC}; 返回 (模板文本, 命中的真实名 or None)。未配置名字则原样返回。"""
    if not _NAMEPAT or not text: return text, None
    hit = {"n": None}
    def _sub(m): hit["n"] = m.group(0); return PC_TOKEN
    return _NAMEPAT.sub(_sub, text), hit["n"]

def untemplatize(text, name):
    """显示前把 {PC} 填回真实角色名。"""
    if name and text and PC_TOKEN in text: return text.replace(PC_TOKEN, name)
    return text

def rebuild_1017(sub, cache_only=False):
    """[op2][npc4][flag2][segN1]{[len1][seg]}*N [motion2][nameLen1][name..pad] -> 中文"""
    op, npc, flag = sub[0:2], sub[2:6], sub[6:8]
    p = 8; segN = sub[p]; p += 1; segs = []
    for _ in range(segN):
        l = sub[p]; p += 1; segs.append(sub[p:p+l]); p += l
    tail = sub[p:]                      # motion2 + nameLen1 + name + padding
    eng = _clean_text("".join(s.decode("utf-8", "replace") for s in segs))
    eng_key, pcname = templatize(eng)                # 角色名 -> {PC}, 模板化后翻译/缓存/共享
    if not cache_only: record_seen([eng_key])
    zh = translate(eng_key, cache_only)
    if not zh: return None
    zh = untemplatize(zh, pcname)                     # 显示前把真名填回
    lines = wrap_cjk(zh, 20)                          # 每段一行, 防止框内折行重叠
    chunks = [ln.encode("utf-8")[:250] for ln in lines]
    out = bytearray(op + npc + flag); out.append(len(chunks) & 0xff)
    for c in chunks: out.append(len(c) & 0xff); out += c
    out += tail
    return bytes(out)

def rebuild_1526(sub, cache_only=False):
    """[op2][qlen1][question(含null)][optCount1][indices(optCount+1)]{[len1][opt]}*N [tail] -> 中文
       indices 是点击->动作映射, 原样保留; 只译问题与选项文字"""
    op = sub[0:2]; p = 2
    qlen = sub[p]; p += 1
    question = sub[p:p+qlen]; p += qlen
    optCount = sub[p]; p += 1
    indices = sub[p:p+optCount+1]; p += optCount + 1
    opts = []
    for _ in range(optCount):
        l = sub[p]; p += 1; opts.append(sub[p:p+l]); p += l
    tail = sub[p:]                       # 01 + padding
    q_eng = question.split(b"\0")[0].decode("utf-8", "replace").strip()
    opt_eng = [o.decode("utf-8", "replace").strip() for o in opts]
    texts = [q_eng] + opt_eng
    keyed = [templatize(t) for t in texts]            # [(模板, 真名), ...]
    keys = [k for k, _ in keyed]; pcnames = [n for _, n in keyed]
    if not cache_only: record_seen(keys)
    zhs = translate_batch(keys, cache_only)           # 一次 API 调用翻问题+所有选项(模板化)
    if cache_only and any(z is None for z in zhs): return None    # 任一未命中则整条不出, 交后台
    disp = [untemplatize(zhs[i] or texts[i], pcnames[i]) for i in range(len(texts))]   # 填回真名
    q_zh = disp[0].encode("utf-8")[:250]
    opt_zh = [disp[1+i].encode("utf-8")[:250] for i in range(len(opts))]
    out = bytearray(op)
    out.append((len(q_zh) + 1) & 0xff); out += q_zh; out.append(0)   # qlen 含 null
    out.append(optCount); out += indices
    for oz in opt_zh: out.append(len(oz) & 0xff); out += oz
    out += tail
    return bytes(out)

# ===== 内置采集器(并入 MITM, 取代单独的 eco_harvester) =====
# JS 会把 op1500/1501/1511/1512(上下文) 和 op1017/1526 的英文原文额外上报;
# 这里后台线程消费这些消息, 按 eventid 聚合, 产出 harvest_dict.json + harvest.jsonl。
# 全程走后台队列, 不阻塞翻译回包(避免扣住游戏网络线程被踢)。
HARVEST_JL = os.path.join(DATA_DIR, "harvest.jsonl")
HARVEST_DICT = os.path.join(DATA_DIR, "harvest_dict.json")
_hq = queue.Queue()

def _parse_1017_harvest(sub):
    """[op2][actor4][flag2][segN1]{[len1][seg]}*N [motion2][nameLen1][name..] -> (actor, name, 英文)"""
    try:
        actor = int.from_bytes(sub[2:6], "big")
        p = 8; segN = sub[p]; p += 1; segs = []
        for _ in range(segN):
            l = sub[p]; p += 1; segs.append(sub[p:p+l]); p += l
        tail = sub[p:]; name = ""
        if len(tail) >= 3:
            nl = tail[2]; name = tail[3:3+nl].decode("utf-8", "replace").split("\0")[0].strip()
        en = _clean_text("".join(s.decode("utf-8", "replace") for s in segs))
        return actor, name, en
    except Exception:
        return None, "", ""

def _parse_1526_harvest(sub):
    """[op2][qlen1][question(含null)][optCount1][indices(optCount+1)]{[len1][opt]}*N -> (问题, 选项[])"""
    try:
        p = 2; qlen = sub[p]; p += 1
        question = sub[p:p+qlen].split(b"\0")[0].decode("utf-8", "replace").strip(); p += qlen
        optCount = sub[p]; p += 1; p += optCount + 1          # 跳过 indices
        opts = []
        for _ in range(optCount):
            l = sub[p]; p += 1; opts.append(sub[p:p+l].decode("utf-8", "replace").strip()); p += l
        return question, opts
    except Exception:
        return "", []

class _Harvest:
    def __init__(self):
        self.cur_event = None; self.cur_npc_id = None
        self.last_event_by_actor = {}
        self.seen = set(); self.agg = {}
        self.n_say = self.n_sel = 0; self.dirty = False
        try: self.agg = json.load(open(HARVEST_DICT, encoding="utf-8"))
        except Exception: self.agg = {}
        # 从已有产物重建去重集, 避免重启后把同一句重复追加
        for k, e in self.agg.items():
            for s in e.get("says", []): self.seen.add((k, "say", s))
            for sel in e.get("selects", []):
                self.seen.add((k, "sel", (sel.get("q", "") + "|" + "|".join(sel.get("options", [])))))

    def _entry(self, eid):
        k = str(eid)
        if k not in self.agg: self.agg[k] = {"npc": "", "says": [], "selects": []}
        return self.agg[k]

    def _append_jl(self, rec):
        try:
            with open(HARVEST_JL, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception: pass

    def feed(self, op, sub):
        if op == 1500: self.cur_event = None; self.cur_npc_id = None; return
        if op == 1501: return
        if op == 1511:
            if len(sub) >= 6: self.cur_npc_id = int.from_bytes(sub[2:6], "big")
            return
        if op == 1512:
            if len(sub) >= 10:
                actor = int.from_bytes(sub[2:6], "big"); eid = int.from_bytes(sub[6:10], "big")
                self.last_event_by_actor[actor] = eid; self.cur_event = eid
            return
        if op == 1017:
            actor, name, en = _parse_1017_harvest(sub)
            if not en: return
            eid = self.cur_event or self.last_event_by_actor.get(actor) or actor
            k = str(eid); key = (k, "say", en)
            if key in self.seen: return
            self.seen.add(key)
            self._append_jl({"eventid": eid, "actor": actor, "npc": name, "kind": "say",
                             "en": en, "ts": int(time.time())})
            e = self._entry(eid)
            if name and not e["npc"]: e["npc"] = name
            e["says"].append(en); self.dirty = True; self.n_say += 1
            print(f"[采集·say] eid={eid} npc={name!r} | {en[:50]!r}", flush=True)
        elif op == 1526:
            q, opts = _parse_1526_harvest(sub)
            if not q and not opts: return
            eid = self.cur_event or self.cur_npc_id
            k = str(eid); key = (k, "sel", q + "|" + "|".join(opts))
            if key in self.seen: return
            self.seen.add(key)
            self._append_jl({"eventid": eid, "kind": "select", "en": q, "options": opts,
                             "ts": int(time.time())})
            e = self._entry(eid); e["selects"].append({"q": q, "options": opts})
            self.dirty = True; self.n_sel += 1
            print(f"[采集·sel] eid={eid} | {q[:40]!r} 选项{opts}", flush=True)

    def flush(self):
        if self.dirty:
            try:
                json.dump(self.agg, open(HARVEST_DICT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
                self.dirty = False
            except Exception: pass

def _harvest_worker():
    h = _Harvest(); last_flush = time.time()
    while True:
        try:
            item = _hq.get(timeout=2.0)
            if item is not None:
                op, sub = item
                try: h.feed(op, sub)
                except Exception: import traceback; traceback.print_exc()
        except queue.Empty:
            pass
        if h.dirty and time.time() - last_flush >= 3.0:
            h.flush(); last_flush = time.time()

JS = (open(os.path.join(RES_DIR, "_mitm.js"), encoding="utf-8").read()
      .replace("__MAP_PORT__", str(MAP_PORT))
      .replace("__SYNC__", "true" if SYNC_FIRST else "false"))

sref = {"s": None}
_dlg = {"pages": 0, "menu": False}   # 当前对话状态: 页数(op1017计数) + 是否含选项菜单
def handler(msg, data):
    if msg.get("type") != "send":
        if msg.get("type") == "error": print("[JS ERR]", msg.get("stack"), flush=True)
        return
    p = msg["payload"]
    if p == "READY":
        print("[*] hook 就位。去和 NPC 对话：首次显英文(并后台翻译缓存)，再次见到同一句即变中文。", flush=True); return
    t = p.get("t")
    if t == "ctx" or t == "harvest":          # 采集消息: 丢后台队列, 绝不阻塞翻译回包
        op = p.get("op")
        if op == 1500:   _dlg["pages"] = 0; _dlg["menu"] = False   # 事件开始: 重置本段对话
        elif op == 1017: _dlg["pages"] += 1                        # 每页一个 op1017
        elif op == 1526: _dlg["menu"] = True                       # 含选项菜单
        try: _hq.put_nowait((op, bytes.fromhex(p["sub"])))
        except Exception: pass
        return
    if p.get("t") == "need":
        sub = bytes.fromhex(p["sub"]); h = p["h"]; op = p.get("op"); sync = p.get("sync")
        tag = "选项菜单" if op == 1526 else "对话"
        if sync:
            # 1) 先纯查表: 命中缓存→同帧出中文(毫秒级)
            try: newsub = rebuild_1526(sub, cache_only=True) if op == 1526 else rebuild_1017(sub, cache_only=True)
            except Exception: import traceback; traceback.print_exc(); newsub = None
            cached_hit = newsub is not None
            # 2) 未命中 且 开了短等待: 在 FIRST_WAIT 内抢翻出来, 第一次就中文
            if newsub is None and FIRST_WAIT > 0:
                res = {}
                def do():
                    try: res["s"] = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
                    except Exception: import traceback; traceback.print_exc()
                th = threading.Thread(target=do); th.start(); th.join(FIRST_WAIT)
                newsub = res.get("s")
                if newsub is None:           # 超时: 放行英文, 后台翻完回填(下次生效)
                    def finish_to():
                        th.join(); ns = res.get("s")
                        if ns:
                            try: sref["s"].post({"type": "cache", "h": h, "sub": ns.hex()})
                            except Exception: pass
                            print(f"[缓存+](超时,下次生效) op{op}({tag}) hash={h}", flush=True)
                    threading.Thread(target=finish_to, daemon=True).start()
            # 3) 回复 JS(中文 or 空=放行英文)
            try: sref["s"].post({"type": "t%d" % h, "sub": newsub.hex() if newsub else ""})
            except Exception: pass
            if newsub:
                tagdesc = "缓存" if cached_hit else "现翻"
                print(f"[首屏中文·{tagdesc}] op{op}({tag}) hash={h} ({len(newsub)}B)", flush=True)
            elif FIRST_WAIT <= 0:            # 不等待模式: 后台翻译回填
                def finish_bg():
                    try: ns = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
                    except Exception: import traceback; traceback.print_exc(); return
                    if not ns: return
                    try: sref["s"].post({"type": "cache", "h": h, "sub": ns.hex()})
                    except Exception: return
                    print(f"[缓存+](下次生效) op{op}({tag}) hash={h}", flush=True)
                threading.Thread(target=finish_bg, daemon=True).start()
        else:
            def work():
                try: newsub = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
                except Exception: import traceback; traceback.print_exc(); return
                if not newsub: return
                try: sref["s"].post({"type": "cache", "h": h, "sub": newsub.hex()})
                except Exception: return
                print(f"[缓存+] op{op}({tag}) hash={h} ({len(newsub)}B)", flush=True)
            threading.Thread(target=work, daemon=True).start()
    elif p.get("t") == "hit":
        print(f"[改包✓] 已替换为中文 hash={p['h']}", flush=True)

def warmup():
    """开机预热: 提前建好 openai 客户端 + 完成首次 TLS 握手, 让第一句真实对话不吃冷启动"""
    try:
        t0 = time.time()
        _engine().translate("Hello.", SOURCE_LANG, TARGET_LANG)
        print(f"[*] 引擎预热完成 ({time.time()-t0:.1f}s)", flush=True)
    except Exception as e:
        print("[*] 预热失败(忽略):", e, flush=True)

def main():
    parser = argparse.ArgumentParser(description="ECO NPC 实时翻译")
    parser.add_argument("--pid", type=int, help="要连接的 eco.exe 进程编号")
    args = parser.parse_args()

    if not PROVIDER:
        print("=" * 50, flush=True)
        print(" 还没有配置翻译服务 (或缺少 API Key)。", flush=True)
        if os.environ.get("ECO_DATA_DIR"):
            print(" 请在 ECO 工具箱的“设置 -> 翻译服务”中完成配置。", flush=True)
            print(" 保存后重新启动 NPC 翻译即可。", flush=True)
            print("=" * 50, flush=True)
            return
        print(" 正在打开配置工具，请选择服务商并填入 API Key 后保存。", flush=True)
        print(" 保存后重新启动本程序即可。", flush=True)
        print("=" * 50, flush=True)
        try:
            import subprocess
            if getattr(sys, "frozen", False):
                subprocess.Popen([os.path.join(DATA_DIR, "eco_settings.exe")])
            else:
                subprocess.Popen([sys.executable, os.path.join(RES_DIR, "eco_settings.py")])
        except Exception as e:
            print("打开配置工具失败，请手动双击 配置翻译.cmd:", e, flush=True)
        return
    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos: print("没有运行中的 eco.exe"); return
    if args.pid is not None:
        selected = next((process for process in ecos if process.pid == args.pid), None)
        if selected is None:
            print(f"指定的 eco.exe 进程不存在（进程 {args.pid}）", flush=True)
            return 2
        pid = selected.pid
    else:
        pid = max(ecos, key=lambda process: process.pid).pid

    threading.Thread(target=warmup, daemon=True).start()
    threading.Thread(target=_harvest_worker, daemon=True).start()   # 内置采集器(后台)
    print("[*] 内置采集器已启动: 边翻译边按 eventid 攒字典 -> harvest_dict.json", flush=True)
    if SYNC:
        SYNC.start()                       # 启动共享词库同步(拉取+定时上报)
        SYNC.push_all(CACHE)               # 把整个本地缓存补传一遍(含被跳过翻译/命中缓存的)
    print("[*] attach", pid, flush=True)
    s = dev.attach(pid)
    sref["s"] = s.create_script(JS); sref["s"].on("message", handler); sref["s"].load()
    setup_hotkey()
    while True: time.sleep(1)

_state = {"on": True}
def toggle():
    _state["on"] = not _state["on"]
    try: sref["s"].post({"type": "toggle", "on": _state["on"]})
    except Exception: pass
    print(f"[切换] 当前显示: {'中文' if _state['on'] else '英文原文'}", flush=True)

def skip_dialogue():
    """一键跳过整段对话: 按当前页数发等量 Enter, 刚好翻到底关掉(不多按, 不会误开聊天框)。
    翻页是纯客户端的(不发包), 所以靠模拟 Enter; 含选项菜单时停手, 留你手动选。"""
    try: import keyboard
    except Exception: return
    if _dlg["menu"]:
        print("[跳过] 当前对话含选项菜单, 不自动选, 请手动。", flush=True); return
    n = _dlg["pages"]
    if n <= 0:
        print("[跳过] 当前没检测到打开的对话(没收到 op1017)。", flush=True); return
    for _ in range(n):
        keyboard.press_and_release("enter"); time.sleep(0.04)
    _dlg["pages"] = 0                       # 跳过后清零, 防止再按时多发 Enter 误开聊天
    print(f"[跳过] 已发 {n} 次 Enter 跳过整段对话。", flush=True)

def setup_hotkey():
    try:
        import keyboard
    except Exception as e:
        print("[*] 热键不可用(忽略):", e, flush=True); return
    try:
        cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
    except Exception:
        cfg = {}
    hk = (cfg.get("toggle_hotkey") or "f9").strip()
    if hk:
        try: keyboard.add_hotkey(hk, toggle); print(f"[*] 热键就绪: 按 {hk.upper()} 在 中文/英文 之间切换", flush=True)
        except Exception as e: print("[*] 切换热键注册失败:", e, flush=True)
    else:
        print("[*] 中/英切换热键已关闭", flush=True)
    sk = (cfg.get("skip_hotkey", "f8") or "").strip()
    if sk:
        try: keyboard.add_hotkey(sk, skip_dialogue); print(f"[*] 跳过热键就绪: 按 {sk.upper()} 一键跳过整段对话(菜单不动)", flush=True)
        except Exception as e: print("[*] 跳过热键注册失败:", e, flush=True)
    else:
        print("[*] 一键跳过对话热键已关闭", flush=True)

if __name__ == "__main__":
    raise SystemExit(main())
