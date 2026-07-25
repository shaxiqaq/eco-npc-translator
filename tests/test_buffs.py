import unittest

from eco_buffs import BuffTracker
from eco_damage_capture import parse_packet
from eco_damage_meter import DamageMeter


class BuffPacketParserTest(unittest.TestCase):
    def test_parses_actor_and_twelve_masks(self):
        actor = 2873
        masks = [0, 0, 0, 0xC00] + [0] * 8
        packet = b"\x15\x7c" + actor.to_bytes(4, "big")
        packet += b"".join(value.to_bytes(4, "big") for value in masks)

        parsed = parse_packet("S2C", 5500, packet)

        self.assertEqual(parsed["type"], "actor_buff")
        self.assertEqual(parsed["actor"], actor)
        self.assertEqual(parsed["masks"], masks)


class BuffTrackerTest(unittest.TestCase):
    def test_combines_magic_shield_bits_and_uses_observed_duration(self):
        tracker = BuffTracker(names={}, custom_durations={})
        masks = [0, 0, 0, 0xC00] + [0] * 8

        tracker.update(2873, masks, 100.0)
        snapshot = tracker.snapshot(110.0)

        self.assertEqual(len(snapshot["active"]), 1)
        shield = snapshot["active"][0]
        self.assertEqual(shield["key"], "magic_shield")
        self.assertEqual(shield["name"], "魔法护盾")
        self.assertEqual(shield["timing"], "estimated_observed")
        self.assertEqual(shield["skill_id"], 3114)
        self.assertAlmostEqual(shield["remaining"], 890.04, places=2)

    def test_identical_later_packet_refreshes_countdown(self):
        tracker = BuffTracker(names={}, custom_durations={})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)

        events = tracker.update(
            2873,
            masks,
            200.0,
            skill={"skill_id": 3114, "name": "魔法护盾"},
        )
        shield = tracker.snapshot(210.0)["active"][0]

        self.assertEqual(events[0]["event"], "refreshed")
        self.assertEqual(shield["refreshes"], 1)
        self.assertAlmostEqual(shield["remaining"], 890.04, places=2)

    def test_identical_status_packet_does_not_refresh_without_matching_skill(self):
        tracker = BuffTracker(names={}, custom_durations={})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)

        events = tracker.update(2873, masks, 200.0)
        shield = tracker.snapshot(210.0)["active"][0]

        self.assertEqual(events, [])
        self.assertEqual(shield["refreshes"], 0)
        self.assertAlmostEqual(shield["remaining"], 790.04, places=2)

    def test_unverified_high_status_uses_neutral_name(self):
        names = {
            "7:0x00000040": {
                "name": "三转波动伤害固定",
                "category": "positive",
            }
        }
        tracker = BuffTracker(names=names, custom_durations={})
        masks = [0] * 12
        masks[7] = 0x40

        tracker.update(2873, masks, 10.0)
        item = tracker.snapshot(11.0)["active"][0]

        self.assertEqual(item["name"], "未确认状态 8-7")
        self.assertEqual(item["source_name"], "三转波动伤害固定")
        self.assertEqual(item["confidence"], "unverified")

    def test_new_status_learns_recent_skill_name_and_identifier(self):
        names = {
            "8:0x00800000": {
                "name": "不知道10",
                "category": "positive",
            }
        }
        tracker = BuffTracker(names=names, custom_durations={})
        masks = [0] * 12
        masks[8] = 0x00800000

        events = tracker.update(
            2873,
            masks,
            10.0,
            skill={"skill_id": 9876, "name": "测试增益"},
        )
        item = tracker.snapshot(11.0)["active"][0]

        self.assertEqual(events[0]["name"], "测试增益")
        self.assertEqual(item["skill_id"], 9876)
        self.assertEqual(item["source_name"], "不知道10")
        self.assertEqual(item["confidence"], "observed_skill")

    def test_clear_packet_removes_active_buff_and_records_duration(self):
        tracker = BuffTracker(names={}, custom_durations={})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)

        events = tracker.update(2873, [0] * 12, 1000.0)

        self.assertEqual(tracker.snapshot(1000.0)["active"], [])
        self.assertEqual(events[0]["event"], "lost")
        self.assertEqual(events[0]["observed_duration"], 900.0)

    def test_unknown_status_learns_duration_for_next_application(self):
        names = {"2:0x00000002": {"name": "测试状态", "category": "positive"}}
        # Isolate from repo data/custom_buffs.json (now discovered via eco_paths).
        tracker = BuffTracker(names=names, custom_durations={})
        active = [0, 0, 2] + [0] * 9
        tracker.update(2873, active, 10.0)
        tracker.update(2873, [0] * 12, 40.0)

        tracker.update(2873, active, 50.0)
        item = tracker.snapshot(55.0)["active"][0]

        self.assertEqual(item["timing"], "estimated_learned")
        self.assertEqual(item["remaining"], 25.0)

    def test_custom_duration_overrides_learned_and_metadata(self):
        custom = {"2:0x00000002": 45.0}
        names = {"2:0x00000002": {"name": "测试状态", "category": "positive", "duration": 30.0}}
        tracker = BuffTracker(names=names, custom_durations=custom)
        active = [0, 0, 2] + [0] * 9
        tracker.update(2873, active, 10.0)
        item = tracker.snapshot(20.0)["active"][0]

        self.assertEqual(item["duration"], 45.0)
        self.assertEqual(item["remaining"], 35.0)
        self.assertEqual(item["timing"], "custom")

    def test_custom_duration_overrides_composite_magic_shield(self):
        tracker = BuffTracker(names={}, custom_durations={"magic_shield": 120.0})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)
        shield = tracker.snapshot(110.0)["active"][0]

        self.assertEqual(shield["key"], "magic_shield")
        self.assertEqual(shield["duration"], 120.0)
        self.assertAlmostEqual(shield["remaining"], 110.0, places=2)
        self.assertEqual(shield["timing"], "custom")


class DamageMeterBuffScopeTest(unittest.TestCase):
    def test_only_tracks_selected_self_actor(self):
        meter = DamageMeter(self_id=100, game_chat=False)
        self.addCleanup(meter.close)
        active = [0, 0, 0, 0xC00] + [0] * 8

        meter.handle_parsed({"type": "actor_buff", "actor": 200, "masks": active}, 1.0)
        self.assertEqual(meter.buff_tracker.snapshot(1.0)["active"], [])

        meter.handle_parsed({"type": "actor_buff", "actor": 100, "masks": active}, 2.0)
        self.assertEqual(meter.buff_tracker.snapshot(2.0)["active"][0]["key"], "magic_shield")

    def test_links_new_self_status_to_recent_self_cast(self):
        meter = DamageMeter(self_id=100, game_chat=False)
        self.addCleanup(meter.close)
        meter.skill_names[9876] = "测试增益"
        active = [0] * 12
        active[8] = 0x00800000

        meter.handle_parsed(
            {"type": "skill_cast_request", "target": 100, "skill_id": 9876},
            1.0,
        )
        meter.handle_parsed(
            {"type": "actor_buff", "actor": 100, "masks": active},
            2.0,
        )
        item = meter.buff_tracker.snapshot(2.0)["active"][0]

        self.assertEqual(item["name"], "测试增益")
        self.assertEqual(item["skill_id"], 9876)


if __name__ == "__main__":
    unittest.main()
