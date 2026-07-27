# -*- coding: utf-8 -*-
import unittest

from eco_damage_categories import (
    PET_NORMAL,
    PET_SKILL,
    SELF_NORMAL,
    SELF_SKILL,
    TAKEN,
    category_for_channel,
    category_for_damage,
    default_capture_categories,
    update_capture_categories,
)
from eco_damage_meter import DamageMeter


class DamageCategoryRulesTest(unittest.TestCase):
    def test_maps_sides_and_channels(self):
        self.assertEqual(category_for_damage("dealt", 3001), SELF_SKILL)
        self.assertEqual(category_for_damage("dealt", None), SELF_NORMAL)
        self.assertEqual(category_for_damage("pet_dealt", 7505), PET_SKILL)
        self.assertEqual(category_for_damage("taken", None), TAKEN)
        self.assertEqual(category_for_channel("ride_skill"), "ride_skill")
        self.assertEqual(category_for_damage("dealt", 1, channel="possession_skill"), "possession_skill")

    def test_updates_fine_keys(self):
        current = default_capture_categories()
        updated = update_capture_categories(
            current,
            {"self_skill": False, "pet_normal": 0, "unknown": False},
        )
        self.assertFalse(updated["self_skill"])
        self.assertFalse(updated["pet_normal"])
        self.assertTrue(updated["self_normal"])
        self.assertTrue(updated["taken"])

    def test_legacy_coarse_keys_expand(self):
        updated = update_capture_categories(
            default_capture_categories(),
            {"skill": False, "pet": False},
        )
        self.assertFalse(updated["self_skill"])
        self.assertFalse(updated["ride_skill"])
        self.assertFalse(updated["possession_skill"])
        self.assertFalse(updated["pet_normal"])
        self.assertFalse(updated["pet_skill"])
        self.assertTrue(updated["self_normal"])


class DamageMeterCaptureSwitchTest(unittest.TestCase):
    SELF = 100
    TARGET = 200
    PET_ACTOR = 300
    ENEMY = 400

    def make_meter(self):
        emitted = []
        meter = DamageMeter(
            self_id=self.SELF,
            game_chat=False,
            event_sink=emitted.append,
        )
        self.addCleanup(meter.close)
        return meter, emitted

    def normal_attack(self, meter, ts=1.0, damage=10):
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": self.SELF,
                "dst": self.TARGET,
                "damage": damage,
                "_op": 4001,
            },
            ts,
        )

    def skill_attack(self, meter, ts=10.0, damage=20):
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 3001,
                "caster": self.SELF,
                "target": self.TARGET,
                "affected": [self.TARGET],
                "damages": [-damage],
                "_op": 5010,
            },
            ts,
        )

    def pet_attack(self, meter, ts=20.0, damage=30):
        meter.mark_pet_actor(self.PET_ACTOR, owner=self.SELF)
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": self.PET_ACTOR,
                "dst": self.TARGET,
                "damage": damage,
                "_op": 4001,
            },
            ts,
        )

    def incoming_attack(self, meter, ts=30.0, damage=5):
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": self.ENEMY,
                "dst": self.SELF,
                "damage": damage,
                "_op": 4001,
            },
            ts,
        )

    def test_all_categories_are_collected_by_default(self):
        meter, emitted = self.make_meter()

        self.normal_attack(meter)
        self.skill_attack(meter)
        self.pet_attack(meter)
        self.incoming_attack(meter)

        self.assertEqual(meter.normal_dealt, 10)
        self.assertEqual(meter.self_normal_dealt, 10)
        self.assertEqual(meter.skill_dealt, 20)
        self.assertEqual(meter.self_skill_dealt, 20)
        self.assertEqual(meter.pet_dealt, 30)
        self.assertEqual(meter.total_taken, 5)
        self.assertEqual(len(meter.damage_history), 4)
        self.assertEqual(len(emitted), 4)

    def test_each_disabled_fine_category_records_nothing(self):
        cases = (
            ("self_normal", self.normal_attack, "self_normal_dealt"),
            ("self_skill", self.skill_attack, "self_skill_dealt"),
            ("pet_normal", self.pet_attack, "pet_normal_dealt"),
            ("taken", self.incoming_attack, "total_taken"),
        )

        for category, action, counter in cases:
            with self.subTest(category=category):
                meter, emitted = self.make_meter()
                meter.set_capture_categories({category: False})

                action(meter)

                self.assertEqual(getattr(meter, counter), 0)
                self.assertEqual(meter.damage_history, [])
                self.assertEqual(emitted, [])

    def test_disabling_category_keeps_history_but_stops_future_stats(self):
        meter, emitted = self.make_meter()
        self.normal_attack(meter, ts=1.0, damage=10)

        meter.set_capture_categories({"self_normal": False})
        self.normal_attack(meter, ts=2.0, damage=99)

        self.assertEqual(meter.normal_dealt, 10)
        self.assertEqual(meter.total_dealt, 10)
        self.assertEqual(meter.hits_normal_dealt, 1)
        self.assertEqual(len(meter.damage_history), 1)
        self.assertEqual(len(emitted), 1)

    def test_taken_switch_blocks_normal_and_skill_damage(self):
        meter, emitted = self.make_meter()
        meter.set_capture_categories({"taken": False})

        self.incoming_attack(meter, ts=1.0, damage=5)
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 3001,
                "caster": self.ENEMY,
                "target": self.SELF,
                "affected": [self.SELF],
                "damages": [-25],
                "_op": 5010,
            },
            10.0,
        )

        self.assertEqual(meter.total_taken, 0)
        self.assertEqual(meter.normal_taken, 0)
        self.assertEqual(meter.skill_taken, 0)
        self.assertEqual(meter.damage_history, [])
        self.assertEqual(emitted, [])

    def test_snapshot_limits_history_before_copying_it(self):
        meter, _ = self.make_meter()
        self.normal_attack(meter, ts=1.0, damage=10)
        self.normal_attack(meter, ts=2.0, damage=20)
        self.normal_attack(meter, ts=3.0, damage=30)

        limited = meter.snapshot(history_limit=2)
        full = meter.snapshot()

        self.assertEqual([item["damage"] for item in limited["damage_history"]], [20, 30])
        self.assertEqual([item["damage"] for item in full["damage_history"]], [10, 20, 30])
        self.assertEqual(limited["history_version"], 3)

        meter.reset()
        reset = meter.snapshot(history_limit=2)
        self.assertEqual(reset["damage_history"], [])
        self.assertEqual(reset["history_version"], 0)

    def test_ride_skill_toggle_independent(self):
        meter, _ = self.make_meter()
        meter.set_capture_categories({"ride_skill": False, "self_skill": True})
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": self.TARGET, "_op": 4999},
            1.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2486,
                "caster": 20257,
                "target": self.TARGET,
                "affected": [self.TARGET],
                "damages": [-50],
                "_op": 5010,
            },
            1.1,
        )
        self.assertEqual(meter.ride_skill_dealt, 0)
        self.assertEqual(meter.self_skill_dealt, 0)


if __name__ == "__main__":
    unittest.main()
