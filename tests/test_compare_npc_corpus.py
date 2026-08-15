# -*- coding: utf-8 -*-
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "compare_npc_corpus", ROOT / "scripts" / "compare_npc_corpus.py"
)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(compare)


def corpus(event_id="1", text="Hello world"):
    return {
        "files": [{
            "file": "TownMap/Test.cs",
            "npc": "Tester",
            "event_ids": [event_id],
            "says": [{"line": 10, "text": text}],
            "selects": [],
        }]
    }


class NormalizeTest(unittest.TestCase):
    def test_wraps_nul_width_and_quotes_are_normalized(self):
        self.assertEqual(
            compare.normalize_text("Hello\n  WORLD\0 ’x’"),
            "hello world 'x'",
        )


class ComparisonTest(unittest.TestCase):
    def test_same_event_exact(self):
        result = compare.compare_data(
            corpus(), {"1": {"npc": "Tester", "says": ["Hello\nworld"], "selects": []}}, []
        )
        self.assertEqual(result["harvest_matches"][0]["status"], "event_exact")

    def test_global_exact_when_event_differs(self):
        result = compare.compare_data(
            corpus(), {"2": {"npc": "Tester", "says": ["Hello world"], "selects": []}}, []
        )
        self.assertEqual(result["harvest_matches"][0]["status"], "global_exact")

    def test_near_match(self):
        result = compare.compare_data(
            corpus(text="Welcome to the Arena!"),
            {"1": {"npc": "Tester", "says": ["Welcome to Arena!"], "selects": []}},
            [],
            near_threshold=0.80,
        )
        self.assertEqual(result["harvest_matches"][0]["status"], "event_near")

    def test_missing_event_and_unmatched_text(self):
        result = compare.compare_data(
            corpus(), {"9": {"npc": "New", "says": ["Completely new dialogue"], "selects": []}}, []
        )
        self.assertEqual(result["harvest_matches"][0]["status"], "script_event_missing")
        self.assertEqual(result["summary"]["missing_from_script_event_ids"], 1)

    def test_existing_event_without_static_text(self):
        empty = corpus()
        empty["files"][0]["says"] = []
        result = compare.compare_data(
            empty, {"1": {"npc": "New", "says": ["Server-only text"], "selects": []}}, []
        )
        self.assertEqual(result["harvest_matches"][0]["status"], "script_event_no_text")
        self.assertEqual(result["summary"]["overlapping_event_ids_without_text"], 1)

    def test_seen_text_deduplicates_after_normalization(self):
        result = compare.compare_data(corpus(), {}, ["Hello world", "Hello\nworld\0"])
        self.assertEqual(result["summary"]["seen_unique_texts"], 1)
        self.assertEqual(result["summary"]["seen_statuses"]["exact"], 1)


if __name__ == "__main__":
    unittest.main()
