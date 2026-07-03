# -*- coding: utf-8 -*-
"""
Read-only ECO combat packet sampler.

Run this while eco.exe is online, then perform controlled actions:
  1. press F8 before a test
  2. hit a monster with normal attacks / skills
  3. let a monster hit you
  4. press F9 to print opcode stats

Output: logs/damage_capture_YYYYMMDD_HHMMSS.jsonl
"""
import argparse
import datetime as _dt
import json
import os
import sys
import threading
import time
from collections import Counter
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frida

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PORT = 12002
LOGDIR = os.path.join(HERE, "logs")

DEFAULT_OPS = {
    # Client combat intents.
    3999, 4005, 4999, 2500,
    # Server combat / skill / HP / actor packets most likely to carry damage context.
    4001, 4002, 4006, 4031, 5001, 5005, 5010, 5025, 5030, 5035, 5040,
    525, 540, 545, 530, 535, 5500, 4620, 4625, 4640, 4645, 4655, 4660,
}


def load_op_names():
    paths = [
        os.path.join(HERE, "opcodes.json"),
        os.path.join(HERE, "archive", "opcodes.json"),
    ]
    for path in paths:
        if os.path.exists(path):
            try:
                data = json.load(open(path, encoding="utf-8"))
                return {
                    "C2S": {int(k): v for k, v in data.get("c2s_map", {}).items()},
                    "S2C": {int(k): v for k, v in data.get("s2c_map", {}).items()},
                }
            except Exception:
                pass
    return {"C2S": {}, "S2C": {}}


def now_ms():
    return _dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def ints_from_sub(sub):
    vals = []
    for off in range(2, len(sub)):
        item = {"off": off}
        if off + 2 <= len(sub):
            item["u16"] = int.from_bytes(sub[off:off + 2], "big", signed=False)
            item["i16"] = int.from_bytes(sub[off:off + 2], "big", signed=True)
        if off + 4 <= len(sub):
            item["u32"] = int.from_bytes(sub[off:off + 4], "big", signed=False)
            item["i32"] = int.from_bytes(sub[off:off + 4], "big", signed=True)
        vals.append(item)
    return vals


def ascii_gloss(sub):
    chars = "".join(chr(b) if 32 <= b < 127 else "." for b in sub[2:])
    runs = []
    cur = ""
    for ch in chars:
        if ch != ".":
            cur += ch
        else:
            if len(cur) >= 4:
                runs.append(cur)
            cur = ""
    if len(cur) >= 4:
        runs.append(cur)
    return runs[:8]


def u16be(sub, off):
    if off + 2 > len(sub):
        return None
    return int.from_bytes(sub[off:off + 2], "big", signed=False)


def u32be(sub, off):
    if off + 4 > len(sub):
        return None
    return int.from_bytes(sub[off:off + 4], "big", signed=False)


def read_cstr(data):
    if not data:
        return ""
    end = data.find(b"\0")
    if end >= 0:
        data = data[:end]
    return data.decode("utf-8", "replace").strip()


