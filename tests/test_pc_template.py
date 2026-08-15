# -*- coding: utf-8 -*-
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_pc_template import (  # noqa: E402
    PC_TOKEN,
    normalize_cache_dict,
    normalize_shared_pair,
    templatize,
    untemplatize,
)


class TemplatizeTest(unittest.TestCase):
    def test_known_name_to_pc(self):
        text, hit = templatize("Welcome back, shaxi. Adventuring is great.", ["shaxi"])
        self.assertEqual(hit, "shaxi")
        self.assertIn(PC_TOKEN, text)
        self.assertNotIn("shaxi", text)
        self.assertEqual(
            untemplatize(text, hit),
            "Welcome back, shaxi. Adventuring is great.",
        )

    def test_name_word_boundary(self):
        text, hit = templatize("It seems you are shaxiqaq.", ["shaxi"])
        self.assertIsNone(hit)
        self.assertIn("shaxiqaq", text)

    def test_empty_names_passthrough(self):
        text, hit = templatize("Welcome back, Hokuto0.", [])
        self.assertIsNone(hit)
        self.assertEqual(text, "Welcome back, Hokuto0.")


class NormalizeSharedPairTest(unittest.TestCase):
    def test_foreign_name_in_both_sides(self):
        k, v = normalize_shared_pair(
            "Welcome back, Hokuto0. \nAdventuring is great, but be \nsure to come to school once \nin a while♪",
            "欢迎回来，Hokuto0。\n冒险固然精彩，不过\n也要记得偶尔来学校\n看看哦♪",
            known_names=["shaxi"],
        )
        self.assertIn(PC_TOKEN, k)
        self.assertIn(PC_TOKEN, v)
        self.assertNotIn("Hokuto0", k)
        self.assertNotIn("Hokuto0", v)

    def test_local_name_and_foreign_name(self):
        k, v = normalize_shared_pair(
            "shaxi, Dark Feather, welcome \nback. Please use this ♪",
            "shaxi、Dark Feather，欢迎回来。请用这个♪",
            known_names=["shaxi"],
        )
        self.assertIn(PC_TOKEN, k)
        self.assertNotIn("shaxi", k)
        # Dark Feather is denylisted as NPC-ish; may remain. Hokuto-style digit names go.
        self.assertIn("Dark Feather", k)

    def test_npc_name_not_replaced(self):
        k, v = normalize_shared_pair(
            "Oh, by the way. Angel is waiting.",
            "哦，对了。Angel 在等你。",
            known_names=[],
        )
        self.assertIn("Angel", k)
        self.assertIn("Angel", v)

    def test_mini_npc_not_replaced(self):
        k, v = normalize_shared_pair(
            "Mini, Mini! The quest is complete!",
            "Mini，Mini！任务完成了！",
            known_names=[],
        )
        self.assertIn("Mini", k)
        self.assertNotIn(PC_TOKEN, k)

    def test_item_tag_not_eaten(self):
        k, v = normalize_shared_pair(
            "Just like [Salamander]!",
            "就像 [Salamander] 一样！",
            known_names=[],
        )
        self.assertIn("[Salamander]", k)

    def test_already_templated(self):
        k, v = normalize_shared_pair(
            "Welcome back, {PC}. How was it?",
            "欢迎回来，{PC}。感觉如何？",
            known_names=["shaxi"],
        )
        self.assertEqual(k, "Welcome back, {PC}. How was it?")
        self.assertEqual(v, "欢迎回来，{PC}。感觉如何？")

    def test_normalize_cache_dict_rewrites_keys(self):
        cache = {
            "Welcome back, Hokuto0. Hello.": "欢迎回来，Hokuto0。你好。",
            "Welcome back, {PC}. Hello.": "欢迎回来，{PC}。你好。",
        }
        rebuilt, changed = normalize_cache_dict(cache, known_names=["shaxi"])
        self.assertGreaterEqual(changed, 1)
        self.assertIn("Welcome back, {PC}. Hello.", rebuilt)
        self.assertNotIn("Hokuto0", next(iter(rebuilt.keys())))


if __name__ == "__main__":
    unittest.main()
