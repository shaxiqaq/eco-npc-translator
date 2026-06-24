# -*- coding: utf-8 -*-
"""
Part 2 — ECO 实时协议嗅探/解密器  (纯 hook, 无需 Wireshark)
  * hook ws2_32 send/recv (+WSASend/WSARecv) 抓取每条连接的密文
  * hook 内置 AES 加密函数 (RVA 0x18cc4) 自动收割本会话所有 AES-128 密钥
  * 按 SagaLib 线缆帧结构分帧:  [u32 Lp][u32 num1][密文 Lp 字节(ECB)]
      明文 = AES-128-ECB-decrypt(key, 密文);  仅前 num1 字节有效(其余为补齐)
      明文内子包:  [u32 sublen][子包数据];  opcode = 子包前2字节(大端)
  * 用 opcodes.json (从 SagaECO 源码生成) 标注 opcode 名称, 实时打印 + 落日志
用法:  python eco_sniffer.py
"""
import frida, time, datetime, json, os, sys, re
from Crypto.Cipher import AES

HERE = os.path.dirname(os.path.abspath(__file__))
OPC  = json.load(open(os.path.join(HERE, "opcodes.json"), encoding="utf-8"))
SCHEMAS = json.load(open(os.path.join(HERE, "schemas.json"), encoding="utf-8"))

# 端口->服务器类型 固定映射 (实测自某 ECO 私服:
#   12000/12001 走 login opcode 空间(op10/11=PING/PONG, 含好友/社区),
#   12002 = 地图/游戏服). 不在表内的端口走自动判定.
PORT_SERVER = {12000: "LOGIN", 12001: "LOGIN", 12002: "MAP"}
TEXT_ENCODING = "utf-8"   # Global.Unicode = UTF-8 (撇号 e2 80 99、泰文均为多字节)
LOGDIR = os.path.join(HERE, "logs"); os.makedirs(LOGDIR, exist_ok=True)
LOGF = open(os.path.join(LOGDIR, datetime.datetime.now().strftime("sniff_%Y%m%d_%H%M%S.log")),
            "w", encoding="utf-8", buffering=1)
RVA_AES = 0x18cc4

def wswap(b): return b"".join(b[i:i+4][::-1] for i in range(0, len(b), 4))
def be16(b): return (b[0] << 8) | b[1]
def be32(b): return int.from_bytes(b[0:4], "big")
def ts(): return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
def out(s):
    print(s, flush=True); LOGF.write(s + "\n")

port_type = {}     # port -> 'LOGIN' / 'MAP' / None
port_score = {}    # port -> [login_score, map_score]

def lookup_class(opcode, direction, srv):
    """返回 (classname, srv_used)。srv: 'LOGIN'/'MAP'/None(未定)"""
    op = str(opcode)
    lt = OPC["c2s_login"] if direction=="C->S" else OPC["s2c_login"]
    mt = OPC["c2s_map"]   if direction=="C->S" else OPC["s2c_map"]
    inl, inm = lt.get(op), mt.get(op)
    if srv == "LOGIN" and inl: return inl, "LOGIN"
    if srv == "MAP" and inm:   return inm, "MAP"
    if inm: return inm, "MAP"
    if inl: return inl, "LOGIN"
    return None, None

def update_port_type(port, opcode, direction):
    """按 opcode 是否为某服务器独有, 累积评分判定该连接是 login 还是 map"""
    op = str(opcode)
    lt = OPC["c2s_login"] if direction=="C->S" else OPC["s2c_login"]
    mt = OPC["c2s_map"]   if direction=="C->S" else OPC["s2c_map"]
    inl, inm = op in lt, op in mt
    sc = port_score.setdefault(port, [0,0])
    if inl and not inm: sc[0]+=1
    elif inm and not inl: sc[1]+=1
    if   sc[1] > sc[0]: port_type[port] = "MAP"
    elif sc[0] > sc[1]: port_type[port] = "LOGIN"

