# -*- coding: utf-8 -*-
"""Buff state tracking for the local ECO character."""

import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eco_paths import resolve_dirs, find_data_file

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)
HERE = _DATA_DIR
BUFF_NAMES = find_data_file(_DATA_DIR, _RES_DIR, "buff_names.json")
CUSTOM_BUFFS = find_data_file(_DATA_DIR, _RES_DIR, "custom_buffs.json")

# Confirmed against this server by a controlled Magic Shield capture on
# 2026-07-22. The server sets both magic-defense-up bits for about 900 seconds.
COMPOSITE_BUFFS = (
    {
        "key": "magic_shield",
        "group": 3,
        "mask": 0x00000C00,
        "name": "魔法护盾",
        "category": "positive",
        "duration": 900.04,
        "timing": "estimated_observed",
        "skill_id": 3114,
    },
)


def load_buff_names(path=BUFF_NAMES):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key): value for key, value in data.items() if isinstance(value, dict)}


def load_custom_durations(path=CUSTOM_BUFFS):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): float(v) for k, v in data.items() if isinstance(v, (int, float))}


def save_custom_durations(durations, path=CUSTOM_BUFFS):
    try:
        data = {str(k): v for k, v in durations.items()}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def bit_key(group, mask):
    return f"{int(group)}:0x{int(mask):08x}"


def default_category(group):
    if group == 0:
        return "abnormal"
    if group == 4:
        return "negative"
    return "positive"


