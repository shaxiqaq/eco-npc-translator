# -*- coding: utf-8 -*-
"""Buff state tracking for the local ECO character."""

import json
import os
import statistics


HERE = os.path.dirname(os.path.abspath(__file__))
BUFF_NAMES = os.path.join(HERE, "buff_names.json")

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


def bit_key(group, mask):
    return f"{int(group)}:0x{int(mask):08x}"


def default_category(group):
    if group == 0:
        return "abnormal"
    if group == 4:
        return "negative"
    return "positive"


class BuffTracker:
    def __init__(self, names=None):
        self.names = names if names is not None else load_buff_names()
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

    def _definitions(self, masks):
        consumed = [0] * 12
        definitions = []
        for item in COMPOSITE_BUFFS:
            group = item["group"]
            mask = item["mask"]
            if group < len(masks) and masks[group] & mask == mask:
                consumed[group] |= mask
                definitions.append(dict(item))

        for group, value in enumerate(masks):
            remaining = value & ~consumed[group]
            while remaining:
                mask = remaining & -remaining
                remaining &= ~mask
                key = bit_key(group, mask)
                metadata = self.names.get(key, {})
                samples = self.observed_durations.get(key, [])
                learned_duration = statistics.median(samples) if samples else None
                definitions.append({
                    "key": key,
                    "group": group,
                    "mask": mask,
                    "name": metadata.get("name") or f"未命名状态 {group + 1}-{mask.bit_length()}",
                    "source_name": metadata.get("source_name"),
                    "category": metadata.get("category") or default_category(group),
                    "duration": metadata.get("duration") or learned_duration,
                    "timing": metadata.get("timing") or (
                        "estimated_learned" if learned_duration else "elapsed_only"
                    ),
                    "skill_id": metadata.get("skill_id"),
                })
        return definitions

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

    def update(self, actor_id, masks, timestamp):
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
        updated = {}
        events = []

        for key, definition in definitions.items():
            old = previous.get(key)
            refreshed = old is not None and same_packet
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