def parse_packet(direction, op, sub):
    if direction == "S2C" and op == 525:
        name_len = sub[10] if len(sub) > 10 else 0
        name = ""
        if name_len and len(sub) >= 11 + name_len:
            name = read_cstr(sub[11:11 + name_len])
        return {
            "type": "actor_name",
            "actor": u32be(sub, 2),
            "name": name,
        }
    if direction == "S2C" and op == 4655:
        hp = None
        max_hp = None
        if len(sub) >= 42:
            hp = u32be(sub, 26)
            max_hp = u32be(sub, 34)
        elif len(sub) >= 36:
            hp = u32be(sub, 26)
            max_hp = u32be(sub, 30)
        elif len(sub) >= 30:
            hp = u32be(sub, 20)
            max_hp = u32be(sub, 24)
        return {
            "type": "pet_appear",
            "actor": u32be(sub, 2),
            "owner": u32be(sub, 7),
            "owner_char": u32be(sub, 11),
            "hp": hp,
            "max_hp": max_hp,
        }
    if direction == "S2C" and op == 4660:
        return {
            "type": "pet_delete",
            "actor": u32be(sub, 2),
        }
    if direction == "C2S" and op == 3999:
        return {
            "type": "attack_request",
            "target": u32be(sub, 2),
            "random": u16be(sub, 6),
        }
    if direction == "C2S" and op == 4999:
        return {
            "type": "skill_cast_request",
            "skill_id": u16be(sub, 2),
            "target": u32be(sub, 4),
            "x": sub[8] if len(sub) > 8 else None,
            "y": sub[9] if len(sub) > 9 else None,
            "level": sub[10] if len(sub) > 10 else None,
            "random": u16be(sub, 11),
        }
    if direction == "S2C" and op == 4001:
        return {
            "type": "attack_result",
            "src": u32be(sub, 2),
            "dst": u32be(sub, 6),
            # ECO's attack result stores the visible damage on an odd offset.
            "damage": u32be(sub, 15),
            "flag": u16be(sub, 37),
        }
    if direction == "S2C" and op in {4002, 4031}:
        return {
            "type": "combat_context",
            "op": op,
            "u16_2": u16be(sub, 2),
            "u32_2": u32be(sub, 2),
            "u32_6": u32be(sub, 6),
            "u32_10": u32be(sub, 10),
            "u32_14": u32be(sub, 14),
            "u32_18": u32be(sub, 18),
        }
    if direction == "S2C" and op == 5001:
        return {
            "type": "skill_cast_result",
            "skill_id": u16be(sub, 2),
            "target": u32be(sub, 6),
            "caster": u32be(sub, 14),
            "level": sub[18] if len(sub) > 18 else None,
        }
    if direction == "S2C" and op == 5010:
        affected = []
        damages = []
        combo = sub[14] if len(sub) > 14 else 0
        if combo and len(sub) >= 15 + combo * 4:
            affected = [u32be(sub, 15 + i * 4) for i in range(combo)]
            # SagaECO's SSMG_SKILL_ACTIVE stores the visible HP effect in
            # the second HP-value block for this client format.
            damage_base = 22 + combo * 4
            if len(sub) >= damage_base + combo * 4:
                damages = [
                    int.from_bytes(sub[damage_base + i * 4:damage_base + i * 4 + 4],
                                   "big", signed=True)
                    for i in range(combo)
                ]
        return {
            "type": "skill_active",
            "skill_id": u16be(sub, 2),
            "caster": u32be(sub, 6),
            "target": u32be(sub, 10),
            "affected": affected,
            "damages": damages,
            "level": sub[14] if len(sub) > 14 else None,
        }
    if direction == "S2C" and op in {5005, 5025, 5030, 5035, 5040}:
        return {
            "type": "skill_active",
            "skill_id": u16be(sub, 2),
            "target": u32be(sub, 6),
            "caster": None,
            "level": sub[10] if len(sub) > 10 else None,
            "op": op,
        }
    if direction == "S2C" and op == 540:
        return {
            "type": "hpmpsp",
            "actor": u32be(sub, 2),
            "hp": u32be(sub, 11),
            "mp": u32be(sub, 19),
            "sp": u32be(sub, 27),
        }
    if direction == "S2C" and op == 4006:
        return {
            "type": "battle_status",
            "actor": u32be(sub, 2),
            "status": sub[6] if len(sub) > 6 else None,
        }
    if direction == "S2C" and op == 4640:
        return {
            "type": "mob_appear",
            "actor": u32be(sub, 2),
            "mob_id": u32be(sub, 6),
            "hp": u32be(sub, 19),
            "max_hp": u32be(sub, 27),
        }
    if direction == "S2C" and op == 4645:
        return {
            "type": "mob_delete",
            "actor": u32be(sub, 2),
        }
    return None


