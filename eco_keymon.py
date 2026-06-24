# -*- coding: utf-8 -*-
"""
Part 1 — ECO 客户端 AES 密钥长驻监听器
  * 自动附加 eco.exe, 客户端重启会自动重新附加
  * hook 内置 Rijndael 加密函数 (RVA 0x18cc4)
  * 提取轮密钥前16字节 -> 每4字节字节翻转 = 真实 AES-128 密钥
  * 标准 AES-128-ECB 现场验证
  * 每发现一把新密钥, 追加写入 keys.jsonl (含时间/连接指针/验证结果)
用法:  python eco_keymon.py
"""
import frida, time, datetime, json, os, sys
from Crypto.Cipher import AES

HERE = os.path.dirname(os.path.abspath(__file__))
KEYFILE = os.path.join(HERE, "keys.jsonl")
RVA = 0x18cc4

def wswap(b): return b"".join(b[i:i+4][::-1] for i in range(0, len(b), 4))
def now(): return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

JS = r"""
'use strict';
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');}
const m = Process.findModuleByName('eco.exe');
const FN = m.base.add(%d);
Interceptor.attach(FN, {
  onEnter(){ const c=this.context;
    try{
      this.rk=c.esp.add(4).readPointer();
      this.pt=c.esp.add(12).readPointer();
      this.ct=c.esp.add(16).readPointer();
      this.key=hx(this.rk,16); this.ptx=hx(this.pt,16); this.rkaddr=this.rk;
    }catch(e){this.bad=1;}
  },
  onLeave(){ if(this.bad)return;
    let ctx; try{ctx=hx(this.ct,16);}catch(e){return;}
    send({key:this.key, pt:this.ptx, ct:ctx, conn:this.rkaddr.toString()});
  }
});
send('READY');
""" % RVA

seen = {}   # realkey_hex -> True
def record(realkey_hex, verified, conn):
    if realkey_hex in seen: return
    seen[realkey_hex] = True
    spaced = " ".join(realkey_hex[i:i+2] for i in range(0,len(realkey_hex),2))
    rec = {"time": now(), "key": realkey_hex, "key_spaced": spaced,
           "verified": verified, "conn_ptr": conn}
    with open(KEYFILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    tag = "VERIFIED" if verified else "UNVERIFIED"
    print(f"[{now()}] 新密钥({tag}) conn={conn}\n    {spaced}", flush=True)

def make_handler():
    def h(msg, data):
        if msg.get("type") != "send":
            if msg.get("type")=="error": print("[JS ERR]", msg.get("stack"), flush=True)
            return
        p = msg["payload"]
        if p == "READY":
            print(f"[{now()}] hook 就位, 监听中...", flush=True); return
        rk = bytes.fromhex(p["key"]); pt = bytes.fromhex(p["pt"]); ct = bytes.fromhex(p["ct"])
        realkey = wswap(rk)
        try: verified = AES.new(realkey, AES.MODE_ECB).encrypt(pt) == ct
        except Exception: verified = False
        record(realkey.hex(), verified, p["conn"])
    return h

print(f"[{now()}] === ECO 密钥监听器启动, 输出 -> {KEYFILE} ===", flush=True)
attached = {}   # pid -> session
dev = frida.get_local_device()
while True:
    try:
        live = {p.pid for p in dev.enumerate_processes() if p.name.lower()=="eco.exe"}
        # 清理已退出
        for pid in list(attached):
            if pid not in live:
                print(f"[{now()}] eco.exe PID={pid} 已退出", flush=True)
                attached.pop(pid, None)
        # 附加新出现的
        for pid in live:
            if pid not in attached:
                try:
                    s = dev.attach(pid)
                    sc = s.create_script(JS)
                    sc.on("message", make_handler())
                    sc.load()
                    attached[pid] = s
                    print(f"[{now()}] 已附加 eco.exe PID={pid}", flush=True)
                except Exception as e:
                    print(f"[{now()}] 附加 PID={pid} 失败(将重试): {e}", flush=True)
    except Exception as e:
        print(f"[{now()}] 轮询错误: {e}", flush=True)
    time.sleep(2)