TYPE_DECODE = {
    "u8": (1,False),"i8":(1,True),"u16":(2,False),"i16":(2,True),
    "u32":(4,False),"i32":(4,True),"u64":(8,False),"i64":(8,True),"f32":(4,None),
}
def decode_fields(classname, subdata):
    sch = SCHEMAS.get(classname)
    if not sch or not sch.get("fields"): return ""
    parts=[]
    for name,typ,off in sch["fields"]:
        sz,signed = TYPE_DECODE.get(typ,(0,None))[0], TYPE_DECODE.get(typ,(0,None))[1]
        if sz==0 or off+sz > len(subdata): continue
        raw = subdata[off:off+sz]
        if typ=="f32":
            import struct; val=struct.unpack(">f",raw)[0]
        else:
            val=int.from_bytes(raw,"big",signed=signed)
        parts.append(f"{name}={val}")
    return "  {" + ", ".join(parts) + "}" if parts else ""

# ---------------- Frida JS ----------------
JS = r"""
'use strict';
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n))).map(x=>('0'+x.toString(16)).slice(-2)).join('');}
function exp(dll,fn){ try{ const mm=Process.findModuleByName(dll); return mm?mm.findExportByName(fn):null; }catch(e){ return null; } }
const m = Process.findModuleByName('eco.exe');

// 1) 收割 AES 密钥
const FN = m.base.add(%d);
Interceptor.attach(FN, { onEnter(){ try{ send({t:'key', rk:hx(this.context.esp.add(4).readPointer(),16)}); }catch(e){} } });

// getpeername 取远端端口
const gpn = new NativeFunction(exp('ws2_32.dll','getpeername'),'int',['uint','pointer','pointer']);
function peerPort(sock){
  try{
    const sa = Memory.alloc(32), ln = Memory.alloc(4); ln.writeInt(32);
    if(gpn(sock, sa, ln)===0){ const b=new Uint8Array(sa.readByteArray(4)); return (b[2]<<8)|b[3]; }
  }catch(e){}
  return 0;
}

function cap(dir, sock, buf, len){
  if(len<=0) return;
  try{ send({t:'data', dir:dir, sock:sock>>>0, port:peerPort(sock), hex:hx(buf,len)}); }catch(e){}
}

// 2) send / recv
const pSend = exp('ws2_32.dll','send');
if(pSend) Interceptor.attach(pSend,{ onEnter(a){ this.s=a[0].toUInt32(); this.b=a[1]; this.l=a[2].toInt32(); },
  onLeave(r){ if(r.toInt32()>0) cap('C->S', this.s, this.b, this.l); } });

const pRecv = exp('ws2_32.dll','recv');
if(pRecv) Interceptor.attach(pRecv,{ onEnter(a){ this.s=a[0].toUInt32(); this.b=a[1]; },
  onLeave(r){ const n=r.toInt32(); if(n>0) cap('S->C', this.s, this.b, n); } });

// 实测本客户端走 sendto/recvfrom
const pSendto = exp('ws2_32.dll','sendto');
if(pSendto) Interceptor.attach(pSendto,{ onEnter(a){ this.s=a[0].toUInt32(); this.b=a[1]; this.l=a[2].toInt32(); },
  onLeave(r){ if(r.toInt32()>0) cap('C->S', this.s, this.b, this.l); } });
const pRecvfrom = exp('ws2_32.dll','recvfrom');
if(pRecvfrom) Interceptor.attach(pRecvfrom,{ onEnter(a){ this.s=a[0].toUInt32(); this.b=a[1]; },
  onLeave(r){ const n=r.toInt32(); if(n>0) cap('S->C', this.s, this.b, n); } });

// 3) WSASend / WSARecv (overlapped, 解析 WSABUF 数组)
function wsabufs(pBuf, cnt, limitBytes){ // 返回拼接的前 limitBytes
  let res=''; let remain=limitBytes;
  for(let i=0;i<cnt && remain>0;i++){
    const e=pBuf.add(i*8); const blen=e.readU32(); const bptr=e.add(4).readPointer();
    const take=Math.min(blen, remain); if(take>0){ res+=hx(bptr,take); remain-=take; }
  }
  return res;
}
const pWSASend = exp('ws2_32.dll','WSASend');
if(pWSASend) Interceptor.attach(pWSASend,{ onEnter(a){
  try{ const s=a[0].toUInt32(); const cnt=a[2].toUInt32();
    let tot=0; for(let i=0;i<cnt;i++) tot+=a[1].add(i*8).readU32();
    if(tot>0) send({t:'data',dir:'C->S',sock:s,port:peerPort(s),hex:wsabufs(a[1],cnt,tot)});
  }catch(e){} } });
const pWSARecv = exp('ws2_32.dll','WSARecv');
if(pWSARecv) Interceptor.attach(pWSARecv,{ onEnter(a){ this.s=a[0].toUInt32(); this.buf=a[1]; this.cnt=a[2].toUInt32(); this.pn=a[3]; },
  onLeave(r){ try{ if(r.toInt32()===0 && !this.pn.isNull()){ const n=this.pn.readU32();
    if(n>0) send({t:'data',dir:'S->C',sock:this.s,port:peerPort(this.s),hex:wsabufs(this.buf,this.cnt,n)}); } }catch(e){} } });

send('READY');
""" % RVA_AES

