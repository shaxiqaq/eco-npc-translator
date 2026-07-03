'use strict';
// Read-only combat packet capture for ECO.
// Decrypts map-server frames in process and reports selected subpackets to Python.

const SBOX = [], INV = [];
(function () {
  let p = 1, q = 1;
  do {
    p = p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0); p &= 0xff;
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
    if (q & 0x80) q ^= 0x09; q &= 0xff;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^
      ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)) ^ 0x63;
    SBOX[p] = x & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();

function mul(a, b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return r & 0xff;
}

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
function xtime(a) {
  a <<= 1;
  if (a & 0x100) a ^= 0x11b;
  return a & 0xff;
}
function expandKey(key) {
  const rk = key.slice(0);
  for (let i = 16, r = 0; i < 176; i += 4) {
    let t = [rk[i - 4], rk[i - 3], rk[i - 2], rk[i - 1]];
    if (i % 16 === 0) {
      t = [t[1], t[2], t[3], t[0]];
      t = t.map(x => SBOX[x]);
      t[0] ^= RCON[r++];
    }
    for (let j = 0; j < 4; j++) rk[i + j] = rk[i + j - 16] ^ t[j];
  }
  return rk;
}

function encB(rk, inp) {
  let s = inp.slice(0);
  for (let i = 0; i < 16; i++) s[i] ^= rk[i];
  for (let rd = 1; rd < 10; rd++) {
    s = s.map(x => SBOX[x]);
    s = [s[0], s[5], s[10], s[15], s[4], s[9], s[14], s[3],
         s[8], s[13], s[2], s[7], s[12], s[1], s[6], s[11]];
    const o = [];
    for (let c = 0; c < 4; c++) {
      const a = s.slice(c * 4, c * 4 + 4);
      o[c * 4 + 0] = xtime(a[0]) ^ (xtime(a[1]) ^ a[1]) ^ a[2] ^ a[3];
      o[c * 4 + 1] = a[0] ^ xtime(a[1]) ^ (xtime(a[2]) ^ a[2]) ^ a[3];
      o[c * 4 + 2] = a[0] ^ a[1] ^ xtime(a[2]) ^ (xtime(a[3]) ^ a[3]);
      o[c * 4 + 3] = (xtime(a[0]) ^ a[0]) ^ a[1] ^ a[2] ^ xtime(a[3]);
    }
    s = o;
    for (let i = 0; i < 16; i++) s[i] ^= rk[rd * 16 + i];
  }
  s = s.map(x => SBOX[x]);
  s = [s[0], s[5], s[10], s[15], s[4], s[9], s[14], s[3],
       s[8], s[13], s[2], s[7], s[12], s[1], s[6], s[11]];
  for (let i = 0; i < 16; i++) s[i] ^= rk[160 + i];
  return s;
}

function decB(rk, inp) {
  let s = inp.slice(0);
  for (let i = 0; i < 16; i++) s[i] ^= rk[160 + i];
  for (let rd = 9; rd >= 1; rd--) {
    s = [s[0], s[13], s[10], s[7], s[4], s[1], s[14], s[11],
         s[8], s[5], s[2], s[15], s[12], s[9], s[6], s[3]];
    s = s.map(x => INV[x]);
    for (let i = 0; i < 16; i++) s[i] ^= rk[rd * 16 + i];
    const o = [];
    for (let c = 0; c < 4; c++) {
      const a = s.slice(c * 4, c * 4 + 4);
      o[c * 4 + 0] = mul(a[0], 14) ^ mul(a[1], 11) ^ mul(a[2], 13) ^ mul(a[3], 9);
      o[c * 4 + 1] = mul(a[0], 9) ^ mul(a[1], 14) ^ mul(a[2], 11) ^ mul(a[3], 13);
      o[c * 4 + 2] = mul(a[0], 13) ^ mul(a[1], 9) ^ mul(a[2], 14) ^ mul(a[3], 11);
      o[c * 4 + 3] = mul(a[0], 11) ^ mul(a[1], 13) ^ mul(a[2], 9) ^ mul(a[3], 14);
    }
    s = o;
  }
  s = [s[0], s[13], s[10], s[7], s[4], s[1], s[14], s[11],
       s[8], s[5], s[2], s[15], s[12], s[9], s[6], s[3]];
  s = s.map(x => INV[x]);
  for (let i = 0; i < 16; i++) s[i] ^= rk[i];
  return s;
}

function ecbDec(rk, data) {
  const o = [];
  for (let i = 0; i < data.length; i += 16) o.push(...decB(rk, data.slice(i, i + 16)));
  return o;
}
function ecbEnc(rk, data) {
  const o = [];
  for (let i = 0; i < data.length; i += 16) o.push(...encB(rk, data.slice(i, i + 16)));
  return o;
}

