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
        "source_name": "Magic Shield",
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
    names = {str(key): value for key, value in data.items() if isinstance(value, dict)}
    # Merge optional wiki-aligned descriptions / category overrides.
    meta_path = find_data_file(_DATA_DIR, _RES_DIR, "buff_meta.json")
    try:
        with open(meta_path, encoding="utf-8") as stream:
            meta = json.load(stream)
    except Exception:
        meta = {}
    if isinstance(meta, dict):
        for key, extra in meta.items():
            if not isinstance(extra, dict):
                continue
            entry = dict(names.get(str(key)) or {})
            if extra.get("description"):
                entry["description"] = extra["description"]
            if extra.get("wiki_category") and not entry.get("category"):
                entry["category"] = extra["wiki_category"]
            elif extra.get("wiki_category") and extra.get("force_category"):
                entry["category"] = extra["wiki_category"]
            names[str(key)] = entry
    return names


def _positive_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0 or number != number:  # NaN
        return None
    return number


def _skill_id_from_key(key):
    text = str(key or "").strip()
    if not text:
        return None
    lowered = text.lower()
    for prefix in ("skill:", "cd:"):
        if lowered.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    try:
        skill_id = int(text, 0)
    except (TypeError, ValueError):
        return None
    return skill_id if skill_id > 0 else None


def looks_like_skill_key(key):
    text = str(key or "").strip()
    if not text:
        return False
    lowered = text.lower()
    if lowered.startswith("skill:") or lowered.startswith("cd:"):
        return True
    return text.isdigit()


def normalize_custom_entry(key, value):
    """Normalize one custom timer entry.

    Supports:
      - legacy number → buff key = duration; skill-like key = cooldown
      - object {duration, cooldown/cd, skill_id, label/name, overlay}
    Returns None when neither duration nor cooldown is set.
    """
    name = str(key or "").strip()
    if not name:
        return None

    duration = None
    cooldown = None
    skill_id = None
    label = None
    overlay = None

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = _positive_float(value)
        if seconds is None:
            return None
        # Backward compatible: skill:2100 / 2100 bare numbers used to mean CD.
        if looks_like_skill_key(name):
            cooldown = seconds
            skill_id = _skill_id_from_key(name)
        else:
            duration = seconds
    elif isinstance(value, dict):
        duration = _positive_float(value.get("duration"))
        cooldown = _positive_float(value.get("cooldown") if value.get("cooldown") is not None else value.get("cd"))
        try:
            raw_skill = value.get("skill_id")
            skill_id = int(raw_skill) if raw_skill is not None and str(raw_skill).strip() != "" else None
            if skill_id is not None and skill_id <= 0:
                skill_id = None
        except (TypeError, ValueError):
            skill_id = None
        label = value.get("label") or value.get("name")
        if label is not None:
            label = str(label).strip() or None
        if "overlay" in value:
            overlay = bool(value.get("overlay"))
    else:
        return None

    if skill_id is None:
        skill_id = _skill_id_from_key(name)

    if duration is None and cooldown is None:
        return None

    entry = {}
    if duration is not None:
        entry["duration"] = duration
    if cooldown is not None:
        entry["cooldown"] = cooldown
    if skill_id is not None:
        entry["skill_id"] = int(skill_id)
    if label:
        entry["label"] = label
    # Skill entries default to overlay=true so existing CD configs keep showing;
    # users can uncheck to hide. Non-skill buff rows ignore this flag.
    if skill_id is not None:
        entry["overlay"] = True if overlay is None else bool(overlay)
    return entry


def normalize_custom_durations(raw):
    cleaned = {}
    if not isinstance(raw, dict):
        return cleaned
    for key, value in raw.items():
        entry = normalize_custom_entry(key, value)
        if entry is None:
            continue
        cleaned[str(key).strip()] = entry
    return cleaned


def entry_duration_seconds(entry):
    if isinstance(entry, (int, float)) and not isinstance(entry, bool):
        return _positive_float(entry)
    if isinstance(entry, dict):
        return _positive_float(entry.get("duration"))
    return None


