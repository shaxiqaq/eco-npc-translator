# -*- coding: utf-8 -*-
"""Build buff_names.json from the bundled SagaECO status definitions."""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir

_RES_DIR, _DATA_DIR = resolve_dirs(__file__)
ensure_data_layout(_DATA_DIR)
HERE = Path(_RES_DIR)
REPO = Path(_RES_DIR).resolve().parent
SOURCE = REPO / "archive" / "SagaECO" / "sagaeco" / "SagaDB" / "Actor"
OUTPUT = Path(_DATA_DIR) / "buff_names.json"
logger = setup_logger(
    "eco.import_sagaeco_buffs",
    log_dir=log_dir(_DATA_DIR),
    log_file="import_sagaeco_buffs.log",
)
PROPERTY = re.compile(
    r"public bool\s+([^\s{]+)\s*\{.*?buffs\[(\d+)\]\.Test\((0x[0-9A-Fa-f]+)\)",
    re.S,
)

NAME_OVERRIDES = {
    "Poison": "中毒",
    "Stone": "石化",
    "Paralysis": "麻痹",
    "Sleep": "睡眠",
    "Silence": "沉默",
    "SpeedDown": "移动速度下降",
    "Confused": "混乱",
    "Frosen": "冻结",
    "Stun": "眩晕",
    "PoisonResist": "中毒抗性",
    "StoneResist": "石化抗性",
    "ParalysisResist": "麻痹抗性",
    "SleepResist": "睡眠抗性",
    "SilenceResist": "沉默抗性",
    "ConfusedResist": "混乱抗性",
    "FrosenResist": "冻结抗性",
    "StunResist": "眩晕抗性",
    "Faint": "昏厥",
    "FaintResist": "昏厥抗性",
    "Sit": "坐下",
    "Spirit": "灵魂状态",
    "Curse": "诅咒",
    "Revive": "复活",
    "PetUp": "宠物强化",
    "WeaponFire": "武器火属性上升",
    "WeaponWater": "武器水属性上升",
    "WeaponWind": "武器风属性上升",
    "WeaponEarth": "武器土属性上升",
    "WeaponHoly": "武器光属性上升",
    "WeaponDark": "武器暗属性上升",
    "MDefUp": "魔法防御率上升",
    "MDefAddUp": "魔法防御力上升",
    "DefUp": "物理防御率上升",
    "DefAddUp": "物理防御力上升",
    "HitMeleeUp": "近战命中上升",
    "HitRangedUp": "远程命中上升",
    "AvoidMeleeUp": "近战闪避上升",
    "AvoidRangedUp": "远程闪避上升",
}


def category_for(group, name):
    if group == 0 and not name.endswith("Resist") and name not in {"Sit", "Spirit"}:
        return "abnormal"
    if group == 4:
        return "negative"
    return "positive"


def load_skill_name_index():
    """Map Chinese/EN skill display names -> skill_id from skill_names.json."""
    path = Path(_DATA_DIR) / "skill_names.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    index = {}
    if not isinstance(data, dict):
        return index
    for key, value in data.items():
        try:
            skill_id = int(key, 0)
        except Exception:
            continue
        if isinstance(value, str) and value.strip():
            index[value.strip()] = skill_id
    return index


# Known status-bit -> skill id pairs confirmed in this toolbox.
KNOWN_SKILL_IDS = {
    "magic_shield": 3114,
    "3:0x00000400": 3114,  # MDefUp half of magic shield
    "3:0x00000800": 3114,  # MDefAddUp half of magic shield
    "3:0x00000c00": 3114,
}


def main():
    skill_index = load_skill_name_index()
    output = {}
    for file_index in range(1, 13):
        path = SOURCE / f"Buff.{file_index}.cs"
        text = path.read_text(encoding="utf-8-sig")
        for source_name, group_text, mask_text in PROPERTY.findall(text):
            group = int(group_text)
            mask = int(mask_text, 16)
            key = f"{group}:0x{mask:08x}"
            name = NAME_OVERRIDES.get(source_name, source_name)
            entry = {
                "name": name,
                "source_name": source_name,
                "category": category_for(group, source_name),
            }
            skill_id = KNOWN_SKILL_IDS.get(key) or skill_index.get(name) or skill_index.get(source_name)
            if skill_id:
                entry["skill_id"] = int(skill_id)
            output[key] = entry

    # Composite magic shield alias used by BuffTracker.
    output["magic_shield"] = {
        "name": "魔法护盾",
        "source_name": "MAGIC_SHIELD",
        "category": "positive",
        "skill_id": 3114,
        "duration": 900.04,
        "timing": "estimated_observed",
        "verified": True,
    }

    OUTPUT.write_text(
        json.dumps(dict(sorted(output.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with_skill = sum(1 for item in output.values() if item.get("skill_id"))
    logger.info("wrote %s (%s status names, %s with skill_id)", OUTPUT, len(output), with_skill)


if __name__ == "__main__":
    main()
