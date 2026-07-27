"""Shared category rules for combat damage collection.

Fine channels match UI metric cards 1:1:
  self_normal, self_skill, pet_normal, pet_skill,
  ride_normal, ride_skill, possession_normal, possession_skill, taken
"""

# Fine capture keys (UI cards)
SELF_NORMAL = "self_normal"
SELF_SKILL = "self_skill"
PET_NORMAL = "pet_normal"
PET_SKILL = "pet_skill"
RIDE_NORMAL = "ride_normal"
RIDE_SKILL = "ride_skill"
POSSESSION_NORMAL = "possession_normal"
POSSESSION_SKILL = "possession_skill"
TAKEN = "taken"

CAPTURE_CATEGORIES = (
    SELF_NORMAL,
    SELF_SKILL,
    PET_NORMAL,
    PET_SKILL,
    RIDE_NORMAL,
    RIDE_SKILL,
    POSSESSION_NORMAL,
    POSSESSION_SKILL,
    TAKEN,
)

# Legacy coarse keys → fine keys (settings migration)
_LEGACY_MAP = {
    "skill": (SELF_SKILL, RIDE_SKILL, POSSESSION_SKILL),
    "normal": (SELF_NORMAL, RIDE_NORMAL, POSSESSION_NORMAL),
    "pet": (PET_NORMAL, PET_SKILL),
    "taken": (TAKEN,),
}

# Backward-compat aliases used by older tests / code
SKILL = "skill"
NORMAL = "normal"
PET = "pet"


def default_capture_categories():
    return {category: True for category in CAPTURE_CATEGORIES}


def update_capture_categories(current, incoming):
    """
    Merge capture toggles. Accepts fine keys and legacy coarse keys.
    Unknown keys are ignored. Omitted keys keep current/default value.
    """
    updated = default_capture_categories()
    sources = []
    if isinstance(current, dict):
        sources.append(current)
    if isinstance(incoming, dict):
        sources.append(incoming)

    for source in sources:
        # Apply legacy coarse first so fine keys can override.
        for legacy, fine_keys in _LEGACY_MAP.items():
            if legacy in source:
                value = bool(source[legacy])
                for key in fine_keys:
                    updated[key] = value
        for category in CAPTURE_CATEGORIES:
            if category in source:
                updated[category] = bool(source[category])
    return updated


def category_for_channel(channel):
    """Fine channel id (self_skill, ride_normal, …) → capture key."""
    if channel in CAPTURE_CATEGORIES:
        return channel
    if channel == "taken":
        return TAKEN
    # Fallback heuristics
    if channel.startswith("pet_"):
        return PET_SKILL if channel.endswith("skill") else PET_NORMAL
    if channel.startswith("ride_"):
        return RIDE_SKILL if channel.endswith("skill") else RIDE_NORMAL
    if channel.startswith("possession_"):
        return POSSESSION_SKILL if channel.endswith("skill") else POSSESSION_NORMAL
    if channel.endswith("skill"):
        return SELF_SKILL
    return SELF_NORMAL


def category_for_damage(side, skill_id=None, channel=None):
    """
    Map damage to capture category.
    Prefer explicit channel when present; else coarse side mapping (legacy).
    """
    if channel:
        return category_for_channel(channel)
    if side == "taken":
        return TAKEN
    if side == "pet_dealt":
        return PET_SKILL if skill_id is not None else PET_NORMAL
    if side == "dealt":
        return SELF_SKILL if skill_id is not None else SELF_NORMAL
    raise ValueError(f"unsupported damage side: {side}")
