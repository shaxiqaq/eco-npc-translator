# -*- coding: utf-8 -*-
import unittest

from eco_display_names import format_skill_display, is_garbage_name, looks_japanese


class DisplayNamesTests(unittest.TestCase):
    def test_garbage(self):
        self.assertTrue(is_garbage_name("a\x02b"))
        self.assertFalse(is_garbage_name("パリイ"))

    def test_format_modes(self):
        tables = {
            "zh": {2100: "パリイ", 4026: "击援手"},
            "ja": {2100: "パリイ", 4026: "アタックアシスト"},
        }
        self.assertEqual(format_skill_display(4026, tables, mode="client"), "击援手")
        self.assertEqual(format_skill_display(4026, tables, mode="ja"), "アタックアシスト")
        self.assertIn("/", format_skill_display(4026, tables, mode="dual"))
        self.assertTrue(looks_japanese("パリイ"))


if __name__ == "__main__":
    unittest.main()
