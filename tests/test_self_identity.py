# -*- coding: utf-8 -*-
import unittest

from eco_damage_meter import DamageMeter


class SelfIdentityRebindTests(unittest.TestCase):
    """Account/character switch on the same eco.exe must re-bind self_id."""

    def make_meter(self):
        meter = DamageMeter(game_chat=False)
        self.addCleanup(meter.close)
        return meter

    def test_binds_from_skill_request_then_result(self):
        meter = self.make_meter()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 200, "_op": 4999},
            1.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 2100,
                "caster": 965,
                "target": 200,
                "_op": 5001,
            },
            1.05,
        )
        self.assertEqual(meter.self_id, 965)

    def test_rebinds_after_account_switch_same_process(self):
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        self.assertEqual(meter.self_id, 965)
        self.assertFalse(meter.auto_self)

        # New character on same attached process: local C2S then S2C with new caster.
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": 461, "_op": 4999},
            10.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 2486,
                "caster": 461,
                "target": 461,
                "_op": 5001,
            },
            10.05,
        )
        self.assertEqual(meter.self_id, 461)

    def test_rebinds_when_request_target_is_ffffffff(self):
        """Ground/self skills often send target=0xFFFFFFFF; must still rebind."""
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.handle_parsed(
            {
                "type": "skill_cast_request",
                "skill_id": 2100,
                "target": 0xFFFFFFFF,
                "_op": 4999,
            },
            20.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 2100,
                "caster": 777,
                "target": 777,
                "_op": 5001,
            },
            20.05,
        )
        self.assertEqual(meter.self_id, 777)

    def test_rebinds_when_result_target_differs_from_request(self):
        """AOE / multi-hit: request primary target may differ from S2C target."""
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3001, "target": 50000, "_op": 4999},
            30.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 3001,
                "caster": 888,
                "target": 50001,  # different unit than request
                "_op": 5001,
            },
            30.08,
        )
        self.assertEqual(meter.self_id, 888)

    def test_rebinds_from_skill_active_affected_list(self):
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 4002, "target": 60000, "_op": 4999},
            40.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 4002,
                "caster": 333,
                "target": 0,
                "affected": [60010, 60011],
                "damages": [-100, -50],
                "_op": 5010,
            },
            40.1,
        )
        self.assertEqual(meter.self_id, 333)

    def test_rebinds_from_attack_result_after_switch(self):
        """Normal attack path: C2S attack_request + S2C attack_result src."""
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.handle_parsed(
            {"type": "attack_request", "target": 90001, "_op": 3999},
            50.0,
        )
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": 555,
                "dst": 90001,
                "damage": 12,
                "_op": 4001,
            },
            50.1,
        )
        self.assertEqual(meter.self_id, 555)

    def test_stats_reset_keeps_identity(self):
        """Clearing damage between fights must not forget the logged-in character."""
        meter = self.make_meter()
        meter.bind_self(100, reason="test")
        meter.reset()
        self.assertEqual(meter.self_id, 100)
        self.assertFalse(meter.auto_self)

    def test_cli_forced_self_survives_reset(self):
        meter = DamageMeter(self_id=42, game_chat=False)
        self.addCleanup(meter.close)
        meter.reset()
        self.assertEqual(meter.self_id, 42)

    def test_soft_reidentify_keeps_self_until_rebind(self):
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 1, "target": 2, "_op": 4999},
            1.0,
        )
        self.assertTrue(meter.recent_actions)
        meter.reset_identity(reason="user_reidentify", quiet=True, hard=False)
        # Soft: still show last character so UI does not flash "未识别".
        self.assertEqual(meter.self_id, 965)
        self.assertTrue(meter._rebind_pending)
        self.assertEqual(len(meter.recent_actions), 0)
        self.assertTrue(meter.auto_self)
        # Next local skill rebinds to the new account.
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": 461, "_op": 4999},
            10.0,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 2486,
                "caster": 461,
                "target": 461,
                "_op": 5001,
            },
            10.05,
        )
        self.assertEqual(meter.self_id, 461)
        self.assertFalse(meter._rebind_pending)

    def test_hard_reset_identity_clears_self(self):
        meter = self.make_meter()
        meter.bind_self(965, reason="first_login")
        meter.reset_identity(reason="hard", quiet=True, hard=True)
        self.assertIsNone(meter.self_id)
        self.assertTrue(meter._rebind_pending)


if __name__ == "__main__":
    unittest.main()
