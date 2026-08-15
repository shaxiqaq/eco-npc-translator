# -*- coding: utf-8 -*-
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_source_lang import (  # noqa: E402
    api_source_code,
    cache_storage_key,
    detect_source_lang,
    is_ambiguous_short,
    parse_storage_key,
    resolve_source_lang,
    source_from_bucket,
    sync_bucket,
)


class DetectSourceLangTest(unittest.TestCase):
    def test_english(self):
        self.assertEqual(
            detect_source_lang(
                "Oh, who are you? My name is Dark Feather and this is Willydoo."
            ),
            "en",
        )

    def test_japanese_kana(self):
        self.assertEqual(
            detect_source_lang("あなたは誰？　私はダークフェザーです。"),
            "ja",
        )

    def test_indonesian(self):
        self.assertEqual(
            detect_source_lang("Apakah kamu ingin melepas IRIS Card?"),
            "id",
        )
        self.assertEqual(
            detect_source_lang("Kamu mendapatkan 1 [Blade Hand]"),
            "id",
        )

    def test_chinese(self):
        self.assertEqual(detect_source_lang("你想交换吗？再跟我谈谈吧。"), "zh")

    def test_forced_mode(self):
        self.assertEqual(resolve_source_lang("Apakah kamu ingin", "en"), "en")
        self.assertEqual(resolve_source_lang("Hello there", "ja"), "ja")
        self.assertEqual(resolve_source_lang("Hello there", "auto"), "en")


class CacheAndSyncKeyTest(unittest.TestCase):
    def test_english_unprefixed(self):
        text = "Do you want to exchange?"
        self.assertEqual(cache_storage_key(text, "en"), text)
        self.assertEqual(parse_storage_key(text), ("en", text))

    def test_japanese_prefixed(self):
        text = "こんにちは"
        self.assertEqual(cache_storage_key(text, "ja"), "ja::" + text)
        self.assertEqual(parse_storage_key("ja::" + text), ("ja", text))

    def test_indonesian_prefixed(self):
        text = "Apakah kamu ingin melepas IRIS Card?"
        self.assertEqual(cache_storage_key(text, "id"), "id::" + text)

    def test_sync_buckets(self):
        self.assertEqual(sync_bucket("zh-CN", "en"), "zh-CN")
        self.assertEqual(sync_bucket("zh-CN", "ja"), "zh-CN-ja")
        self.assertEqual(sync_bucket("zh-CN", "id"), "zh-CN-id")
        self.assertEqual(source_from_bucket("zh-CN", "zh-CN"), "en")
        self.assertEqual(source_from_bucket("zh-CN-ja", "zh-CN"), "ja")
        self.assertEqual(source_from_bucket("zh-CN-id", "zh-CN"), "id")

    def test_api_source_code(self):
        self.assertEqual(api_source_code("ja"), "ja")
        self.assertEqual(api_source_code("und"), "auto")
        self.assertEqual(api_source_code("auto"), "auto")

    def test_short_options_ambiguous(self):
        self.assertTrue(is_ambiguous_short("Yes"))
        self.assertTrue(is_ambiguous_short("No"))
        self.assertTrue(is_ambiguous_short("OK"))
        self.assertTrue(is_ambiguous_short("Next"))
        self.assertFalse(
            is_ambiguous_short("Oh, who are you? My name is Dark Feather.")
        )


if __name__ == "__main__":
    unittest.main()
