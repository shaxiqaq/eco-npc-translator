# -*- coding: utf-8 -*-
"""
Stage B (方案A): recvfrom 进程内改包, 把 NPC 对话英文替换成中文, 重加密写回 -> 游戏原生框显示中文
  * _mitm.js: 内置 AES-128-ECB(已验证), recvfrom 当场解密/重建/重加密
  * 缓存门控: 命中缓存的对话即时改中文; 未命中放行英文 + 后台翻译入缓存(下次生效)
  * 翻译复用 自动翻译/screen_translator, 带磁盘缓存
用法: python eco_npc_mitm.py   (eco.exe 在线; 首次见到的对话英文, 再次见到变中文)
"""
import os, sys, json, time, threading, re
import frida

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)                              # 优先用随程序打包的 screen_translator
sys.path.append(r"C:\Users\31459\Documents\自动翻译")  # 后备: 开发机原路径
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig

SOURCE_LANG = "en"; TARGET_LANG = "zh-CN"
CONFIG_FILE = os.path.join(HERE, "translate_config.json")   # 由 eco_settings.py(配置工具) 生成
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
CACHE_FILE = os.path.join(HERE, "npc_cache.json")
MAP_PORT = 12002
SEG_MAX = 240            # 每段中文 UTF-8 字节上限 (段长用1字节, <255)
SYNC_FIRST = True        # True: 首次也扣包等翻译; 超时则放行英文+缓存(下次生效)
SYNC_TIMEOUT = 4.0       # 扣包最多等待秒数

# 翻译缓存
try: CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception: CACHE = {}
clock = threading.Lock()
def cache_put(k, v):
    with clock:
        CACHE[k] = v
        try: json.dump(CACHE, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception: pass
_tr = {"v": None}
def _engine():
    if _tr["v"] is None: _tr["v"] = create_translator(TranslationConfig(**PROVIDER))
    return _tr["v"]
def translate(text):
    with clock: c = CACHE.get(text)
    if c: return c
    out = (_engine().translate(text, SOURCE_LANG, TARGET_LANG) or "").strip()
    if out: cache_put(text, out)
    return out
def translate_batch(texts):
    """批量翻译(缓存命中跳过, 未命中一次 API 调用), 返回与 texts 等长的中文列表"""
    res = [None] * len(texts); miss = []
    for i, t in enumerate(texts):
        with clock: c = CACHE.get(t)
        if c: res[i] = c
        else: miss.append(i)
    if miss:
        outs = _engine().translate_many([texts[i] for i in miss], SOURCE_LANG, TARGET_LANG)
        for j, i in enumerate(miss):
            o = ((outs[j] if j < len(outs) else "") or "").strip()
            res[i] = o
            if o: cache_put(texts[i], o)
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

def rebuild_1017(sub):
    """[op2][npc4][flag2][segN1]{[len1][seg]}*N [motion2][nameLen1][name..pad] -> 中文"""
    op, npc, flag = sub[0:2], sub[2:6], sub[6:8]
    p = 8; segN = sub[p]; p += 1; segs = []
    for _ in range(segN):
        l = sub[p]; p += 1; segs.append(sub[p:p+l]); p += l
    tail = sub[p:]                      # motion2 + nameLen1 + name + padding
    eng = _clean_text("".join(s.decode("utf-8", "replace") for s in segs))
    zh = translate(eng)
    if not zh: return None
    lines = wrap_cjk(zh, 20)                          # 每段一行, 防止框内折行重叠
    chunks = [ln.encode("utf-8")[:250] for ln in lines]
    out = bytearray(op + npc + flag); out.append(len(chunks) & 0xff)
    for c in chunks: out.append(len(c) & 0xff); out += c
    out += tail
    return bytes(out)

def rebuild_1526(sub):
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
    zhs = translate_batch([q_eng] + opt_eng)      # 一次 API 调用翻问题+所有选项
    q_zh = (zhs[0] or q_eng).encode("utf-8")[:250]
    opt_zh = [(zhs[1+i] or opt_eng[i]).encode("utf-8")[:250] for i in range(len(opts))]
    out = bytearray(op)
    out.append((len(q_zh) + 1) & 0xff); out += q_zh; out.append(0)   # qlen 含 null
    out.append(optCount); out += indices
    for oz in opt_zh: out.append(len(oz) & 0xff); out += oz
    out += tail
    return bytes(out)

JS = (open(os.path.join(HERE, "_mitm.js"), encoding="utf-8").read()
      .replace("__MAP_PORT__", str(MAP_PORT))
      .replace("__SYNC__", "true" if SYNC_FIRST else "false"))

sref = {"s": None}
def handler(msg, data):
    if msg.get("type") != "send":
        if msg.get("type") == "error": print("[JS ERR]", msg.get("stack"), flush=True)
        return
    p = msg["payload"]
    if p == "READY":
        print("[*] hook 就位。去和 NPC 对话：首次显英文(并后台翻译缓存)，再次见到同一句即变中文。", flush=True); return
    if p.get("t") == "need":
        sub = bytes.fromhex(p["sub"]); h = p["h"]; op = p.get("op"); sync = p.get("sync")
        tag = "选项菜单" if op == 1526 else "对话"
        if sync:
            # 同步扣包: 在超时内必须回复(空=放行英文); 超时后线程继续跑完并回填缓存
            res = {}
            def do():
                try: res["sub"] = rebuild_1526(sub) if op == 1526 else rebuild_1017(sub)
                except Exception: import traceback; traceback.print_exc()
            t = threading.Thread(target=do); t.start(); t.join(SYNC_TIMEOUT)
            newsub = res.get("sub")
            try: sref["s"].post({"type": "t%d" % h, "sub": newsub.hex() if newsub else ""})
            except Exception: pass
            if newsub:
                print(f"[首屏中文] op{op}({tag}) hash={h} ({len(newsub)}B)", flush=True)
            else:
                def finish():
                    t.join(); ns = res.get("sub")
                    if ns:
                        try: sref["s"].post({"type": "cache", "h": h, "sub": ns.hex()})
                        except Exception: pass
                        print(f"[缓存+](超时,下次生效) op{op}({tag}) hash={h}", flush=True)
                threading.Thread(target=finish, daemon=True).start()
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
    if not PROVIDER:
        print("=" * 50, flush=True)
        print(" 还没有配置翻译服务 (或缺少 API Key)。", flush=True)
        print(" 正在打开配置工具，请选择服务商并填入 API Key 后保存。", flush=True)
        print(" 保存后重新启动本程序即可。", flush=True)
        print("=" * 50, flush=True)
        try:
            import subprocess
            subprocess.Popen([sys.executable, os.path.join(HERE, "eco_settings.py")])
        except Exception as e:
            print("打开配置工具失败，请手动双击 配置翻译.cmd:", e, flush=True)
        return
    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos: print("没有运行中的 eco.exe"); return
    threading.Thread(target=warmup, daemon=True).start()
    pid = max(ecos, key=lambda x: x.pid).pid
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

def setup_hotkey():
    try:
        import keyboard
        keyboard.add_hotkey("f9", toggle)
        print("[*] 热键就绪: 按 F9 在 中文/英文 之间切换", flush=True)
    except Exception as e:
        print("[*] 热键不可用(忽略):", e, flush=True)

if __name__ == "__main__":
    main()