function exp(d, f) {
  try {
    const m = Process.findModuleByName(d);
    return m ? m.findExportByName(f) : null;
  } catch (e) {
    return null;
  }
}
function bytes(p, n) { return Array.from(new Uint8Array(p.readByteArray(n))); }
function be16(a, i) { return (a[i] << 8) | a[i + 1]; }
function be32(a, i) { return ((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0; }
function wbe32(v) { return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }
function hex(a) { return a.map(x => ('0' + x.toString(16)).slice(-2)).join(''); }

const MAP_PORT = __MAP_PORT__;
const WATCH_ALL = __WATCH_ALL__;
const WATCH_OPS = new Set(__WATCH_OPS__);

const m = Process.findModuleByName('eco.exe');
let KEYS = [];
let RK = null;
const INJECT_QUEUE = [];
function onInject(msg) {
  try {
    const h = msg.sub || '';
    const a = [];
    for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
    if (a.length >= 2) INJECT_QUEUE.push(a);
  } catch (e) {}
  recv('inject', onInject);
}
recv('inject', onInject);
Interceptor.attach(m.base.add(0x18cc4), {
  onEnter() {
    try {
      const rkbytes = bytes(this.context.esp.add(4).readPointer(), 16);
      const k = [];
      for (let i = 0; i < 16; i += 4) k.push(rkbytes[i + 3], rkbytes[i + 2], rkbytes[i + 1], rkbytes[i]);
      const key = k.join(',');
      if (KEYS.indexOf(key) < 0) {
        KEYS.push(key);
        send({ t: 'key', n: KEYS.length });
      }
    } catch (e) {}
  }
});

function getPort(s) {
  const gpn = getPort._f || (getPort._f = new NativeFunction(exp('ws2_32.dll', 'getpeername'), 'int', ['uint', 'pointer', 'pointer']));
  try {
    const sa = Memory.alloc(32), ln = Memory.alloc(4);
    ln.writeInt(32);
    if (gpn(s, sa, ln) === 0) {
      const b = new Uint8Array(sa.readByteArray(4));
      return (b[2] << 8) | b[3];
    }
  } catch (e) {}
  return 0;
}

function validPlain(pt, num1) {
  if (num1 < 2 || num1 > pt.length) return false;
  let pos = 0, cnt = 0;
  while (pos < num1) {
    if (pos + 2 > pt.length) return false;
    const sl = be16(pt, pos);
    if (sl < 2 || pos + 2 + sl > pt.length) return false;
    pos += 2 + sl;
    cnt++;
  }
  return cnt > 0;
}

function processPackets(dir, sock, raw, canInject) {
  let off = 0;
  let out = [];
  let changed = false;
  while (off + 8 <= raw.length) {
    const lp = be32(raw, off), num1 = be32(raw, off + 4);
    if ((lp % 16) || lp < 16 || lp > 0x40000 || num1 > lp || num1 < 2) break;
    if (off + 8 + lp > raw.length) break;
    const ct = raw.slice(off + 8, off + 8 + lp);

    let rk = RK, pt = null;
    if (rk) {
      pt = ecbDec(rk, ct);
      if (!validPlain(pt, num1)) pt = null;
    }
    if (!pt) {
      for (const ks of KEYS) {
        const r = expandKey(ks.split(',').map(Number));
        const d = ecbDec(r, ct);
        if (validPlain(d, num1)) {
          rk = r; RK = r; pt = d;
          send({ t: 'lock', dir: dir, sock: sock >>> 0, port: getPort(sock) });
          break;
        }
      }
    }
    if (!pt) {
      out = out.concat(raw.slice(off, off + 8 + lp));
      off += 8 + lp;
      continue;
    }

    let pos = 0;
    const subs = [];
    while (pos < num1) {
      const sl = be16(pt, pos);
      if (sl < 2 || pos + 2 + sl > pt.length) break;
      const sub = pt.slice(pos + 2, pos + 2 + sl);
      subs.push(sub);
      pos += 2 + sl;
      const op = be16(sub, 0);
      if (WATCH_ALL || WATCH_OPS.has(op)) {
        send({ t: 'pkt', dir: dir, op: op, len: sub.length, sub: hex(sub) });
      }
    }
    if (canInject && INJECT_QUEUE.length > 0) {
      while (INJECT_QUEUE.length > 0) subs.push(INJECT_QUEUE.shift());
      let payload = [];
      for (const sub of subs) {
        payload.push((sub.length >> 8) & 0xff, sub.length & 0xff);
        payload = payload.concat(sub);
      }
      const newNum1 = payload.length;
      while (payload.length % 16 !== 0) payload.push(0);
      const newCt = ecbEnc(rk, payload);
      out = out.concat(wbe32(payload.length), wbe32(newNum1), newCt);
      changed = true;
    } else {
      out = out.concat(raw.slice(off, off + 8 + lp));
    }
    off += 8 + lp;
  }
  if (off < raw.length) out = out.concat(raw.slice(off));
  return changed ? out : null;
}

function hookSend(name) {
  const p = exp('ws2_32.dll', name);
  if (!p) return;
  Interceptor.attach(p, {
    onEnter(a) { this.s = a[0].toUInt32(); this.b = a[1]; this.l = a[2].toInt32(); },
    onLeave(r) {
      const n = r.toInt32();
      if (n <= 0 || getPort(this.s) !== MAP_PORT) return;
      try {
        processPackets('C2S', this.s, bytes(this.b, Math.min(this.l, n)), false);
      } catch (e) {}
    }
  });
}

function hookRecv(name) {
  const p = exp('ws2_32.dll', name);
  if (!p) return;
  Interceptor.attach(p, {
    onEnter(a) { this.s = a[0].toUInt32(); this.b = a[1]; this.cap = a[2].toInt32(); },
    onLeave(r) {
      const n = r.toInt32();
      if (n <= 0 || getPort(this.s) !== MAP_PORT) return;
      try {
        const res = processPackets('S2C', this.s, bytes(this.b, n), true);
        if (res && res.length <= this.cap) {
          this.b.writeByteArray(res);
          r.replace(ptr(res.length));
        }
      } catch (e) {}
    }
  });
}

hookSend('send');
hookSend('sendto');
hookRecv('recv');
hookRecv('recvfrom');
send('READY');
