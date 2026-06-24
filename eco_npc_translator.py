# -*- coding: utf-8 -*-
"""
ECO NPC 对话实时翻译 (Stage D: 嗅探 -> 清洗 -> 翻译 -> 置顶 overlay)
  * 复用 frida 抓 recvfrom + AES 解密, 只取 MAP(12002) 收包里的 NPC 文本包
  * 清洗: 去 npcID/长度前缀头, 提取对话正文 + NPC 名, 处理 $R/$P 控制符
  * 翻译: 复用 自动翻译/screen_translator.translator (本地 Ollama / 云 可切), 带磁盘缓存
  * 显示: Tkinter 置顶小窗, 原文 + 译文; 缓存命中即时, 未命中先显原文再补译文
依赖: frida, pycryptodome (已装); 翻译走本地 Ollama 时还需 ollama 在跑
用法:  python eco_npc_translator.py     (eco.exe 已登录在线)
切换引擎: 窗口里按 L=本地 / C=云
"""
import os, sys, json, time, threading, queue, re
import tkinter as tk
import frida
from Crypto.Cipher import AES

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- 复用 自动翻译 项目的翻译器 ----
TRANSLATOR_PROJECT = r"C:\Users\31459\Documents\自动翻译"
sys.path.insert(0, TRANSLATOR_PROJECT)
from screen_translator.translator import create_translator          # noqa: E402
from screen_translator.config import TranslationConfig              # noqa: E402

# ====== 可配置 ======
SOURCE_LANG = "en"          # 本服 NPC 文本为英文
TARGET_LANG = "zh-CN"
PROVIDERS = {
    "local": dict(provider="ollama", model="gemma4:12b", base_url="http://127.0.0.1:11434", api_key=""),
    "cloud": dict(provider="gemini", model="gemini-2.0-flash", base_url="", api_key=""),  # 填你的 GEMINI_API_KEY 或这里
}
ACTIVE = "local"            # 启动默认引擎; 运行时按 L/C 切换
NPC_OPCODES = {1015, 1017, 1526, 1536, 1541}   # NPC 对话/选择/输入框 (本服文本主要在 1017)
MAP_PORT = 12002
CACHE_FILE = os.path.join(HERE, "npc_cache.json")
RVA_AES = 0x18cc4
# ====================

def wswap(b): return b"".join(b[i:i+4][::-1] for i in range(0, len(b), 4))
def be16(b): return (b[0] << 8) | b[1]
def be32(b): return int.from_bytes(b[0:4], "big")

DEBUG = False     # 置 True 可把每个 NPC 包的分段/清洗/UI 状态写进 logs/npc_debug.log
_DBG = open(os.path.join(HERE, "logs", "npc_debug.log"), "a", encoding="utf-8", buffering=1) if DEBUG else None
def _dbg(op, sub, name, dia):
    if not _DBG: return
    runs = [r for r in re.findall(r"[^\x00-\x1f�]{2,}", sub[2:].decode("utf-8","replace")) if r.strip()]
    _DBG.write(f"\n=== op={op} len={len(sub)} ===\nRUNS: {runs!r}\n-> name={name!r}  dia={dia!r}\nHEX: {sub.hex()}\n")

# ---------------- 翻译缓存 ----------------
cache_lock = threading.Lock()
try:
    CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception:
    CACHE = {}
def cache_get(k):
    with cache_lock: return CACHE.get(k)
