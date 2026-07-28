# -*- coding: utf-8 -*-
"""Ride / possession proxy classification for DamageMeter (mixin).

Wiki (eco.lycolia.info Partner system) distinguishes:

* **通常パートナー** (normal / walk partner): independent actor with HP/MP/SP;
  fights on its own → damage channel **pet_***.
* **ライド / 騎乗パートナー** (ride partner): player mounts it; damage is the
  player's output while mounted → channel **ride_*** (often still src=self).

Do **not** treat every non-PC source during our C2S as a mount — that was
mis-classifying walking combat pets as ride and then sticky-reclassifying all
self skills as 骑宠.
"""
from __future__ import annotations

import time

from eco_damage_util import now_label


class RideModeMixin:
    """Sticky ride mode + outgoing proxy source (self/pet/ride/possession)."""

    # TTL after last *hard* mount evidence (ride pet_appear 0/0, mount as src).
    # Self-src hits do not extend this.
    RIDE_MODE_TTL_S = 120.0

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
            self.ride_mode_reason = None
            self.ride_mount_id = None
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

    def refresh_ride_mode(self, ts=None, evidence=True):
        """Extend sticky TTL only on hard mount evidence."""
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
        if actor is None or self.ride_mount_id is None:
            return False
        try:
            return int(actor) == int(self.ride_mount_id)
        except (TypeError, ValueError):
            return False

    def is_walk_partner(self, actor):
        """通常パートナー: owned/marked pet that is not the active ride mount.

        Walk partners have independent HP and deal their own damage (pet channel).
        """
        if actor is None:
            return False
        try:
            actor = int(actor)
        except (TypeError, ValueError):
            return False
        if self.self_id is not None and actor == int(self.self_id):
            return False
        if self.is_ride_mount(actor) and self.is_ride_active():
            return False
        if self.is_owned_pet_source(actor) or self.is_pet_actor(actor):
            return True
        return False

    def local_skill_proxy_source(self, ts, src, skill_id, dst):
        """
        Classify outgoing proxy source.

        Returns 'self' | 'pet' | 'ride' | 'possession' | None.

        Priority (wiki-aligned):
        1. 依凭 host
        2. 通常パートナー (walk pet) → always pet
        3. Active ride mount / sticky ride + self → ride
        4. Self
        5. Other PC → possession (heuristic)
        """
        ride_on = self.is_ride_active(ts)

        # --- Known walk partner: never promote to ride from damage alone ---
        if src is not None and self.is_walk_partner(src):
            return "pet"

        if skill_id is not None and self.has_recent_own_skill_request(ts, skill_id, dst):
            if self.is_possession_host(src):
                return "possession"
            if self.is_ride_mount(src):
                self.refresh_ride_mode(ts, evidence=True)
                return "ride"
            # Non-PC caster while already riding → mount proxy (update mount id).
            if (
                ride_on
                and src is not None
                and src != self.self_id
                and not self.is_likely_character_actor(src)
            ):
                self.enter_ride_mode(mount_id=src, reason="骑宠施法代理", ts=ts, quiet=True)
                return "ride"
            # Sticky ride: server often still names the player as caster.
            if ride_on and (src is None or src == self.self_id):
                return "ride"
            if src is None or src == self.self_id:
                return "self"
            # Other PC after our C2S skill → 依凭 host (packet not seen yet).
            if self.is_likely_character_actor(src) and self.self_id is not None:
                if self.possession_host_id is None:
                    self.possession_host_id = int(src)
                return "possession"
            # Unknown non-PC without ride_on / walk-partner mark: do NOT enter ride.
            # (Walking combat pets that are not yet marked will be handled by
            # maybe_mark_pet_from_damage → pet.)
            return None

        if self.has_recent_own_attack(ts, dst, max_age=1.5):
            if self.is_possession_host(src):
                return "possession"
            if self.is_ride_mount(src):
                self.refresh_ride_mode(ts, evidence=True)
                return "ride"
            if (
                ride_on
                and src is not None
                and src != self.self_id
                and not self.is_likely_character_actor(src)
            ):
                self.enter_ride_mode(mount_id=src, reason="骑宠普攻代理", ts=ts, quiet=True)
                return "ride"
            if ride_on and (src is None or src == self.self_id):
                return "ride"
            if src is None or src == self.self_id:
                return "self"
            if self.is_owned_pet_source(src) or self.is_pet_actor(src):
                return "pet"
            if (
                src is not None
                and src != self.self_id
                and self.self_id is not None
                and self.is_likely_character_actor(src)
            ):
                if self.possession_host_id is None:
                    self.possession_host_id = int(src)
                return "possession"
            return None

        # Sticky ride without a fresh C2S match: only self / mount, never walk pets.
        if ride_on and self.self_id is not None:
            if src is None or src == self.self_id:
                return "ride"
            if self.is_ride_mount(src):
                self.refresh_ride_mode(ts, evidence=True)
                return "ride"
        return None