class DamageCapture:
    def __init__(self, out_path, op_names, show_each=True, self_id=None, auto_self=True):
        self.out_path = out_path
        self.op_names = op_names
        self.show_each = show_each
        self.self_id = self_id
        self.auto_self = auto_self and self_id is None
        self.stage = 0
        self.lock = threading.Lock()
        self.counts = Counter()
        self.hp_by_actor = {}
        self.self_candidates = Counter()
        self.recent_targets = deque(maxlen=16)
        self.total_dealt = 0
        self.total_taken = 0
        self.hits_dealt = 0
        self.hits_taken = 0
        self.max_dealt = 0
        self.max_taken = 0
        self.first_damage_ts = None
        self.last_damage_ts = None
        self.by_target = Counter()
        self.by_source = Counter()
        self.started = time.time()
        self.out = open(out_path, "a", encoding="utf-8", buffering=1)

    def close(self):
        self.out.close()

    def mark(self, label=None):
        with self.lock:
            self.stage += 1
            rec = {
                "ts": time.time(),
                "time": now_ms(),
                "kind": "mark",
                "stage": self.stage,
                "label": label or f"stage-{self.stage}",
            }
            self.out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(f"[*] mark stage={self.stage} ({rec['label']})", flush=True)

    def dump_stats(self):
        with self.lock:
            print("\n===== opcode stats =====", flush=True)
            for (direction, op), n in self.counts.most_common(30):
                name = self.op_names.get(direction, {}).get(op, "")
                print(f"{direction:3} op={op:<5} {name:<32} count={n}", flush=True)
            print("========================\n", flush=True)
            self.dump_damage_summary_locked()

    def dump_damage_summary_locked(self):
        if self.self_id is None and not self.total_dealt and not self.total_taken:
            if self.self_candidates:
                cand = ", ".join(f"{aid}:{score}" for aid, score in self.self_candidates.most_common(5))
                print(f"===== damage summary =====\nself actor: unknown; candidates {cand}\n==========================\n", flush=True)
            return
        elapsed = 0.0
        if self.first_damage_ts and self.last_damage_ts and self.last_damage_ts > self.first_damage_ts:
            elapsed = self.last_damage_ts - self.first_damage_ts
        dps = self.total_dealt / elapsed if elapsed > 0 else 0.0
        tps = self.total_taken / elapsed if elapsed > 0 else 0.0
        print("===== damage summary =====", flush=True)
        print(f"self actor: {self.self_id}", flush=True)
        print(f"dealt: {self.total_dealt} hits={self.hits_dealt} max={self.max_dealt} dps={dps:.2f}", flush=True)
        print(f"taken: {self.total_taken} hits={self.hits_taken} max={self.max_taken} rate={tps:.2f}", flush=True)
        if self.by_target:
            top = ", ".join(f"{aid}:{dmg}" for aid, dmg in self.by_target.most_common(5))
            print(f"targets: {top}", flush=True)
        if self.by_source:
            top = ", ".join(f"{aid}:{dmg}" for aid, dmg in self.by_source.most_common(5))
            print(f"sources: {top}", flush=True)
        print("==========================\n", flush=True)

    def on_message(self, message, data):
        if message.get("type") != "send":
            if message.get("type") == "error":
                print("[JS ERR]", message.get("stack"), flush=True)
            return
        payload = message["payload"]
        if payload == "READY":
            print("[*] damage capture ready. F8=mark, F9=stats, Ctrl+C=stop", flush=True)
            return
        if not isinstance(payload, dict):
            return
        typ = payload.get("t")
        if typ == "key":
            print(f"[*] AES key candidate #{payload.get('n')} seen", flush=True)
            return
        if typ == "lock":
            print(f"[*] stream locked dir={payload.get('dir')} port={payload.get('port')}", flush=True)
            return
        if typ != "pkt":
            return

        sub = bytes.fromhex(payload["sub"])
        direction = payload.get("dir", "?")
        op = int(payload.get("op", 0))
        name = self.op_names.get(direction, {}).get(op, "")
        rec = {
            "ts": time.time(),
            "time": now_ms(),
            "kind": "packet",
            "stage": self.stage,
            "dir": direction,
            "op": op,
            "name": name,
            "len": len(sub),
            "hex": payload["sub"],
            "ints": ints_from_sub(sub),
        }
        gloss = ascii_gloss(sub)
        if gloss:
            rec["ascii"] = gloss
        parsed = parse_packet(direction, op, sub)
        if parsed:
            rec["parsed"] = parsed

        with self.lock:
            self.counts[(direction, op)] += 1
            line = self.describe_parsed(parsed, rec["ts"])
            self.out.write(json.dumps(rec, ensure_ascii=False) + "\n")

        if self.show_each and line:
            print(f"[{rec['time']}] s{self.stage} {line}", flush=True)
        elif self.show_each:
            print(f"[{rec['time']}] s{self.stage} {direction} op={op:<5} {name:<28} len={len(sub)}", flush=True)

    def bump_self_candidate(self, actor, score, reason):
        if not self.auto_self or actor is None:
            return None
        self.self_candidates[actor] += score
        if self.self_candidates[actor] >= 5:
            self.self_id = actor
            self.auto_self = False
            return f" AUTO_SELF actor={actor} reason={reason}"
        return None

    def remember_damage_time(self, ts):
        if self.first_damage_ts is None:
            self.first_damage_ts = ts
        self.last_damage_ts = ts

    def describe_parsed(self, parsed, ts):
        if not parsed:
            return None
        typ = parsed.get("type")
        if typ == "attack_result":
            src = parsed.get("src")
            dst = parsed.get("dst")
            damage = parsed.get("damage") or 0
            label = ""
            for target_ts, target in list(self.recent_targets):
                if ts - target_ts <= 3.0 and target == dst:
                    auto = self.bump_self_candidate(src, 3, "recent attack target")
                    if auto:
                        label += auto
                    break
            if self.self_id is not None:
                if src == self.self_id:
                    self.total_dealt += damage
                    if damage > 0:
                        self.hits_dealt += 1
                        self.max_dealt = max(self.max_dealt, damage)
                        self.by_target[dst] += damage
                        self.remember_damage_time(ts)
                    label = f" dealt_total={self.total_dealt}"
                elif dst == self.self_id:
                    self.total_taken += damage
                    if damage > 0:
                        self.hits_taken += 1
                        self.max_taken = max(self.max_taken, damage)
                        self.by_source[src] += damage
                        self.remember_damage_time(ts)
                    label = f" taken_total={self.total_taken}"
            return f"ATK {src} -> {dst} dmg={damage}{label}"
        if typ == "hpmpsp":
            actor = parsed.get("actor")
            hp = parsed.get("hp")
            mp = parsed.get("mp")
            sp = parsed.get("sp")
            prev = self.hp_by_actor.get(actor)
            self.hp_by_actor[actor] = hp
            delta = "" if prev is None else f" delta={hp - prev:+d}"
            return f"HP actor={actor} hp={hp}{delta} mp={mp} sp={sp}"
        if typ == "attack_request":
            target = parsed.get("target")
            if target is not None:
                self.recent_targets.append((ts, target))
            return f"REQ attack target={parsed.get('target')} random={parsed.get('random')}"
        if typ == "skill_cast_request":
            target = parsed.get("target")
            if target is not None and target != 0xFFFFFFFF:
                self.recent_targets.append((ts, target))
            return (
                f"REQ skill={parsed.get('skill_id')} target={parsed.get('target')} "
                f"lv={parsed.get('level')} xy=({parsed.get('x')},{parsed.get('y')})"
            )
        if typ == "battle_status":
            auto = self.bump_self_candidate(parsed.get("actor"), 1, "battle status")
            return f"STATUS actor={parsed.get('actor')} status={parsed.get('status')}{auto or ''}"
        return None


