# -*- coding: utf-8 -*-
"""
Live ECO damage meter.

This is a read-only overlay-free console meter. It uses the same Frida packet
capture script as eco_damage_capture.py, but only keeps concise combat stats.
"""
import datetime as _dt
import argparse
import json
import os
import sys
import threading
import time
from collections import Counter, deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eco_damage_capture import MAP_PORT, parse_packet
from eco_damage_categories import (
    category_for_damage,
    default_capture_categories,
    update_capture_categories,
)
from eco_damage_console import render
from eco_buffs import BuffTracker

HERE = os.path.dirname(os.path.abspath(__file__))
LOGDIR = os.path.join(HERE, "logs")
WATCH_OPS = [
    3999, 4001, 4002, 4006, 4999,
    5001, 5005, 5010, 5025, 5030, 5035, 5040,
    525, 540, 5500, 4640, 4645, 4655, 4660,
]
SKILL_NAMES = os.path.join(HERE, "skill_names.json")
MOB_NAMES = os.path.join(HERE, "mob_names.json")


def load_skill_names(path=SKILL_NAMES):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    names = {}
    for key, value in data.items():
        try:
            skill_id = int(key, 0)
        except Exception:
            continue
        if isinstance(value, str) and value.strip():
            names[skill_id] = value.strip()
    return names


def load_id_names(path):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    names = {}
    for key, value in data.items():
        try:
            item_id = int(key, 0)
        except Exception:
            continue
        if isinstance(value, str) and value.strip():
            names[item_id] = value.strip()
    return names


def now_label():
    return _dt.datetime.now().strftime("%H:%M:%S")


