'use strict';
// ===== AES-128 ECB (已验证) =====
const SBOX=[],INV=[];
(function(){let p=1,q=1;do{p=p^(p<<1)^(p&0x80?0x11b:0);p&=0xff;q^=q<<1;q^=q<<2;q^=q<<4;q&=0xff;if(q&0x80)q^=0x09;q&=0xff;const x=q^((q<<1)|(q>>7))^((q<<2)|(q>>6))^((q<<3)|(q>>5))^((q<<4)|(q>>4))^0x63;SBOX[p]=x&0xff;}while(p!==1);SBOX[0]=0x63;for(let i=0;i<256;i++)INV[SBOX[i]]=i;})();
function xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function mul(a,b){let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return r&0xff;}
const RCON=[0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
function expandKey(key){const rk=key.slice(0);for(let i=16,r=0;i<176;i+=4){let t=[rk[i-4],rk[i-3],rk[i-2],rk[i-1]];if(i%16===0){t=[t[1],t[2],t[3],t[0]];t=t.map(x=>SBOX[x]);t[0]^=RCON[r++];}for(let j=0;j<4;j++)rk[i+j]=rk[i+j-16]^t[j];}return rk;}
function encB(rk,inp){let s=inp.slice(0);for(let i=0;i<16;i++)s[i]^=rk[i];for(let rd=1;rd<10;rd++){s=s.map(x=>SBOX[x]);s=[s[0],s[5],s[10],s[15],s[4],s[9],s[14],s[3],s[8],s[13],s[2],s[7],s[12],s[1],s[6],s[11]];const o=[];for(let c=0;c<4;c++){const a=s.slice(c*4,c*4+4);o[c*4+0]=xtime(a[0])^(xtime(a[1])^a[1])^a[2]^a[3];o[c*4+1]=a[0]^xtime(a[1])^(xtime(a[2])^a[2])^a[3];o[c*4+2]=a[0]^a[1]^xtime(a[2])^(xtime(a[3])^a[3]);o[c*4+3]=(xtime(a[0])^a[0])^a[1]^a[2]^xtime(a[3]);}s=o;for(let i=0;i<16;i++)s[i]^=rk[rd*16+i];}s=s.map(x=>SBOX[x]);s=[s[0],s[5],s[10],s[15],s[4],s[9],s[14],s[3],s[8],s[13],s[2],s[7],s[12],s[1],s[6],s[11]];for(let i=0;i<16;i++)s[i]^=rk[160+i];return s;}
function decB(rk,inp){let s=inp.slice(0);for(let i=0;i<16;i++)s[i]^=rk[160+i];for(let rd=9;rd>=1;rd--){s=[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];s=s.map(x=>INV[x]);for(let i=0;i<16;i++)s[i]^=rk[rd*16+i];const o=[];for(let c=0;c<4;c++){const a=s.slice(c*4,c*4+4);o[c*4+0]=mul(a[0],14)^mul(a[1],11)^mul(a[2],13)^mul(a[3],9);o[c*4+1]=mul(a[0],9)^mul(a[1],14)^mul(a[2],11)^mul(a[3],13);o[c*4+2]=mul(a[0],13)^mul(a[1],9)^mul(a[2],14)^mul(a[3],11);o[c*4+3]=mul(a[0],11)^mul(a[1],13)^mul(a[2],9)^mul(a[3],14);}s=o;}s=[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];s=s.map(x=>INV[x]);for(let i=0;i<16;i++)s[i]^=rk[i];return s;}
// Avoid Array.push(...block) spreads on hot path (less GC pressure).
function ecbDec(rk,data){
  const o=new Array(data.length);
  for(let i=0;i<data.length;i+=16){
    const block=decB(rk,data.slice(i,i+16));
    for(let j=0;j<16;j++) o[i+j]=block[j];
  }
  return o;
}
function ecbEnc(rk,data){
  const o=new Array(data.length);
  for(let i=0;i<data.length;i+=16){
    const block=encB(rk,data.slice(i,i+16));
    for(let j=0;j<16;j++) o[i+j]=block[j];
  }
  return o;
}
function fnv1a(arr){let h=0x811c9dc5;for(let i=0;i<arr.length;i++){h^=arr[i];h=(h*0x01000193)>>>0;}return h>>>0;}

// Precomputed hex table for faster toHex (called on every dialogue packet).
const HEX=[]; for(let i=0;i<256;i++) HEX[i]=(i<16?'0':'')+i.toString(16);
function toHex(arr){let s=''; for(let i=0;i<arr.length;i++) s+=HEX[arr[i]&0xff]; return s;}
function fromHex(hex){
  const n=hex.length>>1; const a=new Array(n);
  for(let i=0,j=0;i<n;i++,j+=2) a[i]=parseInt(hex.substr(j,2),16);
  return a;
}
function appendBytes(dst, src){ for(let i=0;i<src.length;i++) dst.push(src[i]); return dst; }

function exp(d,f){try{const m=Process.findModuleByName(d);return m?m.findExportByName(f):null;}catch(e){return null;}}
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n)));}
function be16(a,i){return (a[i]<<8)|a[i+1];}
function be32(a,i){return ((a[i]<<24)|(a[i+1]<<16)|(a[i+2]<<8)|a[i+3])>>>0;}
function wbe32(v){return [(v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff];}

const m=Process.findModuleByName('eco.exe');
// Soft-disable + in-flight tracking for safe dispose().
// Detaching while a game thread is inside onEnter/onLeave can crash eco.exe
// (Windows Application Error 0xc0000409 in frida-agent.dll).
let HOOKS_ARMED=true; let IN_HOOK=0;
const HOOK_LISTENERS=[];
function enterHook(){ if(!HOOKS_ARMED) return false; IN_HOOK++; return true; }
function leaveHook(){ if(IN_HOOK>0) IN_HOOK--; }
function attachHook(target, callbacks){
  const listener=Interceptor.attach(target, callbacks);
  HOOK_LISTENERS.push(listener);
  return listener;
}
// 收割密钥(word-swap). KEYMAP: keyStr -> expanded round key (avoid re-expand on each frame).
const KEYMAP={}; let RK=null; let RK_OUT=null;
attachHook(m.base.add(0x18cc4),{
  onEnter(){
    if(!enterHook()) return;
    this._h=true;
    try{
      const rkbytes=hx(this.context.esp.add(4).readPointer(),16);
      const k=[]; for(let i=0;i<16;i+=4){k.push(rkbytes[i+3],rkbytes[i+2],rkbytes[i+1],rkbytes[i]);}
      const key=k.join(','); if(!KEYMAP[key]) KEYMAP[key]=expandKey(k);
    }catch(e){}
  },
  onLeave(){ if(this._h) leaveHook(); }
});

// 缓存: hash -> 整条替换后的 subdata(字节数组), 由 Python 按结构重建好
const CACHE={};
// In-flight need requests: avoid flooding Python (and RPC) for the same miss.
const PENDING={};
function looksLikeSub(sub, expectOp){
  // Minimal structural guard before injecting a rebuilt packet into the game.
  if(!sub||sub.length<4||sub.length>4000) return false;
  const op=be16(sub,0);
  if(expectOp!=null&&op!==expectOp) return false;
  if(op!==1017&&op!==1526) return false;
  return true;
}
function onCache(msg){
  if(msg.sub&&msg.sub.length){
    const h=msg.h>>>0;
    const bytes=fromHex(msg.sub);
    // Drop obviously bad rebuilds rather than feed them to eco.exe.
    if(looksLikeSub(bytes,null)) CACHE[h]=bytes;
    delete PENDING[h];
  }
  recv('cache',onCache);    // 重新注册(recv 是一次性)
}
recv('cache',onCache);

// 中文/英文 总开关 (F9 切换), false=放行英文原文
let ENABLED=true;
function onToggle(msg){ ENABLED=!!msg.on; recv('toggle',onToggle); }
recv('toggle',onToggle);

function getPort(s){const gpn=getPort._f||(getPort._f=new NativeFunction(exp('ws2_32.dll','getpeername'),'int',['uint','pointer','pointer']));try{const sa=Memory.alloc(32),ln=Memory.alloc(4);ln.writeInt(32);if(gpn(s,sa,ln)===0){const b=new Uint8Array(sa.readByteArray(4));return (b[2]<<8)|b[3];}}catch(e){}return 0;}

function rkFor(ctSample){
  // 用已锁定的; 否则试每个候选key, 谁解出来 num1<=Lp 合理就锁定
  if(RK) return RK;
  return null;
}

function processFrame(buf, off){
  // 返回 {consumed, newBytes(array)|null}; null=原样
  if(off+8>buf.length) return null;
  const Lp=be32(buf,off), num1=be32(buf,off+4);
  if((Lp%16)||Lp<16||Lp>0x40000||num1>Lp||num1<2) return null;
  if(off+8+Lp>buf.length) return null;
  const ct=buf.slice(off+8,off+8+Lp);
  // 找能解密的 key
  let rk=RK, pt=null;
  if(rk){ pt=ecbDec(rk,ct); if(!validPlain(pt,num1)) pt=null; }
  if(!pt){
    // Try pre-expanded candidate keys (no re-expand / re-split per frame).
    for(const r of Object.keys(KEYMAP)){
      const expanded=KEYMAP[r];
      const d=ecbDec(expanded,ct);
      if(validPlain(d,num1)){ rk=expanded; RK=expanded; pt=d; break; }
    }
  }
  if(!pt) return {consumed:8+Lp,newBytes:null};
  // 解析子包, 找 op1017
  let pos=0, modified=false, waitedThisFrame=false; const subs=[];
  while(pos<num1){
    const sl=be16(pt,pos); if(sl<2||pos+2+sl>pt.length) break;
    const sub=pt.slice(pos+2,pos+2+sl); subs.push(sub); pos+=2+sl;
  }
  for(let i=0;i<subs.length;i++){
    const op=be16(subs[i],0);
    // 采集(只读): 事件边界/NPC id/执行中eventid, 供 Python 维护 eventid 上下文
    if(op===1500||op===1501||op===1511||op===1512){
      send({t:'ctx',op:op,sub:toHex(subs[i])});
      continue;
    }
    if(op===1017||op===1526){
      // 采集(只读): 先把英文原文上报(缓存命中也照采), 不受翻译改包影响
      // Encode once; reuse for harvest + need (was double map/join before).
      const hexsub=toHex(subs[i]);
      send({t:'harvest',op:op,sub:hexsub});
      const h=fnv1a(subs[i])>>>0;
      const cached=CACHE[h];
      if(cached&&looksLikeSub(cached,op)){
        subs[i]=cached; modified=true; send({t:'hit',h:h});
      } else {
        // Default: never block recvfrom (multi-packet dialogue used to freeze eco.exe).
        // Optional first-wait: only for short frames (≤2 dialogue subs) when configured.
        const firstWaitMs=__FIRST_WAIT_MS__;
        let dialogueCount=0;
        for(let j=0;j<subs.length;j++){
          const o=be16(subs[j],0);
          if(o===1017||o===1526) dialogueCount++;
        }
        const allowSync=firstWaitMs>0&&dialogueCount>0&&dialogueCount<=2&&!processFrame._waiting&&!waitedThisFrame;
        const now=Date.now();
        if(!PENDING[h]||(now-PENDING[h])>15000){
          PENDING[h]=now;
          send({t:'need',h:h,op:op,sub:hexsub,sync:allowSync});
        }
        if(allowSync){
          waitedThisFrame=true;
          processFrame._waiting=true;
          try{
            // Frida recv(type, cb): a lone string is the callback, not the type.
            let reply=null;
            recv('t'+h, function(value){ reply=value; }).wait();
            const hex=(reply&&(reply.sub||(reply.payload&&reply.payload.sub)))||'';
            if(hex){
              const bytes=fromHex(hex);
              if(looksLikeSub(bytes,op)){
                subs[i]=bytes; modified=true; CACHE[h]=bytes; send({t:'hit',h:h});
              }
            }
          }catch(e){ /* timeout/empty → keep English this frame */ }
          processFrame._waiting=false;
          delete PENDING[h];
        }
      }
    }
  }
  if(!modified) return {consumed:8+Lp,newBytes:null};
  // 重建 payload
  let payload=[];
  for(const sub of subs){ payload.push((sub.length>>8)&0xff, sub.length&0xff); appendBytes(payload, sub); }
  const newNum1=payload.length;
  // Guard: absurdly large rebuilt frames are more likely bad data than valid UI.
  if(newNum1>0x20000||payload.length>0x20000) return {consumed:8+Lp,newBytes:null};
  while(payload.length%16!==0) payload.push(0);
  const newCt=ecbEnc(rk,payload);
  const frame=wbe32(payload.length);
  appendBytes(frame, wbe32(newNum1));
  appendBytes(frame, newCt);
  return {consumed:8+Lp,newBytes:frame};
}
function validPlain(pt,num1){
  if(num1<2||num1>pt.length) return false;
  let pos=0,cnt=0;
  while(pos<num1){if(pos+2>pt.length)return false;const sl=be16(pt,pos);if(sl<2||pos+2+sl>pt.length)return false;pos+=2+sl;cnt++;}
  return cnt>0;
}

// Passive C->S observer. It never changes bytes; op1510 is the NPC/event ID
// the unmodified client requested after a legitimate click/trigger.
function processClientFrame(buf, off){
  if(off+8>buf.length) return null;
  const Lp=be32(buf,off), num1=be32(buf,off+4);
  if((Lp%16)||Lp<16||Lp>0x40000||num1>Lp||num1<2) return null;
  if(off+8+Lp>buf.length) return null;
  const ct=buf.slice(off+8,off+8+Lp);
  let rk=RK_OUT, pt=null;
  if(rk){pt=ecbDec(rk,ct);if(!validPlain(pt,num1))pt=null;}
  if(!pt){
    for(const key of Object.keys(KEYMAP)){
      const candidate=KEYMAP[key], d=ecbDec(candidate,ct);
      if(validPlain(d,num1)){rk=candidate;RK_OUT=candidate;pt=d;break;}
    }
  }
  if(!pt) return 8+Lp;
  let pos=0;
  while(pos<num1){
    const sl=be16(pt,pos);if(sl<2||pos+2+sl>pt.length)break;
    const sub=pt.slice(pos+2,pos+2+sl);pos+=2+sl;
    const op=be16(sub,0);
    if(op===1510) send({t:'request',op:op,sub:toHex(sub)});
  }
  return 8+Lp;
}

const pRecvfrom=exp('ws2_32.dll','recvfrom');
if(pRecvfrom) attachHook(pRecvfrom,{
  onEnter(a){
    if(!enterHook()) return;
    this._h=true;
    this.s=a[0].toUInt32();this.b=a[1];this.cap=a[2].toInt32();
  },
  onLeave(r){
    if(!this._h) return;
    try{
      if(!HOOKS_ARMED) return;
      const n=r.toInt32(); if(n<=0) return;
      if(!ENABLED) return;                          // 关闭=放行英文原文
      if(getPort(this.s)!==__MAP_PORT__) return;
      try{
        const buf=hx(this.b,n);
        let off=0, out=[], changed=false;
        while(off<buf.length){
          const res=processFrame(buf,off);
          if(res===null){ appendBytes(out, buf.slice(off)); break; }       // 半包/异常: 余下原样
          if(res.newBytes){ appendBytes(out, res.newBytes); changed=true; }
          else appendBytes(out, buf.slice(off,off+res.consumed));
          off+=res.consumed;
        }
        if(changed && out.length<=this.cap){
          this.b.writeByteArray(out);
          r.replace(ptr(out.length));
        }
      }catch(e){ /* 出错原样放行 */ }
    }finally{ leaveHook(); }
  }
});

const pSendto=exp('ws2_32.dll','sendto');
if(pSendto) attachHook(pSendto,{
  onEnter(a){
    if(!enterHook()) return;
    try{
      const s=a[0].toUInt32(), b=a[1], n=a[2].toInt32();
      if(n<=0||getPort(s)!==__MAP_PORT__) return;
      const buf=hx(b,n);let off=0;
      while(off<buf.length){const consumed=processClientFrame(buf,off);if(consumed===null)break;off+=consumed;}
    }catch(e){}finally{leaveHook();}
  }
});

// Called by Python before unload so ws2_32 hooks are fully removed.
// Prefer per-listener detach after IN_HOOK drains; avoid detachAll while busy
// (common cause of eco.exe + frida-agent 0xc0000409).
rpc.exports = {
  dispose() {
    HOOKS_ARMED = false;
    ENABLED = false;
    const deadline = Date.now() + 6000;
    while (IN_HOOK > 0 && Date.now() < deadline) {
      // Spin — other game threads finish onLeave and decrement IN_HOOK.
    }
    const drained = IN_HOOK === 0;
    if (drained) {
      for (let i = 0; i < HOOK_LISTENERS.length; i++) {
        try { HOOK_LISTENERS[i].detach(); } catch (e) {}
      }
      HOOK_LISTENERS.length = 0;
    }
    // If still in-hook, leave soft-disabled stubs; force-detach risks crash.
    return { ok: true, drained: drained, inHook: IN_HOOK };
  }
};

send('READY');
