# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import cache_sync  # noqa: E402


class EnqueueNormalizeTest(unittest.TestCase):
    def test_nul_suffix_key_is_uploaded_after_normalize(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = {
                "enabled": True,
                "url": "http://127.0.0.1:9",
                "token": "test-token",
                "pull_on_start": False,
            }
            with open(os.path.join(tmp, "sync_config.json"), "w", encoding="utf-8") as stream:
                json.dump(cfg, stream)
            sync = cache_sync.Sync(tmp, "zh-CN", "deepseek-v4-flash", lambda d, src="en": 0)
            self.assertTrue(sync.enabled)
            sync.enqueue("Do you want to exchange? \x00", "要交换吗？")
            with sync.qlock:
                self.assertEqual(len(sync.q), 1)
                bucket, key, value = sync.q[0]
                self.assertEqual(bucket, "zh-CN")
                self.assertEqual(key, "Do you want to exchange?")
                self.assertEqual(value, "要交换吗？")
                self.assertNotIn("\x00", key)

    def test_enqueue_templates_raw_player_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = {
                "enabled": True,
                "url": "http://127.0.0.1:9",
                "token": "test-token",
                "pull_on_start": False,
            }
            with open(os.path.join(tmp, "sync_config.json"), "w", encoding="utf-8") as stream:
                json.dump(cfg, stream)
            with open(os.path.join(tmp, "translate_config.json"), "w", encoding="utf-8") as stream:
                json.dump(
                    {
                        "provider": "deepseek",
                        "model": "deepseek-v4-flash",
                        "api_key": "x",
                        "player_names": ["shaxi"],
                    },
                    stream,
                )
            sync = cache_sync.Sync(tmp, "zh-CN", "deepseek-v4-flash", lambda d, src="en": 0)
            sync.enqueue(
                "Welcome back, Hokuto0. \nAdventuring is great!",
                "欢迎回来，Hokuto0。\n冒险真棒！",
            )
            with sync.qlock:
                self.assertEqual(len(sync.q), 1)
                _bucket, key, value = sync.q[0]
                self.assertIn("{PC}", key)
                self.assertIn("{PC}", value)
                self.assertNotIn("Hokuto0", key)
                self.assertNotIn("Hokuto0", value)


if __name__ == "__main__":
    unittest.main()