class DamageMeter:
    def __init__(self, out_path=None, self_id=None, game_chat=True, chat_mode="whole", event_sink=None):
        self.out_path = out_path
        self.out = open(out_path, "a", encoding="utf-8", buffering=1) if out_path else None
        self.script = None
        self.game_chat = game_chat
        self.chat_mode = chat_mode
        self.event_sink = event_sink
        self.lock = threading.Lock()
        self.self_id = self_id
        self.auto_self = self_id is None
        self.self_candidates = Counter()
        self.recent_targets = deque(maxlen=16)
        self.recent_actions = deque(maxlen=32)
        self.recent_damage_hits = deque(maxlen=32)
        self.events = deque(maxlen=12)
        self.damage_details = deque(maxlen=12)
        self.damage_history = []
        self.hp_by_actor = {}
        self.actor_names = {}
        self.actor_mobs = {}
        self.pet_actors = set()
        self.pet_owner = {}
        self.mob_template_counts = Counter()
        self.unknown_combat_actors = Counter()
        self.skill_names = load_skill_names()
        self.mob_names = load_id_names(MOB_NAMES)
        self.capture_categories = default_capture_categories()
        self.reset()
        self.actor_buff_masks = {}
        self.buff_tracker = BuffTracker()

    def close(self):
        if self.out:
            self.out.close()

    def set_script(self, script):
        self.script = script

    def set_capture_categories(self, categories):
        if not isinstance(categories, dict):
            return
        with self.lock:
            self.capture_categories = update_capture_categories(
                self.capture_categories,
                categories,
            )

    def category_enabled(self, category):
        return self.capture_categories.get(category, True)

    def should_capture_damage(self, side, skill_id=None):
        return self.category_enabled(category_for_damage(side, skill_id))

    def build_public_chat_subpacket(self, text):
        actor = self.self_id or 0
        data = text.encode("utf-8")[:230]
        payload = bytearray()
        payload += (1001).to_bytes(2, "big")
        payload += int(actor).to_bytes(4, "big", signed=False)
        payload.append((len(data) + 1) & 0xff)
        payload += data
        payload.append(0)
        return bytes(payload)

    def build_whole_chat_subpacket(self, text):
        data = text.encode("utf-8")[:230]
        payload = bytearray()
        payload += (1055).to_bytes(2, "big")
        payload.append((len(data) + 1) & 0xff)
        payload += data
        payload.append(0)
        return bytes(payload)

    def build_chat_subpackets(self, text):
        if self.chat_mode == "public":
            return [self.build_public_chat_subpacket(text)]
        if self.chat_mode == "both":
            return [self.build_whole_chat_subpacket(text), self.build_public_chat_subpacket(text)]
        return [self.build_whole_chat_subpacket(text)]

    def post_game_chat(self, text):
        if not self.game_chat or not self.script:
            return
        for sub in self.build_chat_subpackets(text):
            if not sub:
                continue
            try:
                self.script.post({"type": "inject", "sub": sub.hex()})
            except Exception:
                pass

    def reset(self):
        with getattr(self, "lock", threading.Lock()):
            self.started = time.time()
            self.first_damage_ts = None
            self.last_damage_ts = None
            self.total_dealt = 0
            self.total_taken = 0
            self.skill_dealt = 0
            self.normal_dealt = 0
            self.skill_taken = 0
            self.normal_taken = 0
            self.pet_dealt = 0
            self.pet_skill_dealt = 0
            self.pet_normal_dealt = 0
            self.hits_dealt = 0
            self.hits_taken = 0
            self.hits_skill_dealt = 0
            self.hits_normal_dealt = 0
            self.hits_skill_taken = 0
            self.hits_normal_taken = 0
            self.hits_pet_dealt = 0
            self.hits_pet_skill_dealt = 0
            self.hits_pet_normal_dealt = 0
            self.max_dealt = 0
            self.max_taken = 0
            self.max_skill_dealt = 0
            self.max_normal_dealt = 0
            self.max_skill_taken = 0
            self.max_normal_taken = 0
            self.max_pet_dealt = 0
            self.max_pet_skill_dealt = 0
            self.max_pet_normal_dealt = 0
            self.by_target = Counter()
            self.by_source = Counter()
            self.by_skill_dealt = Counter()
            self.by_skill_taken = Counter()
            self.by_pet = Counter()
            self.by_pet_skill = Counter()
            self.events.clear()
            self.damage_details.clear()
            self.damage_history.clear()
            self.history_version = 0
            self.hp_by_actor.clear()
            self.actor_names.clear()
            self.actor_mobs.clear()
            self.pet_actors.clear()
            self.pet_owner.clear()
            self.mob_template_counts.clear()
            self.unknown_combat_actors.clear()
            self.recent_actions.clear()
            self.recent_damage_hits.clear()

    def mark_self_candidate(self, actor, score):
        if not self.auto_self or actor is None:
            return
        self.self_candidates[actor] += score
        if self.self_candidates[actor] >= 4:
            self.self_id = actor
            self.auto_self = False
            self.events.appendleft((now_label(), f"auto self actor={actor}"))

    def best_self_candidate(self):
        if self.self_id is not None:
            return self.self_id
        if not self.self_candidates:
            return None
        actor, score = self.self_candidates.most_common(1)[0]
        return actor if score >= 3 else None

    def own_actor(self):
        actor = self.best_self_candidate()
        if actor is not None and self.self_id is None:
            self.self_id = actor
            self.auto_self = False
            self.events.appendleft((now_label(), f"auto self actor={actor} by outgoing action"))
        return self.self_id

    def sync_buffs_to_self(self, timestamp):
        actor = self.self_id
        if actor is None or actor == self.buff_tracker.actor_id:
            return
        pending = self.actor_buff_masks.get(actor)
        self.buff_tracker.reset_actor(actor)
        if pending is not None:
            masks, packet_at = pending
            self.buff_tracker.update(actor, masks, packet_at or timestamp)

    def remember_damage_time(self, ts):
        if self.first_damage_ts is None:
            self.first_damage_ts = ts
        self.last_damage_ts = ts

    def log(self, rec):
        if self.out:
            self.out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def emit_event(self, rec):
        if not self.event_sink:
            return
        try:
            self.event_sink(rec)
        except Exception:
            pass

    def actor_label(self, actor):
        if actor == "self":
            return "自己"
        if actor is None:
            return "未知"
        if self.self_id is not None and actor == self.self_id:
            return f"自己#{actor}"
        if actor in self.pet_actors:
            return f"宠物#{actor}"
        name = self.actor_names.get(actor)
        if name:
            return f"{name}#{actor}"
        mob_id = self.actor_mobs.get(actor)
        if mob_id is not None:
            name = self.mob_names.get(mob_id)
            if name:
                return f"{name}#{actor}"
            return f"怪物#{mob_id}(对象#{actor})"
        guessed = self.guess_mob_template()
        if guessed is not None and actor >= 10000:
            guess_name = self.mob_names.get(guessed)
            if guess_name:
                return f"疑似{guess_name}#{actor}"
            return f"疑似怪物#{guessed}(对象#{actor})"
        return f"角色#{actor}" if actor < 10000 else f"未识别对象#{actor}"

    def guess_mob_template(self):
        if not self.mob_template_counts:
            return None
        common = self.mob_template_counts.most_common(2)
        mob_id, count = common[0]
        second = common[1][1] if len(common) > 1 else 0
        if count >= 3 and count >= second * 2:
            return mob_id
        return None

    def note_unknown_actor(self, actor):
        if actor is None:
            return
        if self.self_id is not None and actor == self.self_id:
            return
        if actor in self.actor_names or actor in self.actor_mobs:
            return
        self.unknown_combat_actors[actor] += 1

    def mark_pet_actor(self, actor, owner=None, reason=""):
        if actor is None:
            return False
        if self.self_id is not None and actor == self.self_id:
            return False
        if actor in self.actor_mobs:
            return False
        is_new = actor not in self.pet_actors
        self.pet_actors.add(actor)
        if owner is not None:
            self.pet_owner[actor] = owner
        self.unknown_combat_actors.pop(actor, None)
        if is_new:
            suffix = f" ({reason})" if reason else ""
            self.events.appendleft((now_label(), f"识别宠物 actor={actor}{suffix}"))
        return True

    def is_pet_actor(self, actor):
        return actor in self.pet_actors

    def target_is_ours_recently(self, ts, target, max_age=10.0):
        if target is None or target == self.self_id:
            return False
        for target_ts, recent_target in list(self.recent_targets):
            if target == recent_target and 0 <= ts - target_ts <= max_age:
                return True
        return self.by_target.get(target, 0) > 0

    def maybe_mark_pet_from_damage(self, ts, src, dst):
        if src is None or dst is None:
            return False
        if self.self_id is not None and src == self.self_id:
            return False
        if self.self_id is not None and dst == self.self_id:
            return False
        if src in self.actor_mobs:
            return False
        if src in self.actor_names and src not in self.pet_actors:
            return False
        if self.target_is_ours_recently(ts, dst):
            return self.mark_pet_actor(src, owner=self.self_id, reason="跟随攻击我的目标")
        return self.is_pet_actor(src)

    def add_pet_damage(self, ts, src, dst, damage, skill_id, parsed=None, source_kind="伤害包"):
        if damage <= 0 or not self.should_capture_damage("pet_dealt", skill_id):
            return None
        self.pet_dealt += damage
        self.hits_pet_dealt += 1
        self.max_pet_dealt = max(self.max_pet_dealt, damage)
        if skill_id is None:
            self.pet_normal_dealt += damage
            self.hits_pet_normal_dealt += 1
            self.max_pet_normal_dealt = max(self.max_pet_normal_dealt, damage)
        else:
            self.pet_skill_dealt += damage
            self.hits_pet_skill_dealt += 1
            self.max_pet_skill_dealt = max(self.max_pet_skill_dealt, damage)
            self.by_pet_skill[skill_id] += damage
        self.by_pet[src] += damage
        self.by_target[dst] += damage
        self.remember_damage_time(ts)
        op = parsed.get("_op") if parsed else None
        detail = self.add_damage_detail(ts, "pet_dealt", src, dst, damage, skill_id,
                                        source_kind=source_kind, raw_op=op)
        self.emit_event({"side": "pet_dealt", "damage": damage, "target": dst,
                         "source": src, "skill": detail["skill"], "ts": ts})
        return detail

    def skill_label(self, skill_id, fallback="普通攻击"):
        if skill_id is None:
            return fallback
        return self.skill_names.get(skill_id) or f"技能#{skill_id}"

    def remember_action(self, ts, actor, target, skill_id=None, kind="attack", own=False):
        if target is None or target == 0xFFFFFFFF:
            return
        self.recent_actions.appendleft({
            "ts": ts,
            "actor": actor,
            "target": target,
            "skill_id": skill_id,
            "kind": kind,
            "own": own,
            "op": getattr(self, "_current_op", None),
            "hp_delta_used": False,
        })

    def find_action(self, ts, src, dst):
        best_skill = None
        best_any = None
        for action in list(self.recent_actions):
            age = ts - action["ts"]
            if age > 12.0:
                continue
            if action.get("target") != dst:
                continue
            actor = action.get("actor")
            if actor is not None and src is not None and actor != src:
                continue
            if best_any is None and age <= 5.0:
                best_any = action
            if action.get("kind") == "skill" and action.get("skill_id") is not None:
                best_skill = action
                break
        return best_skill or best_any

    def find_fresh_skill_action(self, ts, src, dst, max_age=0.8):
        for action in list(self.recent_actions):
            age = ts - action["ts"]
            if age < 0 or age > max_age:
                continue
            if action.get("kind") != "skill" or action.get("skill_id") is None:
                continue
            if action.get("target") != dst:
                continue
            actor = action.get("actor")
            if actor is not None and src is not None and actor != src:
                continue
            return action
        return None

    def find_pending_hp_skill_action(self, ts, dst, max_age=8.0):
        fallback = None
        for action in list(self.recent_actions):
            age = ts - action["ts"]
            if age < 0 or age > max_age:
                continue
            if action.get("hp_delta_used"):
                continue
            if not action.get("own"):
                continue
            if action.get("kind") != "skill" or action.get("skill_id") is None:
                continue
            if self.has_newer_own_attack(action["ts"], ts):
                continue
            if action.get("target") == dst:
                return action
            if fallback is None and dst != self.self_id:
                fallback = action
        return fallback

    def has_newer_own_attack(self, after_ts, before_ts):
        for action in list(self.recent_actions):
            if action.get("kind") != "attack" or not action.get("own"):
                continue
            if after_ts < action["ts"] <= before_ts:
                return True
        return False

    def has_recent_own_skill_request(self, ts, skill_id, dst, max_age=10.0):
        for action in list(self.recent_actions):
            age = ts - action["ts"]
            if age < 0 or age > max_age:
                continue
            if not action.get("own") or action.get("kind") != "skill":
                continue
            if action.get("skill_id") != skill_id:
                continue
            if action.get("target") in (dst, None):
                return True
        return False

    def recently_counted_damage(self, ts, actor):
        for hit_ts, hit_actor in list(self.recent_damage_hits):
            if actor == hit_actor and 0 <= ts - hit_ts <= 1.0:
                return True
        return False

    def apply_hp_delta_damage(self, ts, actor, prev_hp, hp):
        if prev_hp is None or hp is None or hp >= prev_hp:
            return False
        if self.recently_counted_damage(ts, actor):
            return False
        damage = prev_hp - hp
        action = self.find_pending_hp_skill_action(ts, actor)
        if not action:
            return False
        action["hp_delta_used"] = True
        self.events.appendleft((
            now_label(),
            f"忽略HP变化 {self.actor_label(actor)} {prev_hp}->{hp}；等待技能结果包真实伤害"
        ))
        self.log({
            "ts": ts,
            "kind": "hp_delta_ignored",
            "actor": actor,
            "prev_hp": prev_hp,
            "hp": hp,
            "delta": damage,
            "matched_action": action,
        })
        return False

    def add_damage_detail(self, ts, side, src, dst, damage, skill_id,
                          source_kind="伤害包", raw_op=None):
        skill = self.skill_label(skill_id)
        text = f"{self.actor_label(src)} 用 {skill} 对 {self.actor_label(dst)} 造成 {damage} 伤害"
        rec = {
            "time": now_label(),
            "side": side,
            "src": src,
            "dst": dst,
            "source": self.actor_label(src),
            "target": self.actor_label(dst),
            "src_mob_id": self.actor_mobs.get(src),
            "dst_mob_id": self.actor_mobs.get(dst),
            "skill": skill,
            "skill_id": skill_id,
            "damage": damage,
            "source_kind": source_kind,
            "raw_op": raw_op,
            "text": text,
        }
        self.damage_details.appendleft(rec)
        self.damage_history.append(rec)
        self.history_version += 1
        self.events.appendleft((rec["time"], text))
        return rec

    def apply_skill_result_damage(self, ts, parsed):
        skill_id = parsed.get("skill_id")
        caster = parsed.get("caster")
        affected = parsed.get("affected") or []
        damages = parsed.get("damages") or []
        if not skill_id or not affected or not damages:
            return False

        counted = False
        for dst, raw_damage in zip(affected, damages):
            damage = abs(int(raw_damage or 0))
            if damage <= 0:
                continue
            side = "other"
            src = caster
            if self.self_id is not None and caster == self.self_id:
                if not self.should_capture_damage("dealt", skill_id):
                    continue
                side = "dealt"
                self.total_dealt += damage
                self.skill_dealt += damage
                self.hits_dealt += 1
                self.hits_skill_dealt += 1
                self.max_dealt = max(self.max_dealt, damage)
                self.max_skill_dealt = max(self.max_skill_dealt, damage)
                self.by_target[dst] += damage
                self.by_skill_dealt[skill_id] += damage
            elif self.self_id is not None and dst == self.self_id:
                if not self.should_capture_damage("taken", skill_id):
                    continue
                side = "taken"
                self.total_taken += damage
                self.skill_taken += damage
                self.hits_taken += 1
                self.hits_skill_taken += 1
                self.max_taken = max(self.max_taken, damage)
                self.max_skill_taken = max(self.max_skill_taken, damage)
                self.by_source[src] += damage
                self.by_skill_taken[skill_id] += damage
            elif self.maybe_mark_pet_from_damage(ts, caster, dst):
                side = "pet_dealt"
                detail = self.add_pet_damage(ts, caster, dst, damage, skill_id, parsed,
                                             source_kind="宠物技能结果包")
                if detail is None:
                    continue
            elif self.self_id is None and (
                self.best_self_candidate() == caster
                or self.has_recent_own_skill_request(ts, skill_id, dst)
            ):
                side = "dealt"
                self.self_id = caster
                self.auto_self = False
                src = caster
                if not self.should_capture_damage("dealt", skill_id):
                    continue
                self.total_dealt += damage
                self.skill_dealt += damage
                self.hits_dealt += 1
                self.hits_skill_dealt += 1
                self.max_dealt = max(self.max_dealt, damage)
                self.max_skill_dealt = max(self.max_skill_dealt, damage)
                self.by_target[dst] += damage
                self.by_skill_dealt[skill_id] += damage
            else:
                continue

            if side != "pet_dealt":
                self.remember_damage_time(ts)
                detail = self.add_damage_detail(ts, side, src, dst, damage, skill_id,
                                            source_kind="技能结果包", raw_op=parsed.get("_op"))
                self.emit_event({"side": side, "damage": damage, "target": dst,
                                 "source": src, "skill": detail["skill"], "ts": ts})
            self.log({
                "ts": ts,
                "kind": "damage",
                "source_kind": "skill_result",
                "side": side,
                "self": self.self_id,
                "src": src,
                "dst": dst,
                "damage": damage,
                "skill_id": skill_id,
                "skill": self.skill_label(skill_id),
                "src_label": self.actor_label(src),
                "dst_label": self.actor_label(dst),
                "raw_op": parsed.get("_op"),
                "raw_dir": parsed.get("_dir"),
                "raw_sub": parsed.get("_sub"),
            })
            self.recent_damage_hits.appendleft((ts, dst))
            counted = True

        return counted

    def handle_parsed(self, parsed, ts):
        typ = parsed.get("type")
        if typ == "attack_request":
            target = parsed.get("target")
            if target is not None:
                self.recent_targets.append((ts, target))
                self.remember_action(ts, self.own_actor(), target, None, "attack", own=True)
            return
        if typ == "skill_cast_request":
            target = parsed.get("target")
            if target is not None and target != 0xFFFFFFFF:
                actor = self.own_actor()
                self.recent_targets.append((ts, target))
                self.remember_action(ts, actor, target, parsed.get("skill_id"), "skill", own=True)
                self.log({
                    "ts": ts,
                    "kind": "skill_action",
                    "source": "request",
                    "actor": actor,
                    "target": target,
                    "skill_id": parsed.get("skill_id"),
                    "skill": self.skill_label(parsed.get("skill_id")),
                    "raw_op": parsed.get("_op"),
                    "raw_dir": parsed.get("_dir"),
                    "raw_sub": parsed.get("_sub"),
                })
            return
        if typ in ("skill_cast_result", "skill_active"):
            if self.self_id is None and self.has_recent_own_skill_request(
                ts, parsed.get("skill_id"), parsed.get("target")
            ):
                caster = parsed.get("caster")
                if caster is not None:
                    self.self_id = caster
                    self.auto_self = False
            self.remember_action(ts, parsed.get("caster"), parsed.get("target"),
                                 parsed.get("skill_id"), "skill")
            if typ == "skill_active":
                self.apply_skill_result_damage(ts, parsed)
            self.log({
                "ts": ts,
                "kind": "skill_action",
                "source": typ,
                "actor": parsed.get("caster"),
                "target": parsed.get("target"),
                "skill_id": parsed.get("skill_id"),
                "skill": self.skill_label(parsed.get("skill_id")),
                "raw_op": parsed.get("_op"),
                "raw_dir": parsed.get("_dir"),
                "raw_sub": parsed.get("_sub"),
            })
            return
        if typ == "pet_appear":
            actor = parsed.get("actor")
            owner = parsed.get("owner")
            if actor is not None:
                if self.self_id is None and owner in self.self_candidates:
                    self.self_id = owner
                    self.auto_self = False
                if self.self_id is None or owner in (self.self_id, None, 0):
                    self.mark_pet_actor(actor, owner=owner, reason="宠物出现包")
                hp = parsed.get("hp")
                if hp is not None:
                    self.hp_by_actor[actor] = hp
                self.log({
                    "ts": ts,
                    "kind": "pet_appear",
                    "actor": actor,
                    "owner": owner,
                    "hp": hp,
                    "max_hp": parsed.get("max_hp"),
                    "raw_op": parsed.get("_op"),
                    "raw_dir": parsed.get("_dir"),
                    "raw_sub": parsed.get("_sub"),
                })
            return
        if typ == "pet_delete":
            actor = parsed.get("actor")
            if actor is not None:
                self.log({
                    "ts": ts,
                    "kind": "pet_delete",
                    "actor": actor,
                    "was_pet": actor in self.pet_actors,
                    "raw_op": parsed.get("_op"),
                    "raw_dir": parsed.get("_dir"),
                    "raw_sub": parsed.get("_sub"),
                })
            return
        if typ == "battle_status":
            self.mark_self_candidate(parsed.get("actor"), 1)
            return
        if typ == "actor_buff":
            actor = parsed.get("actor")
            masks = parsed.get("masks") or []
            if actor is None:
                return
            self.actor_buff_masks[actor] = (masks, ts)
            self.sync_buffs_to_self(ts)
            if actor != self.self_id:
                return
            for event in self.buff_tracker.update(actor, masks, ts):
                self.log({
                    "ts": ts,
                    "kind": "buff",
                    "event": event.get("event"),
                    "actor": actor,
                    "key": event.get("key"),
                    "name": event.get("name"),
                    "category": event.get("category"),
                    "duration": event.get("duration"),
                    "timing": event.get("timing"),
                    "raw_op": parsed.get("_op"),
                    "raw_dir": parsed.get("_dir"),
                    "raw_sub": parsed.get("_sub"),
                })
            return
        if typ == "hpmpsp":
            actor = parsed.get("actor")
            hp = parsed.get("hp")
            prev = self.hp_by_actor.get(actor)
            self.hp_by_actor[actor] = hp
            if prev is not None and hp != prev:
                self.events.appendleft((now_label(), f"HP actor={actor} {prev}->{hp} ({hp - prev:+d})"))
                self.apply_hp_delta_damage(ts, actor, prev, hp)
            elif prev is None and self.find_pending_hp_skill_action(ts, actor):
                self.events.appendleft((now_label(), f"技能目标#{actor} 首次HP={hp}，缺少上一帧HP，等待下一次变化"))
            return
        if typ == "actor_name":
            actor = parsed.get("actor")
            name = parsed.get("name")
            if actor is not None and name:
                self.actor_names[actor] = name
                self.unknown_combat_actors.pop(actor, None)
                self.log({
                    "ts": ts,
                    "kind": "actor_name",
                    "actor": actor,
                    "name": name,
                })
            return
        if typ == "mob_appear":
            actor = parsed.get("actor")
            mob_id = parsed.get("mob_id")
            if actor is not None and mob_id is not None:
                self.actor_mobs[actor] = mob_id
                self.mob_template_counts[mob_id] += 1
                appear_hp = parsed.get("hp")
                if appear_hp is not None:
                    self.hp_by_actor[actor] = appear_hp
                self.unknown_combat_actors.pop(actor, None)
                self.log({
                    "ts": ts,
                    "kind": "mob_appear",
                    "actor": actor,
                    "mob_id": mob_id,
                    "mob_name": self.mob_names.get(mob_id),
                })
            return
        if typ == "mob_delete":
            # Keep the last actor -> mob template mapping for the session.
            # Damage packets can arrive close to deletion, and keeping it helps
            # history remain readable.
            return
        if typ == "combat_context":
            self.log({
                "ts": ts,
                "kind": "combat_context",
                "op": parsed.get("op"),
                "raw_op": parsed.get("_op"),
                "raw_dir": parsed.get("_dir"),
                "raw_sub": parsed.get("_sub"),
                "u16_2": parsed.get("u16_2"),
                "u32_2": parsed.get("u32_2"),
                "u32_6": parsed.get("u32_6"),
                "u32_10": parsed.get("u32_10"),
                "u32_14": parsed.get("u32_14"),
                "u32_18": parsed.get("u32_18"),
                "recent_skill_actions": list(self.recent_actions)[:8],
            })
            return
        if typ != "attack_result":
            return

        src = parsed.get("src")
        dst = parsed.get("dst")
        damage = parsed.get("damage") or 0
        self.note_unknown_actor(src)
        self.note_unknown_actor(dst)
        action = self.find_action(ts, src, dst)
        skill_id = None
        fresh_skill_action = self.find_fresh_skill_action(ts, src, dst)
        if fresh_skill_action is not None:
            action = fresh_skill_action
            skill_id = fresh_skill_action.get("skill_id")
        recent_skill_actions = []
        for item in list(self.recent_actions)[:8]:
            if item.get("kind") != "skill":
                continue
            recent_skill_actions.append({
                "age": round(ts - item["ts"], 3),
                "actor": item.get("actor"),
                "target": item.get("target"),
                "skill_id": item.get("skill_id"),
                "op": item.get("op"),
            })
        for target_ts, target in list(self.recent_targets):
            if ts - target_ts <= 3.0 and target == dst:
                self.mark_self_candidate(src, 3)
                break

        side = "other"
        if self.self_id is not None and src == self.self_id:
            if not self.should_capture_damage("dealt", skill_id):
                return
            side = "dealt"
            self.total_dealt += damage
            if damage > 0:
                self.hits_dealt += 1
                self.max_dealt = max(self.max_dealt, damage)
                if skill_id is None:
                    self.normal_dealt += damage
                    self.hits_normal_dealt += 1
                    self.max_normal_dealt = max(self.max_normal_dealt, damage)
                else:
                    self.skill_dealt += damage
                    self.hits_skill_dealt += 1
                    self.max_skill_dealt = max(self.max_skill_dealt, damage)
                self.by_target[dst] += damage
                if skill_id is not None:
                    self.by_skill_dealt[skill_id] += damage
                self.recent_damage_hits.appendleft((ts, dst))
                self.remember_damage_time(ts)
                detail = self.add_damage_detail(ts, side, src, dst, damage, skill_id,
                                                source_kind="伤害包", raw_op=parsed.get("_op"))
                self.emit_event({"side": "dealt", "damage": damage, "total": self.total_dealt,
                                 "target": dst, "skill": detail["skill"], "ts": ts})
                self.post_game_chat(f"[伤害] {detail['skill']} 对 {detail['target']} 造成 {damage}")
            elif damage <= 0:
                self.events.appendleft((now_label(), f"{self.actor_label(src)} 未命中 {self.actor_label(dst)}"))
        elif self.self_id is not None and dst == self.self_id:
            if not self.should_capture_damage("taken", skill_id):
                return
            side = "taken"
            self.total_taken += damage
            if damage > 0:
                self.hits_taken += 1
                self.max_taken = max(self.max_taken, damage)
                if skill_id is None:
                    self.normal_taken += damage
                    self.hits_normal_taken += 1
                    self.max_normal_taken = max(self.max_normal_taken, damage)
                else:
                    self.skill_taken += damage
                    self.hits_skill_taken += 1
                    self.max_skill_taken = max(self.max_skill_taken, damage)
                self.by_source[src] += damage
                if skill_id is not None:
                    self.by_skill_taken[skill_id] += damage
                self.recent_damage_hits.appendleft((ts, dst))
                self.remember_damage_time(ts)
                detail = self.add_damage_detail(ts, side, src, dst, damage, skill_id,
                                                source_kind="伤害包", raw_op=parsed.get("_op"))
                self.emit_event({"side": "taken", "damage": damage, "total": self.total_taken,
                                 "source": src, "skill": detail["skill"], "ts": ts})
                self.post_game_chat(f"[伤害] {detail['source']} 用 {detail['skill']} 造成 {damage}")
            elif damage <= 0:
                self.events.appendleft((now_label(), f"{self.actor_label(src)} 未命中 {self.actor_label(dst)}"))

        elif damage > 0 and self.maybe_mark_pet_from_damage(ts, src, dst):
            if not self.should_capture_damage("pet_dealt", skill_id):
                return
            side = "pet_dealt"
            self.add_pet_damage(ts, src, dst, damage, skill_id, parsed,
                                source_kind="宠物普通攻击包" if skill_id is None else "宠物技能伤害包")
            self.recent_damage_hits.appendleft((ts, dst))

        self.log({
            "ts": ts,
            "kind": "damage",
            "side": side,
            "self": self.self_id,
            "src": src,
            "dst": dst,
            "damage": damage,
            "skill_id": skill_id,
            "skill": self.skill_label(skill_id),
            "src_label": self.actor_label(src),
            "dst_label": self.actor_label(dst),
            "src_mob_id": self.actor_mobs.get(src),
            "dst_mob_id": self.actor_mobs.get(dst),
            "raw_op": parsed.get("_op"),
            "raw_dir": parsed.get("_dir"),
            "raw_sub": parsed.get("_sub"),
            "matched_action": action,
            "recent_skill_actions": recent_skill_actions,
            "dealt_total": self.total_dealt,
            "taken_total": self.total_taken,
        })

    def on_message(self, message, data):
        if message.get("type") != "send":
            if message.get("type") == "error":
                with self.lock:
                    self.events.appendleft((now_label(), "JS error; see terminal"))
                print("[JS ERR]", message.get("stack"), flush=True)
            return
        payload = message["payload"]
        if payload == "READY":
            with self.lock:
                self.events.appendleft((now_label(), "meter ready"))
            return
        if not isinstance(payload, dict) or payload.get("t") != "pkt":
            return
        try:
            sub = bytes.fromhex(payload["sub"])
            parsed = parse_packet(payload.get("dir"), int(payload.get("op", 0)), sub)
        except Exception:
            return
        if not parsed:
            return
        parsed["_dir"] = payload.get("dir")
        parsed["_op"] = int(payload.get("op", 0))
        parsed["_sub"] = payload.get("sub")
        with self.lock:
            self._current_op = parsed.get("_op")
            self.handle_parsed(parsed, time.time())
            self._current_op = None

    def snapshot(self, history_limit=None):
        with self.lock:
            now = time.time()
            elapsed = now - self.started
            self.sync_buffs_to_self(now)
            buffs = self.buff_tracker.snapshot(now)
            active = 0.0
            if self.first_damage_ts and self.last_damage_ts and self.last_damage_ts > self.first_damage_ts:
                active = self.last_damage_ts - self.first_damage_ts
            dps = self.total_dealt / active if active > 0 else 0.0
            tps = self.total_taken / active if active > 0 else 0.0
            skill_dps = self.skill_dealt / active if active > 0 else 0.0
            normal_dps = self.normal_dealt / active if active > 0 else 0.0
            pet_dps = self.pet_dealt / active if active > 0 else 0.0
            candidates = ", ".join(f"{a}:{s}" for a, s in self.self_candidates.most_common(3))
            if history_limit is None:
                damage_history = list(self.damage_history)
            else:
                limit = max(0, int(history_limit))
                damage_history = list(self.damage_history[-limit:]) if limit else []
            return {
                "elapsed": elapsed,
                "active": active,
                "self_id": self.self_id,
                "candidates": candidates,
                "dealt": self.total_dealt,
                "taken": self.total_taken,
                "skill_dealt": self.skill_dealt,
                "normal_dealt": self.normal_dealt,
                "skill_taken": self.skill_taken,
                "normal_taken": self.normal_taken,
                "pet_dealt": self.pet_dealt,
                "pet_skill_dealt": self.pet_skill_dealt,
                "pet_normal_dealt": self.pet_normal_dealt,
                "hits_dealt": self.hits_dealt,
                "hits_taken": self.hits_taken,
                "hits_skill_dealt": self.hits_skill_dealt,
                "hits_normal_dealt": self.hits_normal_dealt,
                "hits_skill_taken": self.hits_skill_taken,
                "hits_normal_taken": self.hits_normal_taken,
                "hits_pet_dealt": self.hits_pet_dealt,
                "hits_pet_skill_dealt": self.hits_pet_skill_dealt,
                "hits_pet_normal_dealt": self.hits_pet_normal_dealt,
                "max_dealt": self.max_dealt,
                "max_taken": self.max_taken,
                "max_skill_dealt": self.max_skill_dealt,
                "max_normal_dealt": self.max_normal_dealt,
                "max_skill_taken": self.max_skill_taken,
                "max_normal_taken": self.max_normal_taken,
                "max_pet_dealt": self.max_pet_dealt,
                "max_pet_skill_dealt": self.max_pet_skill_dealt,
                "max_pet_normal_dealt": self.max_pet_normal_dealt,
                "dps": dps,
                "tps": tps,
                "skill_dps": skill_dps,
                "normal_dps": normal_dps,
                "pet_dps": pet_dps,
                "targets": list(self.by_target.most_common(5)),
                "sources": list(self.by_source.most_common(5)),
                "skills_dealt": list(self.by_skill_dealt.most_common(8)),
                "skills_taken": list(self.by_skill_taken.most_common(8)),
                "pet_sources": list(self.by_pet.most_common(5)),
                "pet_skills": list(self.by_pet_skill.most_common(8)),
                "pet_actors": sorted(self.pet_actors),
                "capture_categories": dict(self.capture_categories),
                "recent_actions": list(self.recent_actions)[:10],
                "damage_details": list(self.damage_details),
                "damage_history": damage_history,
                "history_version": self.history_version,
                "unknown_actors": list(self.unknown_combat_actors.most_common(8)),
                "mob_template_guess": self.guess_mob_template(),
                "events": list(self.events),
                "buffs": buffs["active"],
                "buff_history": buffs["history"],
                "buff_version": buffs["version"],
                "buff_masks": buffs["masks"],
            }