# ---------------- Python 侧解析 ----------------
keys = []                 # 候选 AES-128 密钥(原始 bytes)
streams = {}              # (sock,dir) -> bytearray 缓冲
sock_key = {}             # (sock,dir) -> 锁定的 key
sock_port = {}            # sock -> port

def add_key(rk_hex):
    k = wswap(bytes.fromhex(rk_hex))
    if k not in keys:
        keys.append(k)
        out(f"[{ts()}] [KEY] 收割到密钥 #{len(keys)}: {k.hex()}")

def try_parse_plain(pt, num1):
    """校验+解析明文内子包; 子包 = [u16 sublen(大端)][subdata]; opcode=subdata 前2字节
       返回 (ok, [(opcode, subdata_bytes)])"""
    subs = []; pos = 0
    if num1 < 2 or num1 > len(pt): return False, subs
    while pos < num1:
        if pos + 2 > len(pt): return False, subs
        sublen = be16(pt[pos:pos+2])              # 子包长度(含2字节opcode)
        if sublen < 2 or pos + 2 + sublen > len(pt): return False, subs
        subdata = pt[pos+2:pos+2+sublen]
        subs.append((be16(subdata[0:2]), subdata))
        pos += 2 + sublen
    return (len(subs) > 0), subs

def decode_frame(Lp, num1, ct, key):
    if len(ct) != Lp or Lp % 16 != 0: return None
    try: pt = AES.new(key, AES.MODE_ECB).decrypt(ct)
    except Exception: return None
    ok, subs = try_parse_plain(pt, num1)
    return subs if ok else None

def process(sock, direction, data):
    buf = streams.setdefault((sock, direction), bytearray())
    buf += data
    keypool = ([sock_key[(sock,direction)]] if (sock,direction) in sock_key else keys)
    progressed = True
    while progressed:
        progressed = False
        # 在 buf 前 64 字节内寻找一个可解析的帧起点(处理中途接入的错位)
        for start in range(0, min(len(buf), 64)):
            if start + 8 > len(buf): break
            Lp = be32(buf[start:start+4]); num1 = be32(buf[start+4:start+8])
            if Lp % 16 != 0 or Lp < 16 or Lp > 0x40000: continue
            if num1 > Lp or num1 < 4: continue
            if start + 8 + Lp > len(buf): continue  # 帧未收全
            ct = bytes(buf[start+8:start+8+Lp])
            for key in keypool:
                subs = decode_frame(Lp, num1, ct, key)
                if subs is not None:
                    if (sock,direction) not in sock_key:
                        sock_key[(sock,direction)] = key
                        out(f"[{ts()}] [LOCK] sock={sock} {direction} 端口{sock_port.get(sock,'?')} 绑定密钥 {key.hex()}")
                    emit(sock, direction, subs)
                    del buf[:start+8+Lp]
                    progressed = True
                    break
            if progressed: break
    # 防止缓冲无限增长
    if len(buf) > 1<<20: del buf[:-4096]

