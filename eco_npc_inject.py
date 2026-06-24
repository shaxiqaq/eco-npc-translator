# -*- coding: utf-8 -*-
"""
Stage B: 把 NPC 对话译文塞进游戏原生对话框 (自适应容量)
  * frida 抓 recvfrom 收 NPC 文本包 + 自取 AES 密钥 + 解密
  * 清洗对话 -> 翻译(复用 自动翻译/translator, 带缓存) -> 注入
  * 注入: 扫描当前对话的 UTF-16 渲染缓冲, 测容量后:
      空位够 -> 原文后追加 "\n【译】译文"  (原文+译文)
      空位不够 -> 用译文替换原文           (仅译文, 中文更短必放得下)
  * 中文经实测游戏字体可正常渲染
用法: python eco_npc_inject.py   (eco.exe 在线)
"""
import os, sys, json, time, threading, queue, re
import frida
from Crypto.Cipher import AES

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, r"C:\Users\31459\Documents\自动翻译")
from screen_translator.translator import create_translator
from screen_translator.config import TranslationConfig

# ===== 配置 =====
SOURCE_LANG="en"; TARGET_LANG="zh-CN"
PROVIDER = dict(provider="ollama", model="gemma4:12b", base_url="http://127.0.0.1:11434", api_key="")
NPC_TEXT_OPCODES = {1017}      # 主对话文本包
CACHE_FILE = os.path.join(HERE, "npc_cache.json")
MAP_PORT = 12002
WRITE_DELAY = 0.25             # 等客户端把 UTF-16 缓冲填好
PREFIX = "\n【译】"            # 追加模式下译文前缀
# ================

def wswap(b): return b"".join(b[i:i+4][::-1] for i in range(0,len(b),4))
def be16(b): return (b[0]<<8)|b[1]
def be32(b): return int.from_bytes(b[0:4],"big")

# 缓存 + 翻译
try: CACHE=json.load(open(CACHE_FILE,encoding="utf-8"))
except Exception: CACHE={}
clock=threading.Lock()
def cache_put(k,v):
    with clock:
        CACHE[k]=v
        try: json.dump(CACHE,open(CACHE_FILE,"w",encoding="utf-8"),ensure_ascii=False)
        except Exception: pass
_tr={"v":None}
def translator():
    if _tr["v"] is None: _tr["v"]=create_translator(TranslationConfig(**PROVIDER))
    return _tr["v"]
def translate(text):
    with clock: c=CACHE.get(text)
    if c: return c
    out=(translator().translate(text,SOURCE_LANG,TARGET_LANG) or "").strip()
    if out: cache_put(text,out)
    return out

def clean_npc(subdata):
    s=subdata.decode("utf-8","replace")
    runs=[r.strip() for r in re.findall(r"[^\x00-\x1f�]{2,}", s) if r.strip()]
    if not runs: return None,None
    name=runs[-1] if len(runs)>1 else "NPC"
    dia=" ".join(runs[:-1]) if len(runs)>1 else runs[0]
    dia=dia.replace("$R","\n").replace("$P","\n")
    dia=re.sub(r"\$[A-Za-z]","",dia); dia=re.sub(r"[ \t]+"," ",dia)
    dia=re.sub(r"\n[ \t]+","\n",dia).strip()
    return name,dia

JS = r"""
'use strict';
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');}
function exp(d,f){try{const m=Process.findModuleByName(d);return m?m.findExportByName(f):null;}catch(e){return null;}}
const m=Process.findModuleByName('eco.exe');
Interceptor.attach(m.base.add(0x18cc4),{onEnter(){try{send({t:'key',rk:hx(this.context.esp.add(4).readPointer(),16)});}catch(e){}}});
const gpn=new NativeFunction(exp('ws2_32.dll','getpeername'),'int',['uint','pointer','pointer']);
function port(s){try{const sa=Memory.alloc(32),ln=Memory.alloc(4);ln.writeInt(32);if(gpn(s,sa,ln)===0){const b=new Uint8Array(sa.readByteArray(4));return (b[2]<<8)|b[3];}}catch(e){}return 0;}
function hook(api){const p=exp('ws2_32.dll',api);if(!p)return;Interceptor.attach(p,{onEnter(a){this.s=a[0].toUInt32();this.b=a[1];},onLeave(r){const n=r.toInt32();if(n>0){if(port(this.s)===%d){try{send({t:'data',hex:hx(this.b,n)});}catch(e){}}}}});}
hook('recvfrom'); hook('recv');

function wstrlen(p){let n=0;while(p.add(n*2).readU16()!==0 && n<8000)n++;return n;}
rpc.exports = {
  // anchorUtf8: 原文前若干字符(定位用); appendUtf8: 追加文本(含前缀); replaceUtf8: 替换文本
  inject: function(anchorUtf8, appendUtf8, replaceUtf8){
    function w(arr){const a=[];for(const c of arr)a.push(c.charCodeAt(0)&0xffff,(c.charCodeAt(0)>>16));return a;}
    function toW(s){const a=[];for(const ch of s){let c=ch.codePointAt(0); a.push(c);} return a;}
    const anchorW=[]; for(const ch of anchorUtf8) anchorW.push(ch.charCodeAt(0));
    const pat=anchorW.map(x=>('0'+x.toString(16)).slice(-2)+' '+('0'+((x>>8)&0xff).toString(16)).slice(-2)).join(' ');
    const out=[];
    Process.enumerateRanges('rw-').forEach(function(rg){
      if(rg.size>0x4000000) return;
      let hits; try{hits=Memory.scanSync(rg.base,rg.size,pat);}catch(e){return;}
      hits.forEach(function(h){
        const L=wstrlen(h.address);                 // 原文宽字符长度
        let Z=0; let q=h.address.add(L*2); while(q.add(Z*2).readU16()===0 && Z<8000)Z++;
        const cap=L+Z;
        const appendW=toW(appendUtf8), replaceW=toW(replaceUtf8);
        let mode=null;
        try{
          if(Z>=appendW.length+1){                  // 空位够: 追加
            let base=h.address.add(L*2);
            appendW.forEach(function(c,i){base.add(i*2).writeU16(c);});
            base.add(appendW.length*2).writeU16(0);
            mode='append';
          } else if(cap>=replaceW.length+1){         // 不够: 替换
            replaceW.forEach(function(c,i){h.address.add(i*2).writeU16(c);});
            h.address.add(replaceW.length*2).writeU16(0);
            mode='replace';
          } else mode='skip(tooTight)';
        }catch(e){mode='err:'+e;}
        const mod=Process.findModuleByAddress(h.address);
        out.push({addr:h.address.toString(),off:mod?(mod.name+'+0x'+h.address.sub(mod.base).toString(16)):'(heap)',origLen:L,zeros:Z,mode:mode});
      });
    });
    return out;
  }
};
send('READY');
""" % MAP_PORT

