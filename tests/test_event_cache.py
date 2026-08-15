# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_event_cache import EventCache  # noqa: E402


class EventCacheTest(unittest.TestCase):
    def test_remember_and_lookup_same_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "npc_event_cache.json")
            cache = EventCache(path)
            cache.remember(18001641, "say", "en", "Hello there friend.", "你好，朋友。")
            cache.remember(18001641, "say", "id", "Halo kawan.", "你好，朋友。")
            self.assertEqual(
                cache.lookup(18001641, "en", "Hello there friend."),
                "你好，朋友。",
            )
            self.assertEqual(cache.lookup(18001641, "ja", "Hello there friend."), None)
            cache.flush()
            again = EventCache(path)
            self.assertEqual(
                again.lookup(18001641, "id", "Halo kawan."),
                "你好，朋友。",
            )


if __name__ == "__main__":
    unittest.main()
