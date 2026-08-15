# -*- coding: utf-8 -*-
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_damage_classify import (  # noqa: E402
    classify_outgoing_proxy,
    is_ride_active,
    is_walk_partner,
    should_strip_player_skill_for_pet,
)


def base_state(**over):
    s = {
        "self_id": 84,
        "ride_mode": False,
        "ride_mount_id": None,
        "ride_mode_until": 0.0,
        "possession_host_id": None,
        "pet_actors": set(),
        "pet_owner": {},
    }
    s.update(over)
    return s


class ClassifyPureTest(unittest.TestCase):
    def test_self_normal_without_ride(self):
        st = base_state()
        self.assertEqual(
            classify_outgoing_proxy(
                st, ts=100.0, src=84, skill_id=None, has_own_attack=True
            ),
            "self",
        )

    def test_walk_pet_is_pet_not_ride(self):
        st = base_state(pet_actors={20061}, pet_owner={20061: 84})
        self.assertTrue(is_walk_partner(st, 20061, 100.0))
        self.assertEqual(
            classify_outgoing_proxy(
                st,
                ts=100.0,
                src=20061,
                skill_id=3127,
                has_own_skill_request=True,
                is_likely_character=False,
            ),
            "pet",
        )

    def test_ride_sticky_self_is_ride(self):
        st = base_state(
            ride_mode=True,
            ride_mount_id=20257,
            ride_mode_until=200.0,
        )
        self.assertTrue(is_ride_active(st, 150.0))
        self.assertEqual(
            classify_outgoing_proxy(
                st, ts=150.0, src=84, skill_id=None, has_own_attack=True
            ),
            "ride",
        )

    def test_ride_expired_is_self(self):
        st = base_state(
            ride_mode=True,
            ride_mount_id=20257,
            ride_mode_until=100.0,
        )
        self.assertFalse(is_ride_active(st, 150.0))
        self.assertEqual(
            classify_outgoing_proxy(
                st, ts=150.0, src=84, skill_id=None, has_own_attack=True
            ),
            "self",
        )

    def test_mount_src_while_ride(self):
        st = base_state(
            ride_mode=True,
            ride_mount_id=20257,
            ride_mode_until=200.0,
            pet_actors={20257},
            pet_owner={20257: 84},
        )
        # ride mount is not walk partner while ride active
        self.assertFalse(is_walk_partner(st, 20257, 150.0))
        self.assertEqual(
            classify_outgoing_proxy(
                st,
                ts=150.0,
                src=20257,
                skill_id=3001,
                has_own_skill_request=True,
                is_likely_character=False,
            ),
            "ride",
        )

    def test_non_pc_without_ride_is_not_auto_ride(self):
        st = base_state()
        self.assertIsNone(
            classify_outgoing_proxy(
                st,
                ts=100.0,
                src=99999,
                skill_id=1,
                has_own_skill_request=True,
                is_likely_character=False,
            )
        )

    def test_strip_skill_for_walk_pet(self):
        st = base_state(pet_actors={1}, pet_owner={1: 84})
        self.assertTrue(should_strip_player_skill_for_pet("pet", st, 1, 100.0))
        st2 = base_state(
            ride_mode=True,
            ride_mount_id=1,
            ride_mode_until=200.0,
            pet_actors={1},
            pet_owner={1: 84},
        )
        self.assertFalse(should_strip_player_skill_for_pet("pet", st2, 1, 150.0))


if __name__ == "__main__":
    unittest.main()
