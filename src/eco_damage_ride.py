# -*- coding: utf-8 -*-
"""Ride / possession proxy classification for DamageMeter (mixin).

Delegates pure decisions to eco_damage_classify; applies enter/refresh side effects here.

Wiki: 通常パートナー → pet; ライド/騎乗 → ride while mounted.
"""
from __future__ import annotations

import time

from eco_damage_util import now_label
from eco_damage_classify import (
    classify_outgoing_proxy,
    is_ride_active as pure_ride_active,
    is_ride_mount as pure_ride_mount,
    is_walk_partner as pure_walk_partner,
    snapshot_classify_state,
)


class RideModeMixin:
    """Sticky ride mode + outgoing proxy source (self/pet/ride/possession)."""

    RIDE_MODE_TTL_S = 120.0

    def is_possession_host(self, actor):
        if actor is None or self.possession_host_id is None:
            return False
        try:
            return int(actor) == int(self.possession_host_id)
        except (TypeError, ValueError):
            return False

    def is_ride_active(self, ts=None):
        now = float(ts if ts is not None else time.time())
        state = snapshot_classify_state(self)
        active = pure_ride_active(state, now)
        if state.get("ride_mode") and not active:
            # Mirror pure expiry onto live meter fields.
            self.ride_mode = False
            self.ride_mode_reason = None
            self.ride_mount_id = None
            self.ride_mode_until = 0.0
        return active

    def enter_ride_mode(self, mount_id=None, reason="ride", ts=None, quiet=False):
        now = float(ts if ts is not None else time.time())
        was = self.is_ride_active(now)
        self.ride_mode = True
        self.ride_mode_until = now + self.RIDE_MODE_TTL_S
        self.ride_mode_reason = reason
        if mount_id is not None:
            try:
                mid = int(mount_id)
            except (TypeError, ValueError):
                mid = None
            if mid and mid != self.self_id:
                self.ride_mount_id = mid
                self.mark_pet_actor(mid, owner=self.self_id, reason=reason or "骑宠")
        if not was and not quiet:
            label = f"#{self.ride_mount_id}" if self.ride_mount_id else ""
            self.events.appendleft((now_label(), f"骑宠中 {label}".strip()))
            self.pending_notices.append({
                "level": "info",
                "message": "已进入骑宠状态：普攻/技能将计入骑宠渠道",
            })
            self.log({
                "ts": now,
                "kind": "ride_mode",
                "event": "enter",
                "mount_id": self.ride_mount_id,
                "reason": reason,
                "until": self.ride_mode_until,
            })
        return True

    def refresh_ride_mode(self, ts=None, evidence=True):
        if not evidence:
            return self.is_ride_active(ts)
        if not self.ride_mode:
            return False
        now = float(ts if ts is not None else time.time())
        if now > float(self.ride_mode_until or 0):
            self.ride_mode = False
            self.ride_mode_reason = None
            self.ride_mount_id = None
            return False
        self.ride_mode_until = now + self.RIDE_MODE_TTL_S
        return True

    def exit_ride_mode(self, reason="dismount", quiet=False, ts=None):
        if not self.ride_mode and self.ride_mount_id is None:
            return False
        prev = self.ride_mount_id
        self.ride_mode = False
        self.ride_mode_until = 0.0
        self.ride_mode_reason = None
        self.ride_mount_id = None
        if not quiet:
            self.events.appendleft((now_label(), f"骑宠解除（{reason}）"))
            self.log({
                "ts": float(ts if ts is not None else time.time()),
                "kind": "ride_mode",
                "event": "exit",
                "previous_mount": prev,
                "reason": reason,
            })
        return True

    def is_ride_mount(self, actor):
        return pure_ride_mount(snapshot_classify_state(self), actor)

    def is_walk_partner(self, actor):
        ts = time.time()
        return pure_walk_partner(snapshot_classify_state(self), actor, ts)

    def local_skill_proxy_source(self, ts, src, skill_id, dst):
        """
        Classify outgoing proxy; pure decision + ride enter/refresh side effects.
        """
        state = snapshot_classify_state(self)
        has_skill = skill_id is not None and self.has_recent_own_skill_request(ts, skill_id, dst)
        has_aa = self.has_recent_own_attack(ts, dst, max_age=1.5)
        likely_pc = False
        if src is not None:
            try:
                likely_pc = self.is_likely_character_actor(src)
            except Exception:
                likely_pc = False

        proxy = classify_outgoing_proxy(
            state,
            ts=float(ts),
            src=src,
            skill_id=skill_id,
            has_own_skill_request=has_skill,
            has_own_attack=has_aa,
            is_likely_character=likely_pc,
        )

        # Side effects: only refresh/enter when mount evidence is real.
        if proxy == "ride":
            if self.is_ride_mount(src):
                self.refresh_ride_mode(ts, evidence=True)
            elif (
                self.is_ride_active(ts)
                and src is not None
                and src != self.self_id
                and not likely_pc
            ):
                reason = "骑宠施法代理" if has_skill else "骑宠普攻代理"
                self.enter_ride_mode(mount_id=src, reason=reason, ts=ts, quiet=True)
            # possession host bookkeeping
        if proxy == "possession" and src is not None and self.possession_host_id is None:
            if self.self_id is not None and src != self.self_id and likely_pc:
                try:
                    self.possession_host_id = int(src)
                except (TypeError, ValueError):
                    pass

        return proxy