def main():
    import frida

    ap = argparse.ArgumentParser(description="实时伤害统计")
    ap.add_argument("self_actor_id", nargs="?", type=lambda x: int(x, 0), help="可选：自己的角色编号")
    ap.add_argument("--pid", type=int, help="要连接的 eco.exe 进程编号")
    ap.add_argument("--no-game-chat", action="store_true", help="不向游戏聊天框注入本地消息")
    ap.add_argument("--chat-mode", choices=("whole", "public", "both"), default="whole",
                    help="本地游戏聊天包格式")
    args = ap.parse_args()

    os.makedirs(LOGDIR, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(LOGDIR, f"damage_meter_{stamp}.jsonl")

    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos:
        print("eco.exe is not running")
        return 1
    if args.pid is not None:
        selected = next((process for process in ecos if process.pid == args.pid), None)
        if selected is None:
            print(f"指定的 eco.exe 进程不存在（进程 {args.pid}）")
            return 2
        pid = selected.pid
    else:
        pid = max(ecos, key=lambda x: x.pid).pid

    js = open(os.path.join(HERE, "_damage_capture.js"), encoding="utf-8").read()
    js = js.replace("__MAP_PORT__", str(MAP_PORT))
    js = js.replace("__WATCH_ALL__", "false")
    js = js.replace("__WATCH_OPS__", json.dumps(WATCH_OPS))

    meter = DamageMeter(out_path=out_path, self_id=args.self_actor_id,
                        game_chat=not args.no_game_chat, chat_mode=args.chat_mode)
    session = dev.attach(pid)
    script = session.create_script(js)
    script.on("message", meter.on_message)
    meter.set_script(script)
    script.load()

    try:
        import keyboard
        keyboard.add_hotkey("f8", meter.reset)
        keyboard.add_hotkey("f10", lambda: meter.post_game_chat("[伤害] 测试消息"))
    except Exception:
        pass

    try:
        while True:
            render(meter)
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        render(meter)
        meter.close()
        try:
            session.detach()
        except Exception:
            pass
        print(f"\nSaved {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
