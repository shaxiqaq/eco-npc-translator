# -*- coding: utf-8 -*-
"""
Stage B (方案A): recvfrom 进程内改包, 把 NPC 对话英文替换成中文, 重加密写回 -> 游戏原生框显示中文
  * _mitm.js: 内置 AES-128-ECB(已验证), recvfrom 当场解密/重建/重加密
  * 缓存门控: 命中缓存的对话即时改中文; 未命中放行英文 + 后台翻译入缓存(下次生效)
  * 翻译复用 自动翻译/screen_translator, 带磁盘缓存
用法: python eco_npc_mitm.py   (eco.exe 在线; 首次见到的对话英文, 再次见到变中文)
"""
import argparse
import atexit
import os, sys, json, time, threading, re, queue

# Electron reads child-process output as UTF-8. Frozen Python otherwise uses
# the current Windows console code page (usually GBK on Chinese systems).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass

# 资源目录(只读, 打包后在临时解包目录) 与 数据目录(可写: data/ 或 ECO_DATA_DIR)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

RES_DIR, DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(DATA_DIR)
HERE = DATA_DIR
# Scripts live in src/; screen_translator may live in repo root next to src/.
sys.path.insert(0, RES_DIR)
_repo_root = os.path.abspath(os.path.join(RES_DIR, ".."))
if os.path.isdir(os.path.join(_repo_root, "screen_translator")):
    sys.path.insert(0, _repo_root)
sys.path.append(r"C:\Users\31459\Documents\自动翻译")  # 后备: 开发机原路径
import frida
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig
from eco_log import setup_logger

def emit(kind, **payload):
    """JSON line for Electron. Human logs still go through logger."""
    message = {"type": kind, "service": payload.pop("service", "translator"), **payload}
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)

SOURCE_LANG = "auto"; TARGET_LANG = "zh-CN"
CONFIG_FILE = os.path.join(DATA_DIR, "translate_config.json")   # 由配置工具生成(exe 同目录)

# Precompile common regex for hot-path text cleaning
CLEAN_RE = re.compile(r"\$[A-Za-z]")
WS_RE = re.compile(r"[ \t]+")
NL_WS_RE = re.compile(r"\n[ \t]+")

logger = setup_logger(
    "eco_npc_mitm",
    log_dir=log_dir(DATA_DIR),
    log_file="eco_npc_mitm.log",
    stream=sys.stdout,  # Electron captures translator stdout into the UI log
)

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
    SOURCE_LANG = _cfg0.get("source_lang", SOURCE_LANG) or "auto"
except Exception: pass
try:
    from eco_source_lang import (
        api_source_code,
        cache_storage_key,
        detect_source_lang,
        parse_storage_key,
        resolve_source_lang,
    )
except Exception:
    api_source_code = lambda src: "en"
    cache_storage_key = lambda text, src: text
    detect_source_lang = lambda text: "en"
    parse_storage_key = lambda key: ("en", key)
    resolve_source_lang = lambda text, mode="auto": "en"
try:
    from eco_event_cache import EventCache
except Exception:
    EventCache = None
SEEN_FILE = os.path.join(DATA_DIR, "npc_seen.json")   # 见过的英文原文语料(供离线预翻 pretranslate.py 用)

# 翻译缓存
try: CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception: CACHE = {}
clock = threading.Lock()
# Serialize API calls: OpenAI client is not reliably thread-safe under concurrent bg workers.
_api_lock = threading.Lock()

# Disk flush: write soon so restart does not lose "seen but never cached" lines.
CACHE_DIRTY = 0
CACHE_FLUSH_EVERY = 5