def parse_ops(text):
    if not text:
        return set(DEFAULT_OPS)
    out = set()
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        out.add(int(part, 0))
    return out


def main():
    ap = argparse.ArgumentParser(description="Read-only ECO combat packet sampler")
    ap.add_argument("--all", action="store_true", help="capture every map subpacket; very noisy")
    ap.add_argument("--ops", default="", help="comma-separated extra/override opcode list, e.g. 4001,5040,0x1f90")
    ap.add_argument("--quiet", action="store_true", help="write jsonl without printing each packet")
    ap.add_argument("--self-id", type=lambda x: int(x, 0), default=None, help="your actor id for dealt/taken totals")
    ap.add_argument("--no-auto-self", action="store_true", help="disable automatic self actor detection")
    args = ap.parse_args()

    os.makedirs(LOGDIR, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(LOGDIR, f"damage_capture_{stamp}.jsonl")
    op_names = load_op_names()
    watch_ops = sorted(parse_ops(args.ops))

    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos:
        print("eco.exe is not running")
        return 1
    pid = max(ecos, key=lambda x: x.pid).pid

    js_path = os.path.join(HERE, "_damage_capture.js")
    js = open(js_path, encoding="utf-8").read()
    js = js.replace("__MAP_PORT__", str(MAP_PORT))
    js = js.replace("__WATCH_ALL__", "true" if args.all else "false")
    js = js.replace("__WATCH_OPS__", json.dumps(watch_ops))

    print(f"[*] attach eco.exe pid={pid}", flush=True)
    print(f"[*] writing {out_path}", flush=True)
    if args.all:
        print("[*] --all enabled: this will be noisy; use it only for short tests", flush=True)
    else:
        print("[*] watching ops: " + ",".join(str(x) for x in watch_ops), flush=True)

    cap = DamageCapture(
        out_path,
        op_names,
        show_each=not args.quiet,
        self_id=args.self_id,
        auto_self=not args.no_auto_self,
    )
    session = dev.attach(pid)
    script = session.create_script(js)
    script.on("message", cap.on_message)
    script.load()

    try:
        import keyboard
        keyboard.add_hotkey("f8", lambda: cap.mark())
        keyboard.add_hotkey("f9", cap.dump_stats)
    except Exception as exc:
        print(f"[*] hotkeys unavailable: {exc}", flush=True)
        print("[*] continuing without hotkeys; Ctrl+C will stop and print stats", flush=True)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] stopping...", flush=True)
    finally:
        cap.dump_stats()
        cap.close()
        try:
            session.detach()
        except Exception:
            pass
        print(f"[*] saved {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
