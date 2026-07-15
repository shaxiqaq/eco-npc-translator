"""Console rendering for the ECO damage meter."""

import os
import time


def format_duration(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def render(meter):
    snap = meter.snapshot()
    os.system("cls")
    print("技能伤害明细")
    print("================")
    self_text = snap["self_id"] if snap["self_id"] is not None else f"detecting... {snap['candidates']}"
    print(f"角色编号  : {self_text}")
    print(f"运行时间  : {format_duration(snap['elapsed'])}   战斗时间: {format_duration(snap['active'])}")
    print()
    print("伤害统计")
    print(f"  技能造成      : {snap['skill_dealt']:>8}   秒伤: {snap['skill_dps']:>7.2f}   次数: {snap['hits_skill_dealt']:>3}   最大: {snap['max_skill_dealt']}")
    print(f"  普通攻击造成  : {snap['normal_dealt']:>8}   秒伤: {snap['normal_dps']:>7.2f}   次数: {snap['hits_normal_dealt']:>3}   最大: {snap['max_normal_dealt']}")
    print(f"  宠物造成      : {snap['pet_dealt']:>8}   秒伤: {snap['pet_dps']:>7.2f}   次数: {snap['hits_pet_dealt']:>3}   最大: {snap['max_pet_dealt']}")
    print(f"      宠物技能  : {snap['pet_skill_dealt']:>8}   次数: {snap['hits_pet_skill_dealt']:>3}   最大: {snap['max_pet_skill_dealt']}")
    print(f"      宠物普攻  : {snap['pet_normal_dealt']:>8}   次数: {snap['hits_pet_normal_dealt']:>3}   最大: {snap['max_pet_normal_dealt']}")
    print(f"  对我造成      : {snap['taken']:>8}   秒均: {snap['tps']:>7.2f}   次数: {snap['hits_taken']:>3}   最大: {snap['max_taken']}")
    print(f"      其中技能  : {snap['skill_taken']:>8}   次数: {snap['hits_skill_taken']:>3}   最大: {snap['max_skill_taken']}")
    print(f"      其中普通  : {snap['normal_taken']:>8}   次数: {snap['hits_normal_taken']:>3}   最大: {snap['max_normal_taken']}")
    _print_skill_totals(meter, snap)
    _print_skill_history(snap, "dealt", "技能造成流水", "造成")
    _print_skill_history(snap, "taken", "技能受到流水", "受到")
    _print_pet_history(snap)
    _print_normal_history(snap, "dealt", "普通攻击造成流水", "造成")
    _print_normal_history(snap, "taken", "普通攻击受到流水", "受到")
    _print_recent_actions(meter, snap)
    _print_unknown_actors(meter, snap)
    print()
    print("最近")
    for event_time, text in snap["events"][:10]:
        print(f"  [{event_time}] {text}")
    print()
    print("F8 清空当前明细，F10 测试游戏聊天，Ctrl+C 停止")


def _print_skill_totals(meter, snap):
    groups = (
        ("技能造成", "skills_dealt"),
        ("技能受到", "skills_taken"),
        ("宠物技能", "pet_skills"),
    )
    for label, key in groups:
        values = snap[key]
        if values:
            text = " / ".join(
                f"{meter.skill_label(skill_id)}:{damage}"
                for skill_id, damage in values[:4]
            )
            print(f"  {label}: {text}")
        else:
            print(f"  {label}: -")


def _print_skill_history(snap, side, title, verb):
    print()
    print(title)
    hits = [
        item for item in snap["damage_history"]
        if item.get("skill_id") is not None and item.get("side") == side
    ]
    if not hits:
        print(f"  - 还没有{title[:-2]}伤害")
        return
    for item in hits[-10:]:
        skill_id = item.get("skill_id")
        print(f"  [{item['time']}] {verb} {item['damage']}  {item['source']} -> {item['target']}")
        print(
            f"      技能: {item['skill']}#{skill_id}  "
            f"来源: {item.get('source_kind', '未知')}{_op_text(item)}"
        )


def _print_pet_history(snap):
    print()
    print("宠物造成流水")
    hits = [item for item in snap["damage_history"] if item.get("side") == "pet_dealt"]
    if not hits:
        print("  - 还没有宠物造成伤害")
        return
    for item in hits[-10:]:
        skill_id = item.get("skill_id")
        kind = "技能" if skill_id is not None else "普攻"
        print(
            f"  [{item['time']}] 宠物{kind} {item['damage']}  "
            f"{item['source']} -> {item['target']}  "
            f"来源: {item.get('source_kind', '未知')}{_op_text(item)}"
        )
        if skill_id is not None:
            print(f"       技能: {item['skill']}#{skill_id}")


def _print_normal_history(snap, side, title, verb):
    print()
    print(title)
    hits = [
        item for item in snap["damage_history"]
        if item.get("skill_id") is None and item.get("side") == side
    ]
    if not hits:
        print(f"  - 还没有{title[:-2]}伤害")
        return
    for item in hits[-10:]:
        print(
            f"  [{item['time']}] {verb} {item['damage']}  "
            f"{item['source']} -> {item['target']}  "
            f"来源: {item.get('source_kind', '未知')}{_op_text(item)}"
        )


def _print_recent_actions(meter, snap):
    print()
    print("最近技能动作")
    actions = [action for action in snap.get("recent_actions", []) if action.get("kind") == "skill"]
    if not actions:
        print("  -")
        return
    for action in actions[:6]:
        age = max(0, int(time.time() - action["ts"]))
        print(
            f"  {age:>2}s前  {meter.skill_label(action.get('skill_id'))}#{action.get('skill_id')}  "
            f"{meter.actor_label(action.get('actor'))} -> {meter.actor_label(action.get('target'))}"
        )


def _print_unknown_actors(meter, snap):
    print()
    print("未识别对象")
    if not snap["unknown_actors"]:
        print("  -")
        return
    guess = snap.get("mob_template_guess")
    if guess is not None:
        guess_name = meter.mob_names.get(guess) or f"怪物#{guess}"
        print(f"  当前按已出现怪物推测为: {guess_name}（等待精确出现包确认）")
    for actor, count in snap["unknown_actors"]:
        print(f"  {actor}  出现在伤害包 {count} 次；等待怪物出现包或名字包")


def _op_text(item):
    op = item.get("raw_op")
    return f" op={op}" if op is not None else ""
