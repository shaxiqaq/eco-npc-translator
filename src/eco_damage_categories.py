"""Shared category rules for combat damage collection."""

SKILL = "skill"
NORMAL = "normal"
PET = "pet"
TAKEN = "taken"

CAPTURE_CATEGORIES = (SKILL, NORMAL, PET, TAKEN)


def default_capture_categories():
    return {category: True for category in CAPTURE_CATEGORIES}


def update_capture_categories(current, incoming):
    """Return validated settings while preserving omitted category values."""
    updated = default_capture_categories()
    if isinstance(current, dict):
        for category in CAPTURE_CATEGORIES:
            if category in current:
                updated[category] = bool(current[category])
    if isinstance(incoming, dict):
        for category in CAPTURE_CATEGORIES:
            if category in incoming:
                updated[category] = bool(incoming[category])
    return updated


def category_for_damage(side, skill_id=None):
    """Map a normalized damage side to its user-facing capture category."""
    if side == "taken":
        return TAKEN
    if side == "pet_dealt":
        return PET
    if side == "dealt":
        return NORMAL if skill_id is None else SKILL
    raise ValueError(f"unsupported damage side: {side}")