def emit(sock, direction, subs):
    port = sock_port.get(sock, "?")
    for opcode, subdata in subs:
        update_port_type(port, opcode, direction)
        srv = PORT_SERVER.get(port) or port_type.get(port)   # 固定映射优先, 否则自动判定
        classname, srv_used = lookup_class(opcode, direction, srv)
        name = classname or "UNKNOWN"
        fields = decode_fields(classname, subdata) if classname else ""
        strs = decode_strings(classname, subdata) if classname else ""
        body = subdata[2:]
        hexs = body.hex()
        if len(hexs) > 96: hexs = hexs[:96] + f"..(+{len(body)-48}B)"
        arrow = "►" if direction=="C->S" else "◄"
        srvtag = (srv or "?")
        extra = strs if strs else ascii_gloss(body)     # 结构化文本优先, 否则 ascii 旁注
        out(f"[{ts()}] {arrow} {direction} :{port}[{srvtag}]  op={opcode:<5} {name}{fields}{extra}  [{hexs}]")

def _txt(b):
    return b.split(b"\x00")[0].decode(TEXT_ENCODING, "replace")

def decode_strings(classname, subdata):
    """聊天/NPC 文本结构化解码 -> ' text="..."' 等"""
    try:
        if classname in ("CSMG_CHAT_PUBLIC","CSMG_CHAT_PARTY","CSMG_CHAT_RING","CSMG_CHAT_SIGN","CSMG_CHAT_SIT"):
            n = subdata[2] - 1
            return '  text="%s"' % _txt(subdata[3:3+n])
        if classname == "SSMG_CHAT_PUBLIC":
            aid = int.from_bytes(subdata[2:6],"big"); n = subdata[6]
            return '  actor=0x%08x text="%s"' % (aid, _txt(subdata[7:7+n]))
        # 其它聊天/NPC 文本类: 提取可打印片段
        if any(k in classname for k in ("CHAT","NPC_MESSAGE","NPC_INPUTBOX","WHISPER","RECRUIT","BBS")):
            runs = re.findall(rb"[\x20-\x7e\xa1-\xfe]{3,}", subdata[2:])
            if runs:
                return '  text="%s"' % " | ".join(r.decode(TEXT_ENCODING,"replace") for r in runs)
    except Exception:
        pass
    return ""

def ascii_gloss(b):
    """若 body 中含可读文本(>=4连续可打印字符), 附 ascii 明文"""
    s = "".join(chr(c) if 32 <= c < 127 else "." for c in b)
    import re as _re
    runs = _re.findall(r"[ -~]{4,}", s)
    return ("  ascii=\"" + " | ".join(runs) + "\"") if runs else ""

def handler(msg, data):
    if msg.get("type") != "send":
        if msg.get("type")=="error": out("[JS ERR] " + str(msg.get("stack")))
        return
    p = msg["payload"]
    if p == "READY":
        out(f"[{ts()}] hook 就位; 请在客户端操作产生流量..."); return
    if p.get("t") == "key":
        add_key(p["rk"]); return
    if p.get("t") == "data":
        sock = p["sock"];
        if p.get("port"): sock_port[sock] = p["port"]
        try: data_bytes = bytes.fromhex(p["hex"])
        except Exception: return
        process(sock, p["dir"], data_bytes)

def main():
    dev = frida.get_local_device()
    ecos = [pr for pr in dev.enumerate_processes() if pr.name.lower()=="eco.exe"]
    if not ecos:
        out("没有运行中的 eco.exe"); return
    pid = max(ecos, key=lambda x:x.pid).pid
    out(f"[{ts()}] === ECO 协议嗅探器, attach PID={pid}, 日志 -> {LOGF.name} ===")
    s = dev.attach(pid)
    sc = s.create_script(JS); sc.on("message", handler); sc.load()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        out("退出"); s.detach()

if __name__ == "__main__":
    main()
