# -*- coding: utf-8 -*-
"""SSMG_SKILL_CAST_RESULT (op 5001) layout must match SagaECO."""
import unittest

from eco_damage_capture import parse_packet
from eco_damage_meter import DamageMeter


# Real client captures (raw_sub from damage_electron jsonl).
REAL_SELF_BUFF_965 = bytes.fromhex("1389190f00000003c5000003ac000003c5ffff0100")
REAL_SELF_BUFF_461 = bytes.fromhex("138909b600000001cd00000615000001cdffff0500")
REAL_SKILL_3364_461 = bytes.fromhex("13890d2400000001cd00000000000001cdffff0500")


class SkillCastResultParseTests(unittest.TestCase):
    def test_parses_actor_and_target_unaligned(self):
        parsed = parse_packet("S2C", 5001, REAL_SELF_BUFF_965)
        self.assertEqual(parsed["type"], "skill_cast_result")
        self.assertEqual(parsed["skill_id"], 6415)
        self.assertEqual(parsed["caster"], 965)
        self.assertEqual(parsed["target"], 965)
        self.assertEqual(parsed["cast_time"], 940)

    def test_parses_account_switch_character_461(self):
        parsed = parse_packet("S2C", 5001, REAL_SELF_BUFF_461)
        self.assertEqual(parsed["skill_id"], 2486)
        self.assertEqual(parsed["caster"], 461)
        self.assertEqual(parsed["target"], 461)

    def test_does_not_produce_garbage_high_ids(self):
        """Old offsets misread 461 as 118271 / 118016."""
        parsed = parse_packet("S2C", 5001, REAL_SKILL_3364_461)
        self.assertEqual(parsed["caster"], 461)
        self.assertEqual(parsed["target"], 461)
        self.assertNotEqual(parsed["caster"], 118271)
        self.assertNotEqual(parsed["target"], 118016)

    def test_rebind_uses_real_packet_layout(self):
        meter = DamageMeter(game_chat=False)
        self.addCleanup(meter.close)
        meter.bind_self(965, reason="old_account")
        # New char 461 casts self-buff (request target = self).
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": 461, "_op": 4999},
            10.0,
        )
        parsed = parse_packet("S2C", 5001, REAL_SELF_BUFF_461)
        meter.handle_parsed(parsed, 10.05)
        self.assertEqual(meter.self_id, 461)


if __name__ == "__main__":
    unittest.main()
