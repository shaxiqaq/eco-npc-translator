import unittest

from eco_damage_categories import (
    NORMAL,
    PET,
    SKILL,
    TAKEN,
    category_for_damage,
    default_capture_categories,
    update_capture_categories,
)
from eco_damage_meter import DamageMeter


class DamageCategoryRulesTest(unittest.TestCase):
    def test_maps_damage_sides_to_four_capture_categories(self):
        self.assertEqual(category_for_damage("dealt", 3001), SKILL)
        self.assertEqual(category_for_damage("dealt", None), NORMAL)
        self.assertEqual(category_for_damage("pet_dealt", 7505), PET)
        self.assertEqual(category_for_damage("taken", None), TAKEN)

    def test_updates_only_known_categories(self):
        current = default_capture_categories()
        updated = update_capture_categories(
            current,
            {"skill": False, "pet": 0, "unknown": False},
        )

        self.assertEqual(
            updated,
            {"skill": False, "normal": True, "pet": False, "taken": True},
        )


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
        self.assertEqual(meter.skill_dealt, 20)
        self.assertEqual(meter.pet_dealt, 30)
        self.assertEqual(meter.total_taken, 5)
        self.assertEqual(len(meter.damage_history), 4)
        self.assertEqual(len(emitted), 4)

    def test_each_disabled_category_records_nothing(self):
        cases = (
            ("normal", self.normal_attack, "normal_dealt"),
            ("skill", self.skill_attack, "skill_dealt"),
            ("pet", self.pet_attack, "pet_dealt"),
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

        meter.set_capture_categories({"normal": False})
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


if __name__ == "__main__":
    unittest.main()
