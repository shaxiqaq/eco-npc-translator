# -*- coding: utf-8 -*-
import unittest

from eco_damage_meter import DamageMeter


class DamageDispatchTests(unittest.TestCase):
    def test_dispatch_table_covers_core_types(self):
        table = DamageMeter._PARSED_HANDLERS
        for key in (
            "player_exp",
            "player_level",
            "attack_request",
            "skill_cast_request",
            "skill_cast_result",
            "skill_active",
            "attack_result",
            "actor_buff",
        ):
            self.assertIn(key, table)
            self.assertTrue(callable(table[key]))

    def test_unknown_type_is_ignored(self):
        meter = DamageMeter(game_chat=False)
        self.addCleanup(meter.close)
        meter.handle_parsed({"type": "not_a_real_packet"}, 1.0)


if __name__ == "__main__":
    unittest.main()
