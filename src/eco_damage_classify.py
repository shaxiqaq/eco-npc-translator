# -*- coding: utf-8 -*-
"""
Pure (mostly) outgoing damage source classification.

Wiki (Partner system): 通常パートナー → pet; ライド/騎乗 → ride while mounted.
State is passed as a plain dict so unit tests need no DamageMeter instance.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Set


def _as_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def snapshot_classify_state(meter) -> Dict[str, Any]:
    """Build a plain dict from a live DamageMeter (or compatible object)."""
    return {
        "self_id": getattr(meter, "self_id", None),
        "ride_mode": bool(getattr(meter, "ride_mode", False)),
        "ride_mount_id": getattr(meter, "ride_mount_id", None),
        "ride_mode_until": float(getattr(meter, "ride_mode_until", 0) or 0),
        "possession_host_id": getattr(meter, "possession_host_id", None),
        "pet_actors": set(getattr(meter, "pet_actors", ()) or ()),
        "pet_owner": dict(getattr(meter, "pet_owner", {}) or {}),
    }


def is_ride_active(state: Dict[str, Any], ts: float) -> bool:
    if not state.get("ride_mode"):
        return False
    until = float(state.get("ride_mode_until") or 0)
    return ts <= until


def is_ride_mount(state: Dict[str, Any], actor) -> bool:
    mid = state.get("ride_mount_id")
    a = _as_int(actor)
    m = _as_int(mid)
    return a is not None and m is not None and a == m


def is_possession_host(state: Dict[str, Any], actor) -> bool:
    host = state.get("possession_host_id")
    a = _as_int(actor)
    h = _as_int(host)
    return a is not None and h is not None and a == h


def is_owned_pet(state: Dict[str, Any], actor) -> bool:
    a = _as_int(actor)
    if a is None:
        return False
    if a in (state.get("pet_actors") or set()):
        owner = (state.get("pet_owner") or {}).get(a)
        sid = _as_int(state.get("self_id"))
        if sid is None or owner is None:
            return a in (state.get("pet_actors") or set())
        return _as_int(owner) == sid
    owner = (state.get("pet_owner") or {}).get(a)
    sid = _as_int(state.get("self_id"))
    return sid is not None and _as_int(owner) == sid


def is_walk_partner(state: Dict[str, Any], actor, ts: float) -> bool:
    """通常パートナー: marked/owned pet that is not the active ride mount."""
    a = _as_int(actor)
    if a is None:
        return False
    sid = _as_int(state.get("self_id"))
    if sid is not None and a == sid:
        return False
    if is_ride_mount(state, a) and is_ride_active(state, ts):
        return False
    pets: Set = state.get("pet_actors") or set()
    if a in pets or is_owned_pet(state, a):
        return True
    return False


def classify_outgoing_proxy(
    state: Dict[str, Any],
    *,
    ts: float,
    src,
    skill_id=None,
    has_own_skill_request: bool = False,
    has_own_attack: bool = False,
    is_likely_character: bool = False,
) -> Optional[str]:
    """
    Returns 'self' | 'pet' | 'ride' | 'possession' | None.

    Does not mutate state (enter/refresh ride are side effects for the meter).
    Callers apply enter_ride_mode when result is 'ride' and mount evidence is new.
    """
    ride_on = is_ride_active(state, ts)
    sid = _as_int(state.get("self_id"))
    src_i = _as_int(src)

    # 1) Walk partner always pet
    if src_i is not None and is_walk_partner(state, src_i, ts):
        return "pet"

    if skill_id is not None and has_own_skill_request:
        if is_possession_host(state, src_i):
            return "possession"
        if is_ride_mount(state, src_i):
            return "ride"
        if ride_on and src_i is not None and sid is not None and src_i != sid and not is_likely_character:
            return "ride"
        if ride_on and (src_i is None or src_i == sid):
            return "ride"
        if src_i is None or src_i == sid:
            return "self"
        if is_likely_character and sid is not None:
            return "possession"
        return None

    if has_own_attack:
        if is_possession_host(state, src_i):
            return "possession"
        if is_ride_mount(state, src_i):
            return "ride"
        if ride_on and src_i is not None and sid is not None and src_i != sid and not is_likely_character:
            return "ride"
        if ride_on and (src_i is None or src_i == sid):
            return "ride"
        if src_i is None or src_i == sid:
            return "self"
        if is_owned_pet(state, src_i) or src_i in (state.get("pet_actors") or set()):
            return "pet"
        if is_likely_character and sid is not None and src_i is not None and src_i != sid:
            return "possession"
        return None

    if ride_on and sid is not None:
        if src_i is None or src_i == sid:
            return "ride"
        if is_ride_mount(state, src_i):
            return "ride"
    return None


def should_strip_player_skill_for_pet(proxy: Optional[str], state: Dict[str, Any], src, ts: float) -> bool:
    """Pet AA should not inherit the player's recent skill_id."""
    if proxy != "pet":
        return False
    return not (is_ride_mount(state, src) and is_ride_active(state, ts))
