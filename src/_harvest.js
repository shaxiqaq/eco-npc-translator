'use strict';
// ECO 只读采集器: 解密 S->C, 把 op1017(对话)/op1526(菜单)/op1512(当前eventid) 原文上报 Python。
// 不修改任何封包(read-only), 不注入, 零风险。AES 解密逻辑同 _mitm.js(已验证)。
const SBOX=[],INV=[];
(function(){let p=1,q=1;do{p=p^(p<<1)^(p&0x80?0x11b:0);p&=0xff;q^=q<<1;q^=q<<2;q^=q<<4;q&=0xff;if(q&0x80)q^=0x09;q&=0xff;const x=q^((q<<1)|(q>>7))^((q<<2)|(q>>6))^((q<<3)|(q>>5))^((q<<4)|(q>>4))^0x63;SBOX[p]=x&0xff;}while(p!==1);SBOX[0]=0x63;for(let i=0;i<256;i++)INV[SBOX[i]]=i;})();
function mul(a,b){let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return r&0xff;}
const RCON=[0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
function expandKey(key){const rk=key.slice(0);for(let i=16,r=0;i<176;i+=4){let t=[rk[i-4],rk[i-3],rk[i-2],rk[i-1]];if(i%16===0){t=[t[1],t[2],t[3],t[0]];t=t.map(x=>SBOX[x]);t[0]^=RCON[r++];}for(let j=0;j<4;j++)rk[i+j]=rk[i+j-16]^t[j];}return rk;}
function decB(rk,inp){let s=inp.slice(0);for(let i=0;i<16;i++)s[i]^=rk[160+i];for(let rd=9;rd>=1;rd--){s=[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];s=s.map(x=>INV[x]);for(let i=0;i<16;i++)s[i]^=rk[rd*16+i];const o=[];for(let c=0;c<4;c++){const a=s.slice(c*4,c*4+4);o[c*4+0]=mul(a[0],14)^mul(a[1],11)^mul(a[2],13)^mul(a[3],9);o[c*4+1]=mul(a[0],9)^mul(a[1],14)^mul(a[2],11)^mul(a[3],13);o[c*4+2]=mul(a[0],13)^mul(a[1],9)^mul(a[2],14)^mul(a[3],11);o[c*4+3]=mul(a[0],11)^mul(a[1],13)^mul(a[2],9)^mul(a[3],14);}s=o;}s=[s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];s=s.map(x=>INV[x]);for(let i=0;i<16;i++)s[i]^=rk[i];return s;}
function ecbDec(rk,data){const o=[];for(let i=0;i<data.length;i+=16)o.push(...decB(rk,data.slice(i,i+16)));return o;}

function exp(d,f){try{const m=Process.findModuleByName(d);return m?m.findExportByName(f):null;}catch(e){return null;}}
function hx(p,n){return Array.from(new Uint8Array(p.readByteArray(n)));}
function be16(a,i){return (a[i]<<8)|a[i+1];}
function be32(a,i){return ((a[i]<<24)|(a[i+1]<<16)|(a[i+2]<<8)|a[i+3])>>>0;}

const m=Process.findModuleByName('eco.exe');
let KEYS=[]; let RK=null;
Interceptor.attach(m.base.add(0x18cc4),{onEnter(){try{
  const rkbytes=hx(this.context.esp.add(4).readPointer(),16);
  const k=[]; for(let i=0;i<16;i+=4){k.push(rkbytes[i+3],rkbytes[i+2],rkbytes[i+1],rkbytes[i]);}
  const key=k.join(','); if(KEYS.indexOf(key)<0) KEYS.push(key);
}catch(e){}}});

function getPort(s){const gpn=getPort._f||(getPort._f=new NativeFunction(exp('ws2_32.dll','getpeername'),'int',['uint','pointer','pointer']));try{const sa=Memory.alloc(32),ln=Memory.alloc(4);ln.writeInt(32);if(gpn(s,sa,ln)===0){const b=new Uint8Array(sa.readByteArray(4));return (b[2]<<8)|b[3];}}catch(e){}return 0;}

function validPlain(pt,num1){
  if(num1<2||num1>pt.length) return false;
  let pos=0,cnt=0;
  while(pos<num1){if(pos+2>pt.length)return false;const sl=be16(pt,pos);if(sl<2||pos+2+sl>pt.length)return false;pos+=2+sl;cnt++;}
  return cnt>0;
}

function processFrame(buf, off){
  if(off+8>buf.length) return null;
  const Lp=be32(buf,off), num1=be32(buf,off+4);
  if((Lp%16)||Lp<16||Lp>0x40000||num1>Lp||num1<2) return null;
  if(off+8+Lp>buf.length) return null;
  const ct=buf.slice(off+8,off+8+Lp);
  let rk=RK, pt=null;
  if(rk){ pt=ecbDec(rk,ct); if(!validPlain(pt,num1)) pt=null; }
  if(!pt){
    for(const ks of KEYS){const kk=ks.split(',').map(Number);const r=expandKey(kk);const d=ecbDec(r,ct);if(validPlain(d,num1)){rk=r;RK=r;pt=d;break;}}
  }
  if(!pt) return 8+Lp;                       // 解不出, 跳过该帧
  let pos=0;
  while(pos<num1){
    const sl=be16(pt,pos); if(sl<2||pos+2+sl>pt.length) break;
    const sub=pt.slice(pos+2,pos+2+sl); pos+=2+sl;
    const op=be16(sub,0);
    // 对话/菜单 + 事件边界(1500/1501) + NPC id 来源(1511) + 执行中eventid(1512)
    if(op===1017||op===1526||op===1500||op===1501||op===1511||op===1512){
      const hexsub=sub.map(x=>('0'+x.toString(16)).slice(-2)).join('');
      send({op:op, sub:hexsub});
    }
  }
  return 8+Lp;
}

const pRecvfrom=exp('ws2_32.dll','recvfrom');
if(pRecvfrom) Interceptor.attach(pRecvfrom,{
  onEnter(a){this.s=a[0].toUInt32();this.b=a[1];},
  onLeave(r){
    const n=r.toInt32(); if(n<=0) return;
    if(getPort(this.s)!==__MAP_PORT__) return;
    try{
      const buf=hx(this.b,n);
      let off=0;
      while(off<buf.length){
        const consumed=processFrame(buf,off);
        if(consumed===null){ break; }          // 半包: 余下不管(只读)
        off+=consumed;
      }
    }catch(e){ /* 只读, 出错忽略 */ }
  }
});
send('READY');
