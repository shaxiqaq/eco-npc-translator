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

    def test_dedups_cast_time_skill_active_after_request(self):
        """Cast-bar skills fire skill_active >1s after C2S — must not double-count."""
        meter = DamageMeter(self_id=965, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 6415, "target": 965, "_op": 4999, "_dir": "C2S", "_sub": ""},
            ts,
        )
        meter.handle_parsed(
            {
                "type": "skill_cast_result",
                "skill_id": 6415,
                "caster": 965,
                "target": 965,
                "_op": 5001,
                "_dir": "S2C",
                "_sub": "",
            },
            ts + 0.2,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 6415,
                "caster": 965,
                "target": 965,
                "affected": [],
                "damages": [],
                "_op": 5005,
                "_dir": "S2C",
                "_sub": "",
            },
            ts + 1.2,
        )
        self.assertEqual(meter.snapshot()["skill_cast_total"], 1)
        self.assertEqual(meter.snapshot()["skill_casts"][0]["count"], 1)

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
            ts + 1.6,
        )
        self.assertEqual(meter.snapshot()["skill_cast_total"], 2)
        self.assertEqual(meter.snapshot()["skill_casts"][0]["count"], 2)

    def test_damage_dedups_skill_active_and_attack_result(self):
        meter = DamageMeter(self_id=100, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3001, "target": 500, "_op": 4999},
            ts,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 3001,
                "caster": 100,
                "target": 500,
                "affected": [500],
                "damages": [-42],
                "_op": 5010,
            },
            ts + 0.1,
        )
        # Same hit also arrives as attack_result (common dual-packet path).
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": 100,
                "dst": 500,
                "damage": 42,
                "_op": 4001,
            },
            ts + 0.15,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["skill_dealt"], 42)
        self.assertEqual(snap["dealt"], 42)
        self.assertEqual(snap["hits_dealt"], 1)

    def test_ride_mode_skill_counts_when_caster_is_mount(self):
        """骑宠: C2S from player, S2C caster is mount actor id."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        mount = 20257
        # Wiki 騎乗: absorb-style mount appear (hp=0,max_hp=0) before combat.
        meter.handle_parsed(
            {
                "type": "pet_appear",
                "actor": mount,
                "owner": 84,
                "hp": 0,
                "max_hp": 0,
                "_op": 4655,
            },
            ts,
        )
        self.assertTrue(meter.is_ride_active(ts))
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": 11000, "_op": 4999},
            ts + 0.05,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2486,
                "caster": mount,
                "target": 11000,
                "affected": [11000],
                "damages": [-88],
                "_op": 5010,
            },
            ts + 0.12,
        )
        snap = meter.snapshot()
        # Player skill while riding → ride_skill channel; never rebind self to mount.
        self.assertEqual(meter.self_id, 84)
        self.assertEqual(snap["ride_skill_dealt"], 88)
        self.assertEqual(snap["skill_dealt"], 88)
        self.assertEqual(snap["dealt"], 88)
        self.assertEqual(snap["self_skill_dealt"], 0)
        # Cast counted once from request.
        self.assertEqual(snap["skill_cast_total"], 1)

    def test_ride_mode_attack_result_with_own_skill_action(self):
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        mount = 20257
        meter.enter_ride_mode(mount_id=mount, reason="test", ts=ts, quiet=True)
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3001, "target": 12000, "_op": 4999},
            ts,
        )
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": mount,
                "dst": 12000,
                "damage": 55,
                "_op": 4001,
            },
            ts + 0.2,
        )
        snap = meter.snapshot()
        self.assertEqual(meter.self_id, 84)
        self.assertEqual(snap["ride_skill_dealt"], 55)
        self.assertEqual(snap["skill_dealt"], 55)
        self.assertEqual(snap["dealt"], 55)

    def test_sticky_ride_aa_with_src_self_counts_as_ride_normal(self):
        """骑宠: attack_result often still uses player id as src — must not go to self_normal."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        mount = 20257
        meter.handle_parsed(
            {
                "type": "pet_appear",
                "actor": mount,
                "owner": 84,
                "hp": 0,
                "max_hp": 0,
                "_op": 4655,
            },
            ts,
        )
        self.assertTrue(meter.is_ride_active(ts))
        meter.handle_parsed(
            {"type": "attack_request", "target": 13000, "_op": 3999},
            ts + 0.05,
        )
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": 84,
                "dst": 13000,
                "damage": 77,
                "_op": 4001,
            },
            ts + 0.15,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["ride_normal_dealt"], 77)
        self.assertEqual(snap["self_normal_dealt"], 0)
        self.assertEqual(snap["normal_dealt"], 77)
        self.assertEqual(snap["dealt"], 77)

    def test_sticky_ride_skill_with_src_self_counts_as_ride_skill(self):
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.enter_ride_mode(mount_id=20257, reason="test", ts=ts, quiet=True)
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2486, "target": 14000, "_op": 4999},
            ts,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2486,
                "caster": 84,
                "target": 14000,
                "affected": [14000],
                "damages": [-120],
                "_op": 5010,
            },
            ts + 0.12,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["ride_skill_dealt"], 120)
        self.assertEqual(snap["self_skill_dealt"], 0)
        self.assertEqual(snap["skill_dealt"], 120)

    def test_sticky_ride_skill_via_attack_result_aoe_target_mismatch(self):
        """Own skill C2S target may differ from attack_result hit unit (AOE)."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.enter_ride_mode(mount_id=20257, reason="test", ts=ts, quiet=True)
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3001, "target": 15000, "_op": 4999},
            ts,
        )
        # Hit a different unit than the primary C2S target.
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": 84,
                "dst": 15001,
                "damage": 66,
                "_op": 4001,
            },
            ts + 0.2,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["ride_skill_dealt"], 66)
        self.assertEqual(snap["self_normal_dealt"], 0)
        self.assertEqual(snap["self_skill_dealt"], 0)

    def test_walk_pet_appear_exits_ride_mode(self):
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.enter_ride_mode(mount_id=20257, reason="test", ts=ts, quiet=True)
        self.assertTrue(meter.is_ride_active(ts))
        meter.handle_parsed(
            {
                "type": "pet_appear",
                "actor": 30001,
                "owner": 84,
                "hp": 500,
                "max_hp": 800,
                "_op": 4655,
            },
            ts + 0.1,
        )
        self.assertFalse(meter.is_ride_active(ts + 0.1))
        meter.handle_parsed(
            {"type": "attack_request", "target": 16000, "_op": 3999},
            ts + 0.2,
        )
        meter.handle_parsed(
            {"type": "attack_result", "src": 84, "dst": 16000, "damage": 40, "_op": 4001},
            ts + 0.3,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["self_normal_dealt"], 40)
        self.assertEqual(snap["ride_normal_dealt"], 0)
        self.assertFalse(snap["ride_mode"])

    def test_pet_appear_without_hp_does_not_enter_ride(self):
        """Missing HP must not trigger sticky ride (was misclassifying all self damage)."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.handle_parsed(
            {
                "type": "pet_appear",
                "actor": 20060,
                "owner": 84,
                "hp": None,
                "max_hp": None,
                "_op": 4655,
            },
            ts,
        )
        self.assertFalse(meter.is_ride_active(ts))
        meter.handle_parsed(
            {"type": "attack_request", "target": 17000, "_op": 3999},
            ts + 0.05,
        )
        meter.handle_parsed(
            {"type": "attack_result", "src": 84, "dst": 17000, "damage": 50, "_op": 4001},
            ts + 0.1,
        )
        snap = meter.snapshot()
        self.assertEqual(snap["self_normal_dealt"], 50)
        self.assertEqual(snap["ride_normal_dealt"], 0)

    def test_walk_pet_aa_is_pet_not_ride_even_with_player_skill(self):
        """通常パートナー physical hit must not become 骑宠 when player just cast a skill.

        Repro: self skill C2S + pet AA on same target used to enter_ride_mode and
        sticky-reclass all self damage as ride_skill (user not mounted).
        """
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        pet = 20061
        meter.handle_parsed(
            {
                "type": "pet_appear",
                "actor": pet,
                "owner": 84,
                "hp": 800,
                "max_hp": 1000,
                "_op": 4655,
            },
            ts,
        )
        self.assertFalse(meter.is_ride_active(ts))
        # Player skill
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3127, "target": 19000, "_op": 4999},
            ts + 0.05,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 3127,
                "caster": 84,
                "target": 19000,
                "affected": [19000],
                "damages": [-200],
                "_op": 5010,
            },
            ts + 0.1,
        )
        # Pet physical AA on same target shortly after
        meter.handle_parsed(
            {
                "type": "attack_result",
                "src": pet,
                "dst": 19000,
                "damage": 330,
                "_op": 4001,
            },
            ts + 0.25,
        )
        # Another self skill must stay self_skill, not ride_skill
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 3127, "target": 19001, "_op": 4999},
            ts + 0.4,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 3127,
                "caster": 84,
                "target": 19001,
                "affected": [19001],
                "damages": [-180],
                "_op": 5010,
            },
            ts + 0.5,
        )
        snap = meter.snapshot()
        self.assertFalse(meter.is_ride_active(ts + 0.5))
        self.assertEqual(snap["pet_normal_dealt"], 330)
        self.assertEqual(snap["ride_skill_dealt"], 0)
        self.assertEqual(snap["ride_normal_dealt"], 0)
        self.assertEqual(snap["self_skill_dealt"], 380)
        self.assertEqual(snap["pet_dealt"], 330)

    def test_self_hits_do_not_extend_ride_ttl_forever(self):
        """After sticky TTL, self AA returns to self_normal even if fighting continuously."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        meter.enter_ride_mode(mount_id=20257, reason="test", ts=ts, quiet=True)
        meter.RIDE_MODE_TTL_S = 2.0
        meter.ride_mode_until = ts + 2.0
        # Within TTL → ride
        meter.handle_parsed(
            {"type": "attack_request", "target": 18000, "_op": 3999},
            ts + 0.2,
        )
        meter.handle_parsed(
            {"type": "attack_result", "src": 84, "dst": 18000, "damage": 10, "_op": 4001},
            ts + 0.3,
        )
        self.assertEqual(meter.ride_normal_dealt, 10)
        # Past TTL without mount evidence → self (continuous AA must not re-stick)
        meter.handle_parsed(
            {"type": "attack_request", "target": 18000, "_op": 3999},
            ts + 3.0,
        )
        meter.handle_parsed(
            {"type": "attack_result", "src": 84, "dst": 18000, "damage": 11, "_op": 4001},
            ts + 3.1,
        )
        self.assertFalse(meter.is_ride_active(ts + 3.1))
        self.assertEqual(meter.self_normal_dealt, 11)
        self.assertEqual(meter.ride_normal_dealt, 10)

    def test_possession_skill_counts_when_caster_is_host(self):
        """依凭: C2S from player, S2C caster is host body (another PC id)."""
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        host = 900
        meter.handle_parsed(
            {
                "type": "possession_result",
                "from_id": 84,
                "to_id": host,
                "result": 0,
                "_op": 6011,
            },
            ts,
        )
        self.assertEqual(meter.possession_host_id, host)
        meter.handle_parsed(
            {"type": "skill_cast_request", "skill_id": 2100, "target": 15000, "_op": 4999},
            ts + 0.1,
        )
        meter.handle_parsed(
            {
                "type": "skill_active",
                "skill_id": 2100,
                "caster": host,
                "target": 15000,
                "affected": [15000],
                "damages": [-120],
                "_op": 5010,
            },
            ts + 0.25,
        )
        snap = meter.snapshot()
        self.assertEqual(meter.self_id, 84)
        self.assertEqual(snap["possession_skill_dealt"], 120)
        self.assertEqual(snap["skill_dealt"], 120)
        self.assertEqual(snap["dealt"], 120)
        self.assertEqual(snap["self_skill_dealt"], 0)
        self.assertEqual(snap["skill_cast_total"], 1)

    def test_possession_attack_via_host_body(self):
        meter = DamageMeter(self_id=84, game_chat=False, out_path=None)
        self.addCleanup(meter.close)
        ts = time.time()
        host = 901
        meter.handle_parsed(
            {"type": "possession_result", "from_id": 84, "to_id": host, "result": 0, "_op": 6011},
            ts,
        )
        meter.handle_parsed(
            {"type": "attack_request", "target": 16000, "_op": 3999},
            ts + 0.1,
        )
        meter.handle_parsed(
            {"type": "attack_result", "src": host, "dst": 16000, "damage": 33, "_op": 4001},
            ts + 0.2,
        )
        snap = meter.snapshot()
        self.assertEqual(meter.self_id, 84)
        self.assertEqual(snap["dealt"], 33)
        self.assertEqual(snap["possession_normal_dealt"], 33)
        self.assertEqual(snap["normal_dealt"], 33)

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