def _write_cache_unlocked():
    """Caller must hold clock. Writes CACHE to disk."""
    global CACHE_DIRTY
    try:
        json.dump(CACHE, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
        CACHE_DIRTY = 0
    except Exception as e:
        logger.warning("[缓存] 落盘失败: %s", e)

def flush_cache(force=False):
    """Flush translation cache to disk when dirty enough (or force=True)."""
    global CACHE_DIRTY
    with clock:
        if CACHE_DIRTY <= 0:
            return
        if not force and CACHE_DIRTY < CACHE_FLUSH_EVERY:
            return
        _write_cache_unlocked()

def cache_put(k, v, source_lang="en"):
    global CACHE_DIRTY
    if not k or not v:
        return
    # Normalize key the same way as lookup (strip NULs etc.)
    k = cache_storage_key(_norm_cache_key(k), source_lang)
    with clock:
        CACHE[k] = v
        CACHE_DIRTY += 1
        if CACHE_DIRTY >= CACHE_FLUSH_EVERY:
            _write_cache_unlocked()

def _norm_cache_key(text):
    """Stable cache key: drop NULs / odd controls that break lookups across packets."""
    try:
        from eco_translation_quality import normalize_text
        return normalize_text(text)
    except Exception:
        if not text:
            return text
        if "\x00" in text or any(ord(ch) < 32 and ch not in "\n\r\t" for ch in text):
            text = "".join(ch for ch in text if ch in "\n\r\t" or ord(ch) >= 32)
        return text.strip()

def _cache_lookup_candidates(text, source_lang=None):
    """Keys rebuild() may have stored historically (NUL / trailing space / prefix)."""
    raw = _norm_cache_key(text)
    if not raw:
        return []
    src = resolve_source_lang(raw, source_lang or SOURCE_LANG)
    keyed = cache_storage_key(raw, src)
    out = []
    for base in (keyed, raw, text):
        if not base:
            continue
        for cand in (base, base + "\x00", base + " \x00", base + "\n\x00"):
            if cand not in out:
                out.append(cand)
    return out

def cache_get(text, source_lang=None):
    if not text:
        return None
    with clock:
        for candidate in _cache_lookup_candidates(text, source_lang):
            hit = CACHE.get(candidate)
            if hit:
                return hit
        return None

def rekey_loaded_cache():
    """Rewrite dirty historical keys (\"text \\x00\") onto the lookup form rebuild() uses."""
    global CACHE_DIRTY
    with clock:
        rebuilt = {}
        changed = 0
        for k, v in CACHE.items():
            src, raw = parse_storage_key(k)
            nk_raw = _norm_cache_key(raw)
            nv = v
            if v and (
                "\x00" in v
                or any(ord(ch) < 32 and ch not in "\n\r\t" for ch in v)
            ):
                nv = _norm_cache_key(v)
            if not nk_raw or not nv:
                changed += 1
                continue
            nk = cache_storage_key(nk_raw, src)
            if nk != k:
                changed += 1
            if nk not in rebuilt:
                rebuilt[nk] = nv
        if changed:
            CACHE.clear()
            CACHE.update(rebuilt)
            CACHE_DIRTY += 1
            _write_cache_unlocked()
        return changed

atexit.register(lambda: flush_cache(force=True))

# 共享词库同步(可选): 自动上报本地新译文 + 自动拉取别人贡献
def _merge_pulled(d, source_lang="en"):
    """把拉到的 {原文:中文} 合并进本地缓存(本地已有的不覆盖, 先到先得), 落盘, 返回新增数。"""
    global CACHE_DIRTY
    new = 0
    with clock:
        for k, v in d.items():
            if not k or not v:
                continue
            k = _norm_cache_key(k)
            if v and ("\x00" in v or any(ord(ch) < 32 and ch not in "\n\r\t" for ch in v)):
                v = _norm_cache_key(v)
            if not k or not v:
                continue
            sk = cache_storage_key(k, source_lang)
            if sk not in CACHE:
                CACHE[sk] = v
                new += 1
                CACHE_DIRTY += 1
        if new and CACHE_DIRTY >= CACHE_FLUSH_EVERY:
            _write_cache_unlocked()
        elif new:
            # merge batches can be large; flush immediately so shared pull is durable
            _write_cache_unlocked()
    return new
try:
    import cache_sync
    SYNC = cache_sync.Sync(DATA_DIR, TARGET_LANG, (PROVIDER or {}).get("model", "?"), _merge_pulled)
except Exception as _e:
    logger.info("[同步] 模块加载失败(忽略, 仅本地): %s", _e); SYNC = None
# 见过的英文原文语料(去重落盘, 供离线批量预翻 pretranslate.py 使用)
try: SEEN = set(json.load(open(SEEN_FILE, encoding="utf-8")))
except Exception: SEEN = set()
seen_lock = threading.Lock()
EVENT_CACHE = EventCache(os.path.join(DATA_DIR, "npc_event_cache.json")) if EventCache else None
if EVENT_CACHE:
    atexit.register(EVENT_CACHE.flush)
CURRENT_EVENT = {"eid": None, "say_i": 0}
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
def _remember_event(kind, source_lang, key, value):
    if not EVENT_CACHE or not value:
        return
    try:
        EVENT_CACHE.remember(CURRENT_EVENT.get("eid"), kind, source_lang, key, value)
    except Exception:
        pass

def translate(text, cache_only=False, kind="say"):
    if not (text or "").strip():
        return None
    text = _norm_cache_key(text) if text else text
    src = resolve_source_lang(text, SOURCE_LANG)
    if src == "zh":
        return text
    c = cache_get(text, src)
    if c:
        return c
    if cache_only:
        return None
    try:
        with _api_lock:
            out = (_engine().translate(text, api_source_code(src), TARGET_LANG) or "").strip()
    except Exception as e:
        logger.warning("[翻译失败] src=%s %s | %r", src, e, (text or "")[:60])
        return None
    if out:
        cache_put(text, out, src)
        if SYNC:
            SYNC.enqueue(text, out, source_lang=src)
        _remember_event(kind, src, text, out)
    else:
        logger.warning("[翻译空结果] src=%s %r", src, (text or "")[:60])
    return out

def translate_batch(texts, cache_only=False, kind="select"):
    """批量翻译(缓存命中跳过, 未命中一次 API 调用), 返回与 texts 等长的中文列表。
       cache_only=True 时未命中处保留 None, 不调用 API。"""
    texts = [_norm_cache_key(t) if t else t for t in texts]
    res = [None] * len(texts)
    miss = []
    srcs = []
    for i, t in enumerate(texts):
        src = resolve_source_lang(t, SOURCE_LANG)
        srcs.append(src)
        if not (t or "").strip():
            continue
        if src == "zh":
            res[i] = t
            continue
        c = cache_get(t, src)
        if c:
            res[i] = c
        else:
            miss.append(i)
    if miss and not cache_only:
        grouped = {}
        for i in miss:
            grouped.setdefault(srcs[i], []).append(i)
        for src, indexes in grouped.items():
            try:
                with _api_lock:
                    outs = _engine().translate_many(
                        [texts[i] for i in indexes], api_source_code(src), TARGET_LANG
                    )
            except Exception as e:
                logger.warning("[批量翻译失败] src=%s %s | n=%s", src, e, len(indexes))
                outs = []
            for j, i in enumerate(indexes):
                o = ((outs[j] if j < len(outs) else "") or "").strip()
                res[i] = o
                if o:
                    cache_put(texts[i], o, src)
                    if SYNC:
                        SYNC.enqueue(texts[i], o, source_lang=src)
                    _remember_event(kind, src, texts[i], o)
                else:
                    logger.warning("[批量翻译空结果] src=%s %r", src, (texts[i] or "")[:60])
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
    t = CLEAN_RE.sub("", t)
    # Segment payloads often include a trailing NUL; keep it out of cache keys.
    t = t.replace("\x00", "")
    t = WS_RE.sub(" ", t)
    return NL_WS_RE.sub("\n", t).strip()

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
    logger.info(f"[玩家名] 已加载 {len(PLAYER_NAMES)} 个角色名, 对话中将模板化为 {PC_TOKEN}: {PLAYER_NAMES}")

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

def _be16(buf, i):
    return (buf[i] << 8) | buf[i + 1]


def _bytes_have_text(buf):
    return any(b > 0x20 for b in buf)


def _looks_like_1017(sub):
    if not sub or len(sub) < 10:
        return False
    seg_n = sub[8]
    if seg_n < 1 or seg_n > 40:
        return False
    p = 9
    has_text = False
    for _ in range(seg_n):
        if p >= len(sub):
            return False
        ln = sub[p]
        p += 1
        if p + ln > len(sub):
            return False
        if _bytes_have_text(sub[p:p + ln]):
            has_text = True
        p += ln
    return has_text


def _looks_like_1526(sub):
    if not sub or len(sub) < 5:
        return False
    p = 2
    qlen = sub[p]
    p += 1
    if p + qlen > len(sub):
        return False
    has_text = _bytes_have_text(sub[p:p + qlen])
    p += qlen
    if p >= len(sub):
        return False
    opt_count = sub[p]
    p += 1
    if opt_count > 32 or p + opt_count + 1 > len(sub):
        return False
    p += opt_count + 1
    for _ in range(opt_count):
        if p >= len(sub):
            return False
        ln = sub[p]
        p += 1
        if p + ln > len(sub):
            return False
        if _bytes_have_text(sub[p:p + ln]):
            has_text = True
        p += ln
    return has_text


def looks_like_dialogue_sub(sub, expect_op=None):
    """Match _mitm.js looksLikeSub: opcode + structure + printable text."""
    if not sub or len(sub) < 4 or len(sub) > 4000:
        return False
    op = _be16(sub, 0)
    if expect_op is not None and op != expect_op:
        return False
    if op == 1017:
        return _looks_like_1017(sub)
    if op == 1526:
        return _looks_like_1526(sub)
    return False


def rebuild_1017(sub, cache_only=False):
    """[op2][npc4][flag2][segN1]{[len1][seg]}*N [motion2][nameLen1][name..pad] -> 中文"""
    if not sub or len(sub) < 10:
        return None
    op, npc, flag = sub[0:2], sub[2:6], sub[6:8]
    p = 8; segN = sub[p]; p += 1; segs = []
    if segN > 64:
        return None
    for _ in range(segN):
        if p >= len(sub):
            return None
        l = sub[p]; p += 1
        if p + l > len(sub):
            return None
        segs.append(sub[p:p+l]); p += l
    tail = sub[p:]                      # motion2 + nameLen1 + name + padding
    eng = _clean_text("".join(s.decode("utf-8", "replace") for s in segs))
    if not eng:
        return None
    eng_key, pcname = templatize(eng)                # 角色名 -> {PC}, 模板化后翻译/缓存/共享
    if resolve_source_lang(eng_key, SOURCE_LANG) == "zh":
        return None
    if not cache_only: record_seen([eng_key])
    zh = translate(eng_key, cache_only, kind="say")
    if not zh: return None
    zh = untemplatize(zh, pcname)                     # 显示前把真名填回
    lines = wrap_cjk(zh, 20)                          # 每段一行, 防止框内折行重叠
    chunks = [ln.encode("utf-8")[:250] for ln in lines[:40]]  # hard cap lines
    if not chunks:
        return None
    out = bytearray(op + npc + flag); out.append(len(chunks) & 0xff)
    for c in chunks: out.append(len(c) & 0xff); out += c
    out += tail
    if len(out) > 4000:
        return None
    built = bytes(out)
    if not looks_like_dialogue_sub(built, 1017):
        return None
    return built

def rebuild_1526(sub, cache_only=False):
    """[op2][qlen1][question(含null)][optCount1][indices(optCount+1)]{[len1][opt]}*N [tail] -> 中文
       indices 是点击->动作映射, 原样保留; 只译问题与选项文字"""
    if not sub or len(sub) < 5:
        return None
    op = sub[0:2]; p = 2
    qlen = sub[p]; p += 1
    if p + qlen > len(sub):
        return None
    question = sub[p:p+qlen]; p += qlen
    if p >= len(sub):
        return None
    optCount = sub[p]; p += 1
    if optCount > 32 or p + optCount + 1 > len(sub):
        return None
    indices = sub[p:p+optCount+1]; p += optCount + 1
    opts = []
    for _ in range(optCount):
        if p >= len(sub):
            return None
        l = sub[p]; p += 1
        if p + l > len(sub):
            return None
        opts.append(sub[p:p+l]); p += l
    tail = sub[p:]                       # 01 + padding
    q_eng = question.split(b"\0")[0].decode("utf-8", "replace").strip()
    opt_eng = [o.decode("utf-8", "replace").strip() for o in opts]
    if not q_eng and not any(opt_eng):
        return None
    texts = [q_eng] + opt_eng
    keyed = [templatize(t) for t in texts]            # [(模板, 真名), ...]
    keys = [k for k, _ in keyed]; pcnames = [n for _, n in keyed]
    if all(resolve_source_lang(k, SOURCE_LANG) == "zh" for k in keys if k):
        return None
    if not cache_only: record_seen(keys)
    zhs = translate_batch(keys, cache_only, kind="select")
    if cache_only and any(z is None for z in zhs): return None    # 任一未命中则整条不出, 交后台
    disp = [untemplatize(zhs[i] or texts[i], pcnames[i]) for i in range(len(texts))]   # 填回真名
    q_zh = disp[0].encode("utf-8")[:250]
    opt_zh = [disp[1+i].encode("utf-8")[:250] for i in range(len(opts))]
    out = bytearray(op)
    out.append((len(q_zh) + 1) & 0xff); out += q_zh; out.append(0)   # qlen 含 null
    out.append(optCount); out += indices
    for oz in opt_zh: out.append(len(oz) & 0xff); out += oz
    out += tail
    if len(out) > 4000:
        return None
    built = bytes(out)
    if not looks_like_dialogue_sub(built, 1526):
        return None
    return built

# ===== 内置采集器(并入 MITM, 取代单独的 eco_harvester) =====
# JS 会把客户端 op1510 合法请求、服务端上下文和 op1017/1526 英文原文额外上报;
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
        self.cur_event_source = None; self.pending_event = None
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
        if op == 1510:
            if len(sub) >= 8: self.pending_event = int.from_bytes(sub[2:6], "big")
            return
        if op == 1500:
            self.cur_event = self.pending_event
            self.cur_event_source = "client_request" if self.pending_event is not None else None
            self.pending_event = None; self.cur_npc_id = None; return
        if op == 1501:
            self.cur_event = None; self.cur_event_source = None; self.cur_npc_id = None
            return
        if op == 1511:
            if len(sub) >= 6: self.cur_npc_id = int.from_bytes(sub[2:6], "big")
            return
        if op == 1512:
            if len(sub) >= 10:
                actor = int.from_bytes(sub[2:6], "big"); eid = int.from_bytes(sub[6:10], "big")
                self.last_event_by_actor[actor] = eid; self.cur_event = eid
                self.cur_event_source = "server_1512"
            return
        if op == 1017:
            actor, name, en = _parse_1017_harvest(sub)
            if not en: return
            if self.cur_event is not None:
                eid, event_source = self.cur_event, self.cur_event_source
            elif actor in self.last_event_by_actor:
                eid, event_source = self.last_event_by_actor[actor], "server_1512_actor_cache"
            else:
                eid, event_source = actor, "actor_fallback"
            k = str(eid); key = (k, "say", en)
            if key in self.seen: return
            self.seen.add(key)
            src = detect_source_lang(en)
            self._append_jl({"eventid": eid, "event_source": event_source,
                             "actor": actor, "npc": name, "kind": "say",
                             "en": en, "src": src, "ts": int(time.time())})
            e = self._entry(eid)
            if name and not e["npc"]: e["npc"] = name
            e["says"].append(en)
            e.setdefault("say_langs", []).append(src)
            self.dirty = True; self.n_say += 1
            logger.info(f"[采集·say] eid={eid} src={src} npc={name!r} | {en[:50]!r}")
        elif op == 1526:
            q, opts = _parse_1526_harvest(sub)
            if not q and not opts: return
            if self.cur_event is not None:
                eid, event_source = self.cur_event, self.cur_event_source
            else:
                eid, event_source = self.cur_npc_id, "npc_view_fallback"
            k = str(eid); key = (k, "sel", q + "|" + "|".join(opts))
            if key in self.seen: return
            self.seen.add(key)
            src = detect_source_lang(q or " ".join(opts))
            self._append_jl({"eventid": eid, "event_source": event_source,
                             "kind": "select", "en": q, "options": opts,
                             "src": src, "ts": int(time.time())})
            e = self._entry(eid); e["selects"].append({"q": q, "options": opts, "src": src})
            self.dirty = True; self.n_sel += 1
            logger.info(f"[采集·sel] eid={eid} src={src} | {q[:40]!r} 选项{opts}")

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

_FIRST_WAIT_MS = max(0, min(3000, int(round(FIRST_WAIT * 1000))))
JS = (open(os.path.join(RES_DIR, "_mitm.js"), encoding="utf-8").read()
      .replace("__MAP_PORT__", str(MAP_PORT))
      .replace("__SYNC__", "true" if SYNC_FIRST else "false")
      .replace("__FIRST_WAIT_MS__", str(_FIRST_WAIT_MS)))

sref = {"s": None}
_dlg = {"pages": 0, "menu": False}   # 当前对话状态: 页数(op1017计数) + 是否含选项菜单
def handler(msg, data):
    if msg.get("type") != "send":
        if msg.get("type") == "error":
            logger.error("[JS ERR] %s", msg.get("stack"))
        return
    p = msg["payload"]
    if p == "READY":
        if FIRST_WAIT > 0:
            logger.info(
                "[*] hook 就位。首屏等待 %.2fs（短对话首次尽量出中文；多段同帧仍先英文）。改设置后需重启翻译。",
                FIRST_WAIT,
            )
        else:
            logger.info("[*] hook 就位。去和 NPC 对话：首次原文(后台缓存)，同一句再出现应变中文。")
        return
    t = p.get("t")
    if t in ("ctx", "harvest", "request"):   # 采集消息: 丢后台队列, 绝不阻塞翻译回包
        op = p.get("op")
        if op == 1500:
            _dlg["pages"] = 0; _dlg["menu"] = False
            CURRENT_EVENT["say_i"] = 0
        elif op == 1501:
            CURRENT_EVENT["eid"] = None
            CURRENT_EVENT["say_i"] = 0
        elif op == 1017:
            _dlg["pages"] += 1
            CURRENT_EVENT["say_i"] = CURRENT_EVENT.get("say_i", 0) + 1
        elif op == 1526:
            _dlg["menu"] = True
        elif op == 1510:
            try:
                raw = bytes.fromhex(p.get("sub") or "")
                if len(raw) >= 8:
                    CURRENT_EVENT["eid"] = int.from_bytes(raw[2:6], "big")
                    CURRENT_EVENT["say_i"] = 0
            except Exception:
                pass
        elif op == 1512:
            try:
                raw = bytes.fromhex(p.get("sub") or "")
                if len(raw) >= 10:
                    CURRENT_EVENT["eid"] = int.from_bytes(raw[6:10], "big")
                    CURRENT_EVENT["say_i"] = 0
            except Exception:
                pass
        try: _hq.put_nowait((op, bytes.fromhex(p["sub"])))
        except Exception: pass
        return
    if p.get("t") == "need":
        sub = bytes.fromhex(p["sub"]); h = p["h"]; op = p.get("op"); sync = p.get("sync")
        tag = "选项菜单" if op == 1526 else "对话"

        def _bg_translate_and_cache():
            """Cache miss: translate in background and inject rebuilt sub for next display."""
            try:
                built = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
            except Exception as e:
                logger.warning("[后台翻译异常] op%s(%s) hash=%s: %s", op, tag, h, e)
                import traceback
                traceback.print_exc()
                return
            if not built or not looks_like_dialogue_sub(built, op):
                logger.warning("[后台翻译未产出] op%s(%s) hash=%s (API空/解析失败/空包)", op, tag, h)
                return
            try:
                sref["s"].post({"type": "cache", "h": h, "sub": built.hex()})
            except Exception as e:
                logger.warning("[缓存回填失败] hash=%s: %s", h, e)
                return
            # Persist soon (not every packet — full rewrite is heavy under load).
            flush_cache(force=False)
            logger.info("[缓存+] op%s(%s) hash=%s (%sB)", op, tag, h, len(built))

        # JS only sets sync=true for short frames when first_wait > 0.
        # Always post t{h} in that path so recvfrom cannot wait forever.
        if sync and FIRST_WAIT > 0:
            newsub = None
            try:
                newsub = rebuild_1526(sub, cache_only=True) if op == 1526 else rebuild_1017(sub, cache_only=True)
            except Exception as e:
                logger.warning("[查表重建异常] op%s: %s", op, e)
            if newsub is None:
                res = {}
                def do():
                    try:
                        res["s"] = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
                    except Exception as e:
                        logger.warning("[现翻异常] op%s: %s", op, e)
                th = threading.Thread(target=do, daemon=True)
                th.start()
                th.join(FIRST_WAIT)
                newsub = res.get("s")
                if newsub is None:
                    threading.Thread(target=_bg_translate_and_cache, daemon=True).start()
            try:
                sref["s"].post({"type": "t%d" % h, "sub": newsub.hex() if newsub else ""})
            except Exception as e:
                logger.warning("[首屏回包失败] hash=%s: %s", h, e)
            if newsub:
                try:
                    sref["s"].post({"type": "cache", "h": h, "sub": newsub.hex()})
                except Exception:
                    pass
                logger.info("[首屏中文] op%s(%s) hash=%s (%sB) wait=%.2fs", op, tag, h, len(newsub), FIRST_WAIT)
            else:
                logger.info("[首屏超时] op%s(%s) hash=%s wait=%.2fs，本句先英文", op, tag, h, FIRST_WAIT)
        else:
            threading.Thread(target=_bg_translate_and_cache, daemon=True).start()
    elif p.get("t") == "hit":
        logger.info("[改包✓] 已替换为中文 hash=%s", p['h'])

def warmup():
    """开机预热: 提前建好 openai 客户端 + 完成首次 TLS 握手, 让第一句真实对话不吃冷启动"""
    try:
        emit("notice", level="info", message="正在预热翻译引擎…")
        t0 = time.time()
        _engine().translate("Hello.", "en", TARGET_LANG)
        elapsed = time.time() - t0
        logger.info(f"[*] 引擎预热完成 ({elapsed:.1f}s)")
        emit("notice", level="success", message=f"引擎预热完成（{elapsed:.1f}s），可以对话")
    except Exception as e:
        logger.error("[*] 预热失败(忽略): %s", e)
        emit("notice", level="warn", message=f"引擎预热失败：{e}")

def main():
    parser = argparse.ArgumentParser(description="ECO NPC 实时翻译")
    parser.add_argument("--pid", type=int, help="要连接的 eco.exe 进程编号")
    args = parser.parse_args()

    if not PROVIDER:
        logger.info("=" * 50)
        logger.info(" 还没有配置翻译服务 (或缺少 API Key)。")
        if os.environ.get("ECO_DATA_DIR"):
            logger.info(" 请在 ECO 工具箱的“设置 -> 翻译服务”中完成配置。")
            logger.info(" 保存后重新启动 NPC 翻译即可。")
            logger.info("=" * 50)
            emit(
                "status",
                state="error",
                error_kind="translator-config",
                message="请先完成翻译设置",
            )
            return
        logger.info(" 正在打开配置工具，请选择服务商并填入 API Key 后保存。")
        logger.info(" 保存后重新启动本程序即可。")
        logger.info("=" * 50)
        try:
            import subprocess
            if getattr(sys, "frozen", False):
                subprocess.Popen([os.path.join(DATA_DIR, "eco_settings.exe")])
            else:
                subprocess.Popen([sys.executable, os.path.join(RES_DIR, "eco_settings.py")])
        except Exception as e:
            logger.error("打开配置工具失败，请手动双击 配置翻译.cmd: %s", e)
        return
    dev = frida.get_local_device()
    try:
        from eco_process import resolve_attach_pid

        pid, how = resolve_attach_pid(dev, args.pid)
        logger.info("[*] 目标进程 %s（%s）", pid, how)
    except Exception as exc:
        logger.error("%s", exc)
        emit("status", state="error", message=str(exc))
        return 2

    threading.Thread(target=warmup, daemon=True).start()
    threading.Thread(target=_harvest_worker, daemon=True).start()   # 内置采集器(后台)
    logger.info("[*] 内置采集器已启动: 边翻译边按 eventid 攒字典 -> harvest_dict.json")
    try:
        n_rekey = rekey_loaded_cache()
        if n_rekey:
            logger.info("[缓存] 已规范化 %s 条旧键（去掉 NUL/尾空白），避免昨天的译文查不到", n_rekey)
    except Exception as exc:
        logger.warning("[缓存] 规范化旧键失败(忽略): %s", exc)
    if SYNC:
        SYNC.start()                       # 启动共享词库同步(拉取+定时上报)
        SYNC.push_all(CACHE)               # 把整个本地缓存补传一遍(含被跳过翻译/命中缓存的)
    logger.info("[*] 源语言=%s  目标=%s", SOURCE_LANG or "auto", TARGET_LANG)
    logger.info("[*] attach %s", pid)
    emit("status", state="starting", message=f"正在连接游戏进程 {pid}", pid=pid)
    prev = sref.get("s")
    if prev is not None:
        logger.warning("[*] 检测到已有 mitm 脚本，先卸载再挂，避免双重挂钩")
        try:
            exports = getattr(prev, "exports_sync", None) or getattr(prev, "exports", None)
            if exports is not None and hasattr(exports, "dispose"):
                exports.dispose()
        except Exception:
            pass
        try:
            prev.unload()
        except Exception:
            pass
        sref["s"] = None
    session = dev.attach(pid)
    script = session.create_script(JS)
    script.on("message", handler)
    script.load()
    sref["s"] = script
    sref["session"] = session
    setup_hotkey()
    emit("status", state="running", message=f"NPC 翻译正在运行（进程 {pid}）", pid=pid)

    stop_event = threading.Event()
    cleaned = {"done": False}

    def _control_loop():
        while not stop_event.is_set():
            line = sys.stdin.readline()
            if not line:
                stop_event.set()
                return
            try:
                command = json.loads(line)
            except Exception:
                continue
            action = command.get("action")
            if action == "warmup":
                threading.Thread(target=warmup, daemon=True).start()
            elif action == "stop":
                stop_event.set()

    threading.Thread(target=_control_loop, daemon=True).start()

    def cleanup_frida(reason="stop"):
        """Unload hooks then detach so eco.exe is not crashed on agent teardown.

        Windows has recorded eco.exe + frida-agent.dll 0xc0000409 when hooks
        are torn down while a game thread is still inside recvfrom. Drain first,
        detach only when idle, and never force-kill mid-hook.
        """
        if cleaned["done"]:
            stop_event.set()
            return
        cleaned["done"] = True
        stop_event.set()
        logger.info("[*] 正在安全断开 Frida (%s)...", reason)
        try:
            flush_cache(force=True)
        except Exception:
            pass
        try:
            if EVENT_CACHE:
                EVENT_CACHE.flush()
        except Exception:
            pass
        scr = sref.get("s")
        drained = False
        if scr is not None:
            try:
                exports = getattr(scr, "exports_sync", None) or getattr(scr, "exports", None)
                if exports is not None and hasattr(exports, "dispose"):
                    # dispose() may spin up to ~6s waiting for IN_HOOK == 0
                    info = exports.dispose()
                    if isinstance(info, dict):
                        drained = bool(info.get("drained"))
                        logger.info(
                            "[*] dispose: drained=%s inHook=%s",
                            info.get("drained"),
                            info.get("inHook"),
                        )
                    else:
                        drained = True
                    time.sleep(0.35 if drained else 0.8)
            except Exception as e:
                logger.warning("[*] script.dispose 忽略: %s", e)
            # If hooks did not drain, skip unload — force unload is a top crash cause.
            if drained:
                try:
                    scr.unload()
                    time.sleep(0.35)
                except Exception as e:
                    logger.warning("[*] script.unload 忽略: %s", e)
            else:
                logger.warning(
                    "[*] 钩子仍在收发包路径中，跳过 unload 以免游戏闪退；仅断开会话"
                )
        try:
            sess = sref.get("session")
            if sess is not None:
                sess.detach()
                time.sleep(0.35)
        except Exception as e:
            logger.warning("[*] session.detach 忽略: %s", e)
        sref["s"] = None
        sref["session"] = None
        logger.info("[*] 已断开，游戏进程应继续运行")
        emit("status", state="stopped", message=f"NPC 翻译已安全停止（{reason}）")

    def stdin_stop_watcher():
        """Electron pipes stdin; a line with action=stop requests graceful exit."""
        try:
            if sys.stdin is None or sys.stdin.closed:
                return
            # isatty() True when double-clicked in console — then ignore stdin.
            try:
                if sys.stdin.isatty():
                    return
            except Exception:
                pass
            for raw in sys.stdin:
                text = (raw or "").strip()
                if not text:
                    continue
                low = text.lower()
                if low in ("stop", "quit", "exit") or '"action":"stop"' in low.replace(" ", ""):
                    cleanup_frida("stdin-stop")
                    break
        except Exception:
            pass

    def _on_signal(signum, _frame):
        cleanup_frida(f"signal-{signum}")

    try:
        import signal
        signal.signal(signal.SIGINT, _on_signal)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _on_signal)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, _on_signal)
    except Exception:
        pass

    atexit.register(lambda: cleanup_frida("atexit") if sref.get("session") else None)
    threading.Thread(target=stdin_stop_watcher, daemon=True).start()

    while not stop_event.is_set():
        time.sleep(0.25)
    return 0