class BuffTracker:
    def __init__(self, names=None, custom_durations=None):
        self.names = names if names is not None else load_buff_names()
        self.custom_durations = custom_durations if custom_durations is not None else load_custom_durations()
        self.learned_skills = {}
        self.actor_id = None
        self.masks = (0,) * 12
        self.active = {}
        self.history = []
        self.observed_durations = {}
        self.version = 0
        self.last_packet_at = None

    def reset_actor(self, actor_id):
        self.actor_id = actor_id
        self.masks = (0,) * 12
        self.active.clear()
        self.history.clear()
        self.version += 1
        self.last_packet_at = None

    def _custom_duration_for(self, *keys):
        """Look up a custom duration by any alias key (e.g. magic_shield or bit key)."""
        for key in keys:
            if not key:
                continue
            value = self.custom_durations.get(str(key))
            if value is not None:
                try:
                    return float(value)
                except (TypeError, ValueError):
                    continue
        return None

    def set_custom_durations(self, durations):
        if not isinstance(durations, dict):
            self.custom_durations = {}
            return
        cleaned = {}
        for key, value in durations.items():
            try:
                cleaned[str(key)] = float(value)
            except (TypeError, ValueError):
                continue
        self.custom_durations = cleaned

    def reload_custom_durations(self, path=None):
        self.custom_durations = load_custom_durations(path or CUSTOM_BUFFS)
        return dict(self.custom_durations)

    def _definitions(self, masks):
        consumed = [0] * 12
        definitions = []
        for item in COMPOSITE_BUFFS:
            group = item["group"]
            mask = item["mask"]
            if group < len(masks) and masks[group] & mask == mask:
                consumed[group] |= mask
                definition = dict(item)
                # Composite aliases: key name and bit-key both accepted.
                custom = self._custom_duration_for(
                    definition.get("key"),
                    bit_key(group, mask),
                )
                if custom is not None:
                    definition["duration"] = custom
                    definition["timing"] = "custom"
                definitions.append(definition)

        for group, value in enumerate(masks):
            remaining = value & ~consumed[group]
            while remaining:
                mask = remaining & -remaining
                remaining &= ~mask
                key = bit_key(group, mask)
                metadata = self.names.get(key, {})
                samples = self.observed_durations.get(key, [])
                learned_duration = statistics.median(samples) if samples else None
                custom_duration = self._custom_duration_for(key)
                if custom_duration is not None:
                    effective_duration = custom_duration
                    timing = "custom"
                elif learned_duration is not None:
                    effective_duration = learned_duration
                    timing = "estimated_learned"
                else:
                    meta_duration = metadata.get("duration")
                    try:
                        effective_duration = float(meta_duration) if meta_duration is not None else None
                    except (TypeError, ValueError):
                        effective_duration = None
                    timing = metadata.get("timing") or (
                        "estimated_learned" if effective_duration is not None else "elapsed_only"
                    )
                reference_name = metadata.get("name")
                unverified = metadata.get("verified") is False or (
                    metadata.get("verified") is not True and group >= 5
                )
                skill_id = metadata.get("skill_id")
                try:
                    skill_id = int(skill_id) if skill_id is not None else None
                except (TypeError, ValueError):
                    skill_id = None
                definition = {
                    "key": key,
                    "group": group,
                    "mask": mask,
                    "name": (
                        f"未确认状态 {group + 1}-{mask.bit_length()}"
                        if unverified
                        else reference_name or f"未命名状态 {group + 1}-{mask.bit_length()}"
                    ),
                    "source_name": (
                        metadata.get("source_name")
                        or (reference_name if unverified else None)
                    ),
                    "category": metadata.get("category") or default_category(group),
                    "duration": effective_duration,
                    "timing": timing,
                    "skill_id": skill_id if skill_id and skill_id > 0 else None,
                    "confidence": (
                        "verified" if metadata.get("verified") is True
                        else "unverified" if unverified
                        else "status_flag"
                    ),
                }
                learned = self.learned_skills.get(key)
                if learned:
                    definition.update(learned)
                    # Keep custom duration preferred over skill-learned metadata.
                    if custom_duration is not None:
                        definition["duration"] = custom_duration
                        definition["timing"] = "custom"
                definitions.append(definition)
        return definitions

    @staticmethod
    def _skill_metadata(skill):
        if not isinstance(skill, dict):
            return None
        try:
            skill_id = int(skill.get("skill_id"))
        except (TypeError, ValueError):
            return None
        if skill_id <= 0:
            return None
        name = str(skill.get("name") or f"技能#{skill_id}").strip()
        return {"skill_id": skill_id, "name": name, "confidence": "observed_skill"}

    def _learn_new_statuses(self, definitions, previous, skill):
        learned = self._skill_metadata(skill)
        if learned is None:
            return
        for key, definition in definitions.items():
            if (
                key in previous
                or definition.get("confidence") == "verified"
                or definition.get("skill_id") is not None
            ):
                continue
            self.learned_skills[key] = {
                **learned,
                "source_name": definition.get("source_name") or definition.get("name"),
            }
            definition.update(self.learned_skills[key])

    def _append_history(self, event, item, timestamp):
        self.history.append({
            "event": event,
            "time": timestamp,
            "key": item["key"],
            "name": item["name"],
            "category": item["category"],
            "skill_id": item.get("skill_id"),
        })
        if len(self.history) > 200:
            del self.history[:-200]

    def update(self, actor_id, masks, timestamp, skill=None):
        masks = tuple(int(value) & 0xFFFFFFFF for value in masks[:12])
        masks += (0,) * (12 - len(masks))
        if self.actor_id != actor_id:
            self.reset_actor(actor_id)

        previous_masks = self.masks
        same_packet = masks == previous_masks
        duplicate = same_packet and self.last_packet_at is not None and timestamp - self.last_packet_at < 0.25
        self.last_packet_at = timestamp
        if duplicate:
            return []

        definitions = {item["key"]: item for item in self._definitions(masks)}
        previous = self.active
        self._learn_new_statuses(definitions, previous, skill)
        skill_metadata = self._skill_metadata(skill)
        refresh_keys = set()
        if skill_metadata:
            refresh_keys = {
                key for key, definition in definitions.items()
                if definition.get("skill_id") == skill_metadata["skill_id"]
            }
        updated = {}
        events = []

        for key, definition in definitions.items():
            old = previous.get(key)
            refreshed = old is not None and key in refresh_keys
            if old is not None and not refreshed:
                updated[key] = old
                continue

            started_at = timestamp
            duration = definition.get("duration")
            item = {
                **definition,
                "started_at": started_at,
                "expires_at": started_at + float(duration) if duration else None,
                "refreshes": (old.get("refreshes", 0) + 1) if old else 0,
            }
            updated[key] = item
            event = "refreshed" if refreshed else "gained"
            self._append_history(event, item, timestamp)
            events.append({"event": event, **item})

        for key, item in previous.items():
            if key in definitions:
                continue
            ended = {**item, "ended_at": timestamp, "observed_duration": max(0.0, timestamp - item["started_at"])}
            if ended["observed_duration"] >= 1.0:
                samples = self.observed_durations.setdefault(key, [])
                samples.append(ended["observed_duration"])
                del samples[:-5]
            self._append_history("lost", ended, timestamp)
            events.append({"event": "lost", **ended})

        self.masks = masks
        self.active = updated
        if events or masks != previous_masks:
            self.version += 1
        return events

    def snapshot(self, now):
        items = []
        for item in self.active.values():
            expires_at = item.get("expires_at")
            public = dict(item)
            public["elapsed"] = max(0.0, now - item["started_at"])
            public["remaining"] = max(0.0, expires_at - now) if expires_at is not None else None
            items.append(public)
        items.sort(key=lambda item: (item["category"], item["name"], item["key"]))
        return {
            "actor_id": self.actor_id,
            "active": items,
            "history": list(self.history[-100:]),
            "version": self.version,
            "masks": list(self.masks),
        }