def entry_cooldown_seconds(entry):
    if isinstance(entry, dict):
        if entry.get("cooldown") is not None:
            return _positive_float(entry.get("cooldown"))
        return _positive_float(entry.get("cd"))
    return None


def load_custom_durations(path=CUSTOM_BUFFS):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except Exception:
        return {}
    return normalize_custom_durations(data)


def save_custom_durations(durations, path=CUSTOM_BUFFS):
    try:
        data = normalize_custom_durations(durations)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
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
        """Look up a custom buff/effect duration by any alias key."""
        for key in keys:
            if not key:
                continue
            entry = self.custom_durations.get(str(key))
            seconds = entry_duration_seconds(entry)
            if seconds is not None:
                return seconds
        return None

    def set_custom_durations(self, durations):
        if not isinstance(durations, dict):
            self.custom_durations = {}
            return
        self.custom_durations = normalize_custom_durations(durations)

    def reload_custom_durations(self, path=None):
        self.custom_durations = load_custom_durations(path or CUSTOM_BUFFS)
        return dict(self.custom_durations)

    def find_skill_timer_config(self, skill_id):
        """Find custom duration/cooldown config for a skill id."""
        try:
            skill_id = int(skill_id)
        except (TypeError, ValueError):
            return None
        if skill_id <= 0:
            return None

        def pack(key, entry):
            duration = entry_duration_seconds(entry)
            cooldown = entry_cooldown_seconds(entry)
            if duration is None and cooldown is None:
                return None
            overlay = True
            if isinstance(entry, dict) and "overlay" in entry:
                overlay = bool(entry.get("overlay"))
            return {
                "key": key,
                "skill_id": skill_id,
                "duration": duration,
                "cooldown": cooldown,
                "label": (entry.get("label") if isinstance(entry, dict) else None),
                "overlay": overlay,
            }

        candidates = (
            f"skill:{skill_id}",
            f"cd:{skill_id}",
            str(skill_id),
        )
        for key in candidates:
            entry = self.custom_durations.get(key)
            if not entry:
                continue
            packed = pack(key, entry)
            if packed:
                return packed
        # Also match entries that only store skill_id inside the object.
        for key, entry in self.custom_durations.items():
            if not isinstance(entry, dict):
                continue
            try:
                entry_skill = int(entry.get("skill_id")) if entry.get("skill_id") is not None else None
            except (TypeError, ValueError):
                entry_skill = None
            if entry_skill != skill_id:
                continue
            packed = pack(key, entry)
            if packed:
                return packed
        return None

    def _definitions(self, masks):
        consumed = [0] * 12
        definitions = []
        for item in COMPOSITE_BUFFS:
            group = item["group"]
            mask = item["mask"]
            if group < len(masks) and masks[group] & mask == mask:
                consumed[group] |= mask
                definition = dict(item)
                # Prefer game-internal source_name for UI display.
                if definition.get("source_name"):
                    definition["name"] = definition["source_name"]
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
                source_name = metadata.get("source_name") or (
                    reference_name if unverified else None
                )
                # Prefer game-internal source_name for the primary display label.
                display_name = (
                    f"未确认状态 {group + 1}-{mask.bit_length()}"
                    if unverified
                    else (source_name or reference_name or f"未命名状态 {group + 1}-{mask.bit_length()}")
                )
                definition = {
                    "key": key,
                    "group": group,
                    "mask": mask,
                    "name": display_name,
                    "source_name": source_name,
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
                if metadata.get("description"):
                    definition["description"] = metadata.get("description")
                learned = self.learned_skills.get(key)
                if learned:
                    # Learned skill names are game-facing; prefer them over localized dict names.
                    learned_name = str(learned.get("name") or "").strip()
                    if learned_name:
                        definition["name"] = learned_name
                        definition["source_name"] = learned.get("source_name") or learned_name
                    if learned.get("skill_id") is not None:
                        definition["skill_id"] = learned["skill_id"]
                    if learned.get("confidence"):
                        definition["confidence"] = learned["confidence"]
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
