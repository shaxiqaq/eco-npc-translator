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
        tracker = BuffTracker(names={})
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
        tracker = BuffTracker(names={})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)

        events = tracker.update(2873, masks, 200.0)
        shield = tracker.snapshot(210.0)["active"][0]

        self.assertEqual(events[0]["event"], "refreshed")
        self.assertEqual(shield["refreshes"], 1)
        self.assertAlmostEqual(shield["remaining"], 890.04, places=2)

    def test_clear_packet_removes_active_buff_and_records_duration(self):
        tracker = BuffTracker(names={})
        masks = [0, 0, 0, 0xC00] + [0] * 8
        tracker.update(2873, masks, 100.0)

        events = tracker.update(2873, [0] * 12, 1000.0)

        self.assertEqual(tracker.snapshot(1000.0)["active"], [])
        self.assertEqual(events[0]["event"], "lost")
        self.assertEqual(events[0]["observed_duration"], 900.0)

    def test_unknown_status_learns_duration_for_next_application(self):
        names = {"2:0x00000002": {"name": "测试状态", "category": "positive"}}
        tracker = BuffTracker(names=names)
        active = [0, 0, 2] + [0] * 9
        tracker.update(2873, active, 10.0)
        tracker.update(2873, [0] * 12, 40.0)

        tracker.update(2873, active, 50.0)
        item = tracker.snapshot(55.0)["active"][0]

        self.assertEqual(item["timing"], "estimated_learned")
        self.assertEqual(item["remaining"], 25.0)


class DamageMeterBuffScopeTest(unittest.TestCase):
    def test_only_tracks_selected_self_actor(self):
        meter = DamageMeter(self_id=100, game_chat=False)
        self.addCleanup(meter.close)
        active = [0, 0, 0, 0xC00] + [0] * 8

        meter.handle_parsed({"type": "actor_buff", "actor": 200, "masks": active}, 1.0)
        self.assertEqual(meter.buff_tracker.snapshot(1.0)["active"], [])

        meter.handle_parsed({"type": "actor_buff", "actor": 100, "masks": active}, 2.0)
        self.assertEqual(meter.buff_tracker.snapshot(2.0)["active"][0]["key"], "magic_shield")


if __name__ == "__main__":
    unittest.main()
