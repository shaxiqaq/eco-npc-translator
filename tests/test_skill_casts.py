# -*- coding: utf-8 -*-
import time
import unittest

from eco_damage_meter import DamageMeter


class SkillCastTrackingTest(unittest.TestCase):
    def test_records_defensive_self_skill_without_damage(self):
        meter = DamageMeter(self_id=100, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()

        # Client request for パリイ (skill 2100) on self.
        meter.handle_parsed(
            {
                "type": "skill_cast_request",
                "skill_id": 2100,
                "target": 100,
                "_op": 4999,
                "_dir": "C2S",
                "_sub": "",
            },
            ts,
        )
        # Server active without damage list (op 5005 style).
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2100,
                "target": 100,
                "caster": 100,
                "affected": [],
                "damages": [],
                "_op": 5005,
                "_dir": "S2C",
                "_sub": "",
            },
            ts + 0.2,
        )

        snap = meter.snapshot()
        self.assertEqual(snap["skill_cast_total"], 1)
        self.assertEqual(snap["skill_dealt"], 0)
        self.assertEqual(len(snap["skill_casts"]), 1)
        self.assertEqual(snap["skill_casts"][0]["skill_id"], 2100)
        self.assertEqual(snap["skill_casts"][0]["count"], 1)
        self.assertEqual(snap["skill_casts"][0]["role"], "defensive")
        # Name should resolve to パリイ when dictionary is present.
        self.assertIn("パリイ", snap["skill_casts"][0]["skill"])
        self.assertEqual(len(snap["skill_cast_history"]), 1)

    def test_dedups_request_and_active_within_one_second(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2100,
                "target": 7,
                "caster": 7,
                "affected": [],
                "damages": [],
                "_op": 5005,
                "_dir": "S2C",
                "_sub": "",
            },
            ts + 0.3,
        )
        self.assertEqual(meter.snapshot()["skill_cast_total"], 1)

    def test_counts_second_cast_after_window(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts + 1.2,
        )
        self.assertEqual(meter.snapshot()["skill_cast_total"], 2)
        self.assertEqual(meter.snapshot()["skill_casts"][0]["count"], 2)

    def test_skill_cooldown_only_for_configured_skills(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        meter.reload_custom_durations({"skill:2100": 30.0, "magic_shield": 900.0})
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3001, "target": 99, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts + 0.05,
        )
        snap = meter.snapshot()
        cds = snap.get("skill_cooldowns") or []
        self.assertEqual(len(cds), 1)
        self.assertEqual(cds[0]["skill_id"], 2100)
        self.assertAlmostEqual(cds[0]["duration"], 30.0)
        self.assertGreater(cds[0]["remaining"], 29.0)
        self.assertEqual(cds[0]["category"], "cooldown")

    def test_skill_dual_timers_from_object_config(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        meter.reload_custom_durations({
            "skill:2100": {
                "duration": 3.0,
                "cooldown": 30.0,
                "skill_id": 2100,
                "label": "パリイ",
                "overlay": True,
            }
        })
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        snap = meter.snapshot()
        effects = snap.get("skill_effect_timers") or []
        cds = snap.get("skill_cooldowns") or []
        self.assertEqual(len(effects), 1)
        self.assertEqual(len(cds), 1)
        self.assertEqual(effects[0]["category"], "skill_duration")
        self.assertAlmostEqual(effects[0]["duration"], 3.0)
        self.assertAlmostEqual(cds[0]["duration"], 30.0)
        self.assertEqual(effects[0]["name"], "パリイ")
        self.assertEqual(cds[0]["name"], "パリイ")

    def test_skill_timers_hidden_when_overlay_unchecked(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        meter.reload_custom_durations({
            "skill:2100": {
                "duration": 3.0,
                "cooldown": 30.0,
                "skill_id": 2100,
                "overlay": False,
            }
        })
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        snap = meter.snapshot()
        self.assertEqual(snap.get("skill_effect_timers") or [], [])
        self.assertEqual(snap.get("skill_cooldowns") or [], [])

    def test_skill_cooldown_accepts_bare_and_cd_prefix_keys(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        meter.reload_custom_durations({"cd:6418": 12.0})
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 6418, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        cds = meter.snapshot()["skill_cooldowns"]
        self.assertEqual(len(cds), 1)
        self.assertEqual(cds[0]["skill_id"], 6418)
        self.assertAlmostEqual(cds[0]["duration"], 12.0)

        meter.reload_custom_durations({"2100": 5.0})
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts + 2.0,
        )
        ids = {item["skill_id"] for item in meter.snapshot()["skill_cooldowns"]}
        # 6418 config removed → dropped; 2100 bare key starts new CD.
        self.assertEqual(ids, {2100})

    def test_skill_cooldown_refreshes_on_recast(self):
        meter = DamageMeter(self_id=7, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        meter.reload_custom_durations({"skill:2100": {"cooldown": 20.0}})
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        first_expires = meter.snapshot()["skill_cooldowns"][0]["expires_at"]
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 7, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts + 5.0,
        )
        second = meter.snapshot()["skill_cooldowns"][0]
        self.assertGreater(second["expires_at"], first_expires)
        self.assertAlmostEqual(second["started_at"], ts + 5.0, places=2)


if __name__ == "__main__":
    unittest.main()