_state = {"on": True}
def toggle():
    _state["on"] = not _state["on"]
    try: sref["s"].post({"type": "toggle", "on": _state["on"]})
    except Exception: pass
    logger.info("[切换] 当前显示: %s", "中文" if _state["on"] else "原文")

def skip_dialogue():
    """一键跳过整段对话: 按当前页数发等量 Enter, 刚好翻到底关掉(不多按, 不会误开聊天框)。
    翻页是纯客户端的(不发包), 所以靠模拟 Enter; 含选项菜单时停手, 留你手动选。"""
    try: import keyboard
    except Exception: return
    if _dlg["menu"]:
        logger.info("[跳过] 当前对话含选项菜单, 不自动选, 请手动。")
        return
    n = _dlg["pages"]
    if n <= 0:
        logger.info("[跳过] 当前没检测到打开的对话(没收到 op1017)。")
        return
    for _ in range(n):
        keyboard.press_and_release("enter"); time.sleep(0.04)
    _dlg["pages"] = 0                       # 跳过后清零, 防止再按时多发 Enter 误开聊天
    logger.info("[跳过] 已发 %s 次 Enter 跳过整段对话。", n)

def setup_hotkey():
    try:
        import keyboard
    except Exception as e:
        logger.warning("[*] 热键不可用(忽略): %s", e)
        return
    try:
        cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
    except Exception:
        cfg = {}
    hk = (cfg.get("toggle_hotkey") or "f9").strip()
    if hk:
        try:
            keyboard.add_hotkey(hk, toggle)
            logger.info("[*] 热键就绪: 按 %s 在 中文/英文 之间切换", hk.upper())
        except Exception as e:
            logger.error("[*] 切换热键注册失败: %s", e)
    else:
        logger.info("[*] 中/英切换热键已关闭")
    sk = (cfg.get("skip_hotkey", "f8") or "").strip()
    if sk:
        try:
            keyboard.add_hotkey(sk, skip_dialogue)
            logger.info("[*] 跳过热键就绪: 按 %s 一键跳过整段对话(菜单不动)", sk.upper())
        except Exception as e:
            logger.error("[*] 跳过热键注册失败: %s", e)
    else:
        logger.info("[*] 一键跳过对话热键已关闭")

if __name__ == "__main__":
    raise SystemExit(main())
