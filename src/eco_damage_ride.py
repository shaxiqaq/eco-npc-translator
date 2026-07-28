# -*- coding: utf-8 -*-
"""Ride / possession proxy classification for DamageMeter (mixin)."""
from __future__ import annotations

import time

from eco_damage_util import now_label


class RideModeMixin:
    """Sticky ride mode + outgoing proxy source (self/pet/ride/possession)."""

    # Ride sticky TTL: mount packets are sparse; keep mode while grinding.
    RIDE_MODE_TTL_S = 180.0

    def is_possession_host(self, actor):
        if actor is None or self.possession_host_id is None:
            return False
        try:
            return int(actor) == int(self.possession_host_id)
        except (TypeError, ValueError):
            return False

    def is_ride_active(self, ts=None):
        """True while sticky ride mode has not expired."""
        if not self.ride_mode:
            return False
        now = float(ts if ts is not None else time.time())
        if now > float(self.ride_mode_until or 0):
            self.ride_mode = False
            return False
        return True

    def enter_ride_mode(self, mount_id=None, reason="ride", ts=None, quiet=False):
        """Mark local player as mounted; outgoing self damage reclassifies to ride_*."""
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

    def refresh_ride_mode(self, ts=None):
        if not self.ride_mode:
            return False
        now = float(ts if ts is not None else time.time())
        if now > float(self.ride_mode_until or 0):
            self.ride_mode = False
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
        if actor is None or self.ride_mount_id is None:
            return False
        try:
            return int(actor) == int(self.ride_mount_id)
        except (TypeError, ValueError):
            return False

    def local_skill_proxy_source(self, ts, src, skill_id, dst):
        """
        Ride / 依凭(憑依) / partner / marionette:
        Client C2S is always ours, but S2C may name mount/host/pet as caster.
        Never rebind self_id to that proxy.

        Returns 'self' | 'pet' | 'ride' | 'possession' | None.
        """
        ride_on = self.is_ride_active(ts)
        if skill_id is not None and self.has_recent_own_skill_request(ts, skill_id, dst):
            if self.is_possession_host(src):
                return "possession"
            # Mount / non-PC caster while we pressed the skill → 骑宠.
            if src is not None and src != self.self_id and not self.is_likely_character_actor(src):
                self.enter_ride_mode(mount_id=src, reason="骑宠施法代理", ts=ts, quiet=True)
                return "ride"
            if self.is_ride_mount(src):
                self.refresh_ride_mode(ts)
                return "ride"
            # While mounted, server often still names the player as caster.
            if ride_on and (src is None or src == self.self_id or self.is_owned_pet_source(src)):
                self.refresh_ride_mode(ts)
                return "ride"
            if src is None or src == self.self_id:
                return "self"
            # Other PC after our C2S skill → 依凭 host (packet not seen yet).
            if self.possession_host_id is None and self.self_id is not None:
                self.possession_host_id = int(src)
            return "possession"
        if self.has_recent_own_attack(ts, dst, max_age=1.5):
            if self.is_possession_host(src):
                return "possession"
            # Player pressed AA; non-PC src is the mount body (or ride proxy).
            if src is not None and src != self.self_id and not self.is_likely_character_actor(src):
                self.enter_ride_mode(mount_id=src, reason="骑宠普攻代理", ts=ts, quiet=True)
                return "ride"
            if ride_on and (src is None or src == self.self_id):
                self.refresh_ride_mode(ts)
                return "ride"
            if src is None or src == self.self_id:
                return "self"
            if self.is_owned_pet_source(src) or self.is_pet_actor(src):
                return "pet"
            if src is not None and src != self.self_id and self.self_id is not None:
                if self.possession_host_id is None:
                    self.possession_host_id = int(src)
                return "possession"
        # Sticky ride: own outgoing with no fresh C2S match still reclassifies.
        if ride_on and self.self_id is not None and (
            src is None or src == self.self_id or self.is_ride_mount(src) or self.is_owned_pet_source(src)
        ):
            self.refresh_ride_mode(ts)
            return "ride"
        return None
