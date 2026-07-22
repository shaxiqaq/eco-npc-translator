# -*- coding: utf-8 -*-
"""Build buff_names.json from the bundled SagaECO status definitions."""

import json
import re
from pathlib import Path


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "archive" / "SagaECO" / "sagaeco" / "SagaDB" / "Actor"
OUTPUT = HERE / "buff_names.json"
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


def main():
    output = {}
    for file_index in range(1, 13):
        path = SOURCE / f"Buff.{file_index}.cs"
        text = path.read_text(encoding="utf-8-sig")
        for source_name, group_text, mask_text in PROPERTY.findall(text):
            group = int(group_text)
            mask = int(mask_text, 16)
            key = f"{group}:0x{mask:08x}"
            output[key] = {
                "name": NAME_OVERRIDES.get(source_name, source_name),
                "source_name": source_name,
                "category": category_for(group, source_name),
            }
    OUTPUT.write_text(
        json.dumps(dict(sorted(output.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT} ({len(output)} status names)")


if __name__ == "__main__":
    main()