def cache_put(k, v):
    with cache_lock:
        CACHE[k] = v
        try: json.dump(CACHE, open(CACHE_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        except Exception: pass

# ---------------- 翻译器(懒建+可切) ----------------
_translators = {}
def get_translator(which):
    if which not in _translators:
        cfg = TranslationConfig(**PROVIDERS[which])
        _translators[which] = create_translator(cfg)
    return _translators[which]

active_provider = {"v": ACTIVE}
def translate_text(text):
    cached = cache_get(text)
    if cached: return cached, True
    tr = get_translator(active_provider["v"])
    out = tr.translate(text, SOURCE_LANG, TARGET_LANG)
    out = (out or "").strip()
    if out: cache_put(text, out)
    return out, False

# ---------------- NPC 文本清洗 ----------------
MENU_OPCODES = {1526, 1536, 1541}   # 选择/输入框: 结构是 问题 + 选项(&分隔)

def _strip_ctrl(t):
    t = t.replace("$R", "\n").replace("$P", "\n\n")
    t = re.sub(r"\$[A-Za-z]", "", t)          # 其它 $X 控制码
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n[ \t]+", "\n", t)
    return t.strip()

def clean_npc(opcode, subdata):
    """提取 (说话人/标签, 待翻译正文). 用'可打印片段'天然按长度前缀字节切分.
       普通对话(末段=NPC名); 选择菜单(首段=问题, 次段=&分隔选项)."""
    s = subdata.decode("utf-8", errors="replace")
    runs = [r.strip() for r in re.findall(r"[^\x00-\x1f�]{2,}", s) if r.strip()]
    if not runs: return None, None
    if opcode in MENU_OPCODES:
        question = _strip_ctrl(runs[0])
        opts = [o.strip() for o in runs[1].split("&")] if len(runs) > 1 else []
        opts = [_strip_ctrl(o) for o in opts if o.strip()]
        dia = question + (("\n" + "\n".join("• " + o for o in opts)) if opts else "")
        return "🔘 选择", dia
    speaker = runs[-1] if len(runs) > 1 else "NPC"
    dia = _strip_ctrl(" ".join(runs[:-1]) if len(runs) > 1 else runs[0])
    return speaker, dia

# ---------------- frida: 抓包 + 解密 + 取 NPC 文本 ----------------
JS = r"""
'use strict';
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');}
function exp(dll,fn){try{const m=Process.findModuleByName(dll);return m?m.findExportByName(fn):null;}catch(e){return null;}}
const m=Process.findModuleByName('eco.exe');
const FN=m.base.add(%d);
Interceptor.attach(FN,{onEnter(){try{send({t:'key',rk:hx(this.context.esp.add(4).readPointer(),16)});}catch(e){}}});
const gpn=new NativeFunction(exp('ws2_32.dll','getpeername'),'int',['uint','pointer','pointer']);
function port(s){try{const sa=Memory.alloc(32),ln=Memory.alloc(4);ln.writeInt(32);if(gpn(s,sa,ln)===0){const b=new Uint8Array(sa.readByteArray(4));return (b[2]<<8)|b[3];}}catch(e){}return 0;}
const pRecvfrom=exp('ws2_32.dll','recvfrom');
if(pRecvfrom) Interceptor.attach(pRecvfrom,{onEnter(a){this.s=a[0].toUInt32();this.b=a[1];},
  onLeave(r){const n=r.toInt32();if(n>0){const pt=port(this.s);if(pt===%d){try{send({t:'data',hex:hx(this.b,n)});}catch(e){}}}}});
const pRecv=exp('ws2_32.dll','recv');
if(pRecv) Interceptor.attach(pRecv,{onEnter(a){this.s=a[0].toUInt32();this.b=a[1];},
  onLeave(r){const n=r.toInt32();if(n>0){const pt=port(this.s);if(pt===%d){try{send({t:'data',hex:hx(this.b,n)});}catch(e){}}}}});
send('READY');
""" % (RVA_AES, MAP_PORT, MAP_PORT)

keys = []
stream = bytearray()
locked_key = {"k": None}
dialogue_q = queue.Queue()      # (name, dialogue) -> 待显示/翻译
ui_q = queue.Queue()            # ('show',name,orig) / ('trans',orig,zh)

def add_key(rk_hex):
    k = wswap(bytes.fromhex(rk_hex))
    if k not in keys: keys.append(k)

def parse_plain(pt, num1):
    subs=[]; pos=0
    if num1 < 2 or num1 > len(pt): return None
    while pos < num1:
        if pos+2 > len(pt): return None
        sublen = be16(pt[pos:pos+2])
        if sublen < 2 or pos+2+sublen > len(pt): return None
        subs.append(pt[pos+2:pos+2+sublen]); pos += 2+sublen
    return subs if subs else None

def on_data(hexs):
    global stream
    stream += bytes.fromhex(hexs)
    keypool = [locked_key["k"]] if locked_key["k"] else keys
    while True:
        adv = False
        for start in range(0, min(len(stream), 64)):
            if start+8 > len(stream): break
            Lp = be32(stream[start:start+4]); num1 = be32(stream[start+4:start+8])
            if Lp%16 or Lp<16 or Lp>0x40000 or num1>Lp or num1<2: continue
            if start+8+Lp > len(stream): continue
            ct = bytes(stream[start+8:start+8+Lp])
            for key in keypool:
                try: pt = AES.new(key, AES.MODE_ECB).decrypt(ct)
                except Exception: continue
                subs = parse_plain(pt, num1)
                if subs is None: continue
                if not locked_key["k"]: locked_key["k"] = key
                for sub in subs:
                    op = be16(sub[0:2])
                    if op in NPC_OPCODES:
                        name, dia = clean_npc(op, sub)
                        _dbg(op, sub, name, dia)
                        if dia and len(dia) >= 4:
                            dialogue_q.put((name, dia))
                del stream[:start+8+Lp]; adv = True; break
            if adv: break
        if not adv: break
    if len(stream) > 1<<20: del stream[:-4096]

def handler(msg, data):
    if msg.get("type") != "send":
        if msg.get("type")=="error": print("[JS ERR]", msg.get("stack")); return
        return
    p = msg["payload"]
    if p == "READY": print("[*] hook 就位, 等待 NPC 对话..."); return
    if p.get("t")=="key": add_key(p["rk"])
    elif p.get("t")=="data": on_data(p["hex"])

# ---------------- 翻译 worker ----------------
last_shown = {"v": None}
_seq = {"n": 0}
def translate_worker():
    while True:
        name, dia = dialogue_q.get()
        if dia == last_shown["v"]:           # 去重: 同一句不重复
            continue
        last_shown["v"] = dia
        _seq["n"] += 1; seq = _seq["n"]
        ui_q.put(("show", seq, name, dia))
        try:
            zh, hit = translate_text(dia)
        except Exception as e:
            zh = f"[翻译失败] {e}"
        ui_q.put(("trans", seq, zh))

# ---------------- overlay UI ----------------
class Overlay:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("ECO NPC 翻译")
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.92)
        self.root.configure(bg="#101014")
        self.root.geometry("560x320+40+40")
        pad = dict(fg="#e0e0e0", bg="#101014", justify="left", anchor="w", wraplength=530)
        self.lbl_name = tk.Label(self.root, text="(等待 NPC 对话…)", font=("Microsoft YaHei", 11, "bold"),
                                 fg="#ffcc55", bg="#101014", anchor="w")
        self.lbl_name.pack(fill="x", padx=12, pady=(10,2))
        tk.Label(self.root, text="原文", fg="#7a7a8a", bg="#101014", anchor="w").pack(fill="x", padx=12)
        self.lbl_orig = tk.Label(self.root, font=("Segoe UI", 10), **pad); self.lbl_orig.pack(fill="x", padx=12, pady=(0,6))
        tk.Label(self.root, text="译文", fg="#7a7a8a", bg="#101014", anchor="w").pack(fill="x", padx=12)
        self.lbl_zh = tk.Label(self.root, font=("Microsoft YaHei", 13), fg="#9fe0a0", bg="#101014",
                               justify="left", anchor="w", wraplength=530); self.lbl_zh.pack(fill="x", padx=12, pady=(0,8))
        self.lbl_status = tk.Label(self.root, text="引擎: "+ACTIVE, fg="#7a7a8a", bg="#101014", anchor="w")
        self.lbl_status.pack(fill="x", padx=12, side="bottom")
        self.cur_seq = 0
        self.root.bind("<l>", lambda e: self.set_engine("local"))
        self.root.bind("<c>", lambda e: self.set_engine("cloud"))
        self.root.after(100, self.poll)

    def set_engine(self, w):
        active_provider["v"] = w
        self.lbl_status.config(text=f"引擎: {w}")

    def poll(self):
        try:
            while True:
                item = ui_q.get_nowait()
                if item[0]=="show":
                    _, seq, name, orig = item
                    self.cur_seq = seq
                    self.lbl_name.config(text="🗣 "+(name or "NPC"))
                    self.lbl_orig.config(text=orig)
                    self.lbl_zh.config(text="翻译中…")
                    if _DBG: _DBG.write(f"[UI seq={seq}] SHOW name={name!r} orig={orig!r}\n")
                elif item[0]=="trans":
                    _, seq, zh = item
                    if seq == self.cur_seq:          # 只更新当前条目, 防错位
                        self.lbl_zh.config(text=zh)
                    if _DBG: _DBG.write(f"[UI seq={seq}] TRANS(cur={self.cur_seq}) zh={zh!r}\n")
        except queue.Empty:
            pass
        self.root.after(100, self.poll)

def main():
    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower()=="eco.exe"]
    if not ecos:
        print("没有运行中的 eco.exe"); return
    pid = max(ecos, key=lambda x:x.pid).pid
    print(f"[*] attach eco.exe PID={pid}")
    session = dev.attach(pid)
    script = session.create_script(JS); script.on("message", handler); script.load()
    threading.Thread(target=translate_worker, daemon=True).start()
    Overlay().root.mainloop()

if __name__ == "__main__":
    main()
