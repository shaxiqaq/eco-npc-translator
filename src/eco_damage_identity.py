# -*- coding: utf-8 -*-
"""Self-id bind / rebind helpers for DamageMeter (mixin)."""
from __future__ import annotations

import time

from eco_damage_util import now_label


class IdentityMixin:
    """Local player identity: candidates, bind, soft/hard reidentify."""

    def reset_identity(self, reason="manual", quiet=False, hard=False):
        """
        Allow re-learning the logged-in character.

        Soft mode (default, UI「重新识别」): keep showing the last self_id until a
        new local combat packet rebinds. This avoids the false "未识别" state that
        appears when users reidentify after a successful bind and export diagnostics
        before attacking again.

        Hard mode: immediately clear self_id (tests / forced wipe).
        """
        prev = self.self_id
        self.auto_self = True
        self._rebind_pending = True
        self.self_candidates.clear()
        # Drop stale C2S evidence from the previous login so re-bind is clean.
        self.recent_targets.clear()
        self.recent_actions.clear()
        self.exit_ride_mode(reason="reidentify", quiet=True)
        self.possession_host_id = None
        if hard or prev is None:
            self.self_id = None
            tracker = getattr(self, "buff_tracker", None)
            if tracker is not None:
                try:
                    tracker.reset_actor(None)
                except Exception:
                    pass
        if not quiet:
            if prev is not None and not hard:
                self.events.appendleft((
                    now_label(),
                    f"等待重新确认角色（当前仍显示 self={prev}，请攻击或放技能一次）",
                ))
                self.pending_notices.append({
                    "level": "info",
                    "message": f"请攻击或放技能一次以确认角色（当前 #{prev}）",
                })
            elif prev is not None:
                self.events.appendleft((now_label(), f"重置角色识别（原 self={prev}，原因={reason}）"))
            else:
                self.events.appendleft((now_label(), f"重置角色识别（原因={reason}）"))
            self.log({
                "ts": time.time(),
                "kind": "self_identity",
                "event": "reidentify_pending" if (prev is not None and not hard) else "reset",
                "previous": prev,
                "self_id": self.self_id,
                "reason": reason,
                "hard": hard,
            })

    def bind_self(self, actor, reason="auto", force=False):
        """Lock local player actor id. force=True rebinds after account/character switch."""
        if actor is None:
            return False
        try:
            actor = int(actor)
        except (TypeError, ValueError):
            return False
        if actor <= 0:
            return False
        if getattr(self, "_rebind_pending", False):
            force = True
        if self._self_id_forced and self.self_id is not None and actor != self.self_id and not force:
            return False
        if self.self_id == actor:
            self.auto_self = False
            self._rebind_pending = False
            return False
        if self.self_id is not None and not force and not self.auto_self:
            return False
        prev = self.self_id
        self.self_id = actor
        self.auto_self = False
        self._rebind_pending = False
        self.self_candidates[actor] += 4
        # Drop stale "self" from pet set if it was misclassified.
        self.pet_actors.discard(actor)
        # Character switch invalidates ride/possession proxy state.
        if prev is not None and prev != actor:
            self.exit_ride_mode(reason="character_switch", quiet=True)
            self.possession_host_id = None
        # If mount packets arrived before self_id was known, promote owned pets now.
        for pet_id, owner in list(self.pet_owner.items()):
            if owner == actor and pet_id != actor:
                hp = self.hp_by_actor.get(pet_id)
                if hp in (None, 0):
                    self.enter_ride_mode(mount_id=pet_id, reason="bind_owned_mount", quiet=True)
                    break
        label = "切换角色" if prev is not None and prev != actor else "识别角色"
        text = f"{label} self={actor}（{reason}）" + (f" 原={prev}" if prev is not None and prev != actor else "")
        self.events.appendleft((now_label(), text))
        self.pending_notices.append({
            "level": "success",
            "message": f"已{'切换' if prev is not None and prev != actor else '识别'}角色 #{actor}",
        })
        self.log({
            "ts": time.time(),
            "kind": "self_identity",
            "event": "bind" if prev is None else "rebind",
            "self_id": actor,
            "previous": prev,
            "reason": reason,
        })
        return True

    def mark_self_candidate(self, actor, score):
        if actor is None:
            return
        try:
            actor = int(actor)
        except (TypeError, ValueError):
            return
        if actor <= 0:
            return
        # Always accumulate evidence; useful after re-login even if locked.
        self.self_candidates[actor] += score
        if self.self_id is None and self.auto_self and self.self_candidates[actor] >= 4:
            self.bind_self(actor, reason="candidate_score")

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
            self.bind_self(actor, reason="outgoing_action")
        return self.self_id

    def observe_local_caster(self, caster, reason="local_packet"):
        """
        C2S skill/attack is always from the local client. When the matching S2C
        names a caster, that actor is the logged-in character — even if we had
        locked an older self_id from a previous account on the same process.
        """
        if caster is None:
            return False
        try:
            caster = int(caster)
        except (TypeError, ValueError):
            return False
        if caster <= 0:
            return False
        if self.self_id is None:
            return self.bind_self(caster, reason=reason)
        if self.self_id != caster:
            return self.bind_self(caster, reason=f"relogin_or_switch:{reason}", force=True)
        return False
