# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from eco_damage_capture import parse_packet
from eco_exp_tracker import (
    ExpTracker,
    estimate_absolute_gain,
    load_exp_table,
    pct_x10_delta,
    span_for_level,
)


class PctDeltaTest(unittest.TestCase):
    def test_same_level_increase(self):
        self.assertEqual(pct_x10_delta(10, 100, 10, 250), 150)

    def test_same_level_no_decrease(self):
        self.assertEqual(pct_x10_delta(10, 250, 10, 100), 0)

    def test_level_up(self):
        # 90% → lv+1 at 5%  => 10% + 5% = 150 x10 units
        self.assertEqual(pct_x10_delta(10, 900, 11, 50), 150)

    def test_multi_level_up(self):
        # finish 10% + full level + 20% = 100+1000+200 = 1300
        self.assertEqual(pct_x10_delta(10, 900, 12, 200), 1300)


class ExpTableTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = os.path.join(os.path.dirname(__file__), "..", "data", "exp_table.json")
        cls.table = load_exp_table(root)

    def test_table_loaded(self):
        self.assertTrue(self.table.get("levels"))
        self.assertIn("2", self.table["levels"])

    def test_span_lv1(self):
        # lv1→2 base exp = 55
        self.assertEqual(span_for_level(self.table, 1, "c"), 55)

    def test_estimate_partial(self):
        # 10% of lv1 span (55) ≈ 6
        got = estimate_absolute_gain(self.table, 1, 0, 1, 100, "c")
        self.assertEqual(got, 6)


class ExpTrackerSessionTest(unittest.TestCase):
    def setUp(self):
        root = os.path.join(os.path.dirname(__file__), "..", "data", "exp_table.json")
        self.tracker = ExpTracker(table=load_exp_table(root), idle_gap_s=120)

    def test_baseline_then_gain(self):
        self.tracker.apply_level(level=10, job_level=5, ts=1000.0)
        self.assertIsNone(
            self.tracker.apply_exp(cexp_pct_x10=200, jexp_pct_x10=100, ts=1000.0)
        )
        event = self.tracker.apply_exp(cexp_pct_x10=350, jexp_pct_x10=150, ts=1060.0)
        self.assertIsNotNone(event)
        self.assertEqual(event["cexp_pct_x10"], 150)
        self.assertEqual(event["jexp_pct_x10"], 50)
        snap = self.tracker.snapshot(now=1060.0)
        self.assertAlmostEqual(snap["session_cexp_pct"], 15.0)
        self.assertAlmostEqual(snap["session_jexp_pct"], 5.0)
        self.assertTrue(snap["ready"])
        self.assertGreater(snap["session_cexp_abs"], 0)

    def test_absolute_delta_preferred(self):
        self.tracker.apply_exp(cexp_pct_x10=100, cexp_abs=1000, ts=1.0)
        event = self.tracker.apply_exp(cexp_pct_x10=100, cexp_abs=1250, ts=2.0)
        self.assertEqual(event["cexp_abs"], 250)
        self.assertFalse(self.tracker.session_cexp_abs_estimated)

    def test_reset_keeps_baseline(self):
        self.tracker.apply_level(level=20, ts=1.0)
        self.tracker.apply_exp(cexp_pct_x10=400, jexp_pct_x10=200, ts=1.0)
        self.tracker.apply_exp(cexp_pct_x10=500, jexp_pct_x10=250, ts=10.0)
        self.assertGreater(self.tracker.session_cexp_pct_x10, 0)
        self.tracker.reset(keep_baseline=True)
        self.assertEqual(self.tracker.level, 20)
        self.assertEqual(self.tracker.cexp_pct_x10, 500)
        self.assertEqual(self.tracker.session_cexp_pct_x10, 0)

    def test_rate_window(self):
        t0 = 1_000_000.0
        self.tracker.apply_exp(cexp_pct_x10=0, jexp_pct_x10=0, ts=t0)
        self.tracker.apply_exp(cexp_pct_x10=100, jexp_pct_x10=0, ts=t0 + 3600)
        snap = self.tracker.snapshot(now=t0 + 3600)
        # ~10% per hour over the hour window
        self.assertAlmostEqual(snap["windows"]["1h"]["cexp_pct_per_hour"], 10.0, delta=0.5)


class ParseExpPacketsTest(unittest.TestCase):
    def test_parse_player_exp(self):
        # op u16 + cexp u32 + jexp u32
        sub = bytearray()
        sub += (565).to_bytes(2, "big")
        sub += (345).to_bytes(4, "big")  # 34.5%
        sub += (120).to_bytes(4, "big")  # 12.0%
        parsed = parse_packet("S2C", 565, bytes(sub))
        self.assertEqual(parsed["type"], "player_exp")
        self.assertEqual(parsed["cexp_pct_x10"], 345)
        self.assertEqual(parsed["jexp_pct_x10"], 120)
        self.assertIsNone(parsed["cexp_abs"])

    def test_parse_player_exp_with_abs(self):
        sub = bytearray(34)
        sub[0:2] = (565).to_bytes(2, "big")
        sub[2:6] = (100).to_bytes(4, "big")
        sub[6:10] = (50).to_bytes(4, "big")
        sub[18:26] = (12_345).to_bytes(8, "big", signed=True)
        sub[26:34] = (6_789).to_bytes(8, "big", signed=True)
        parsed = parse_packet("S2C", 565, bytes(sub))
        self.assertEqual(parsed["cexp_abs"], 12345)
        self.assertEqual(parsed["jexp_abs"], 6789)

    def test_parse_player_level(self):
        sub = bytes([0x02, 0x3A, 45, 30, 1, 1, 0])
        parsed = parse_packet("S2C", 570, sub)
        self.assertEqual(parsed["type"], "player_level")
        self.assertEqual(parsed["level"], 45)
        self.assertEqual(parsed["job_level"], 30)


if __name__ == "__main__":
    unittest.main()