keys=[]; stream=bytearray(); locked={"k":None}; sref={"s":None}; jobq=queue.Queue()

def parse_subs(pt,num1):
    subs=[];pos=0
    if num1<2 or num1>len(pt): return None
    while pos<num1:
        if pos+2>len(pt): return None
        sl=be16(pt[pos:pos+2])
        if sl<2 or pos+2+sl>len(pt): return None
        subs.append(pt[pos+2:pos+2+sl]); pos+=2+sl
    return subs or None

last={"v":None}
def on_data(hexs):
    global stream
    stream+=bytes.fromhex(hexs)
    kp=[locked["k"]] if locked["k"] else keys
    while True:
        adv=False
        for start in range(0,min(len(stream),64)):
            if start+8>len(stream): break
            Lp=be32(stream[start:start+4]); num1=be32(stream[start+4:start+8])
            if Lp%16 or Lp<16 or Lp>0x40000 or num1>Lp or num1<2: continue
            if start+8+Lp>len(stream): continue
            ct=bytes(stream[start+8:start+8+Lp])
            for key in kp:
                try: pt=AES.new(key,AES.MODE_ECB).decrypt(ct)
                except Exception: continue
                subs=parse_subs(pt,num1)
                if subs is None: continue
                if not locked["k"]: locked["k"]=key
                for sub in subs:
                    if be16(sub[0:2]) in NPC_TEXT_OPCODES:
                        name,dia=clean_npc(sub)
                        if dia and len(dia)>=4 and dia!=last["v"]:
                            last["v"]=dia; jobq.put(dia)
                del stream[:start+8+Lp]; adv=True; break
            if adv: break
        if not adv: break
    if len(stream)>1<<20: del stream[:-4096]

def handler(msg,data):
    if msg.get("type")!="send":
        if msg.get("type")=="error": print("[JS ERR]",msg.get("stack"),flush=True)
        return
    p=msg["payload"]
    if p=="READY": print("[*] hook 就位, 去和 NPC 对话",flush=True); return
    if p.get("t")=="key":
        k=wswap(bytes.fromhex(p["rk"]))
        if k not in keys: keys.append(k)
    elif p.get("t")=="data": on_data(p["hex"])

def worker():
    while True:
        dia=jobq.get()
        zh=""
        try: zh=translate(dia)
        except Exception as e: print("翻译失败:",e,flush=True)
        if not zh: continue
        # 锚点: 原文第一行去掉控制符的前 12 字符(ASCII/可读), 用于在内存定位
        firstline=dia.split("\n")[0].strip()
        anchor=firstline[:12]
        if len(anchor)<4: anchor=dia[:12]
        time.sleep(WRITE_DELAY)
        try:
            res=sref["s"].exports_sync.inject(anchor, PREFIX+zh, zh)
            acted=[r for r in res if r["mode"] in ("append","replace")]
            print(f"\n[注入] 原文={firstline[:30]!r}... 译文={zh[:30]!r}",flush=True)
            for r in res: print(f"   {r['off']} origLen={r['origLen']} zeros={r['zeros']} -> {r['mode']}",flush=True)
            if not acted: print("   (未命中可写缓冲, 可能对话已关或锚点未匹配)",flush=True)
        except Exception as e:
            import traceback; traceback.print_exc()

def main():
    dev=frida.get_local_device()
    ecos=[p for p in dev.enumerate_processes() if p.name.lower()=="eco.exe"]
    if not ecos: print("没有 eco.exe"); return
    pid=max(ecos,key=lambda x:x.pid).pid
    print("[*] attach",pid,flush=True)
    s=dev.attach(pid); sref["s"]=s.create_script(JS); sref["s"].on("message",handler); sref["s"].load()
    threading.Thread(target=worker,daemon=True).start()
    while True: time.sleep(1)

if __name__=="__main__":
    main()
