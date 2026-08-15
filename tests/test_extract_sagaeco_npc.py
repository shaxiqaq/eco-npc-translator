# -*- coding: utf-8 -*-
import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "extract_sagaeco_npc", ROOT / "scripts" / "extract_sagaeco_npc.py"
)
extractor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(extractor)


class CSharpCallParsingTest(unittest.TestCase):
    def test_comments_do_not_create_calls(self):
        source = '// Say(pc, 131, "wrong");\nSay(pc, 131, "right");'
        calls = extractor.find_calls(source, "Say")
        self.assertEqual(len(calls), 1)
        self.assertEqual(extractor.extract_literals(calls[0][1][2])[0], "right")

    def test_string_escapes_and_verbatim_strings(self):
        value, dynamic = extractor.extract_literals(r'"a\n" + @"b""c"')
        self.assertEqual(value, 'a\nb"c')
        self.assertFalse(dynamic)

    def test_say_speaker_is_not_appended_to_dialogue(self):
        call = 'Say(pc, 11000405, 131, "Welcome$R;", "Master")'
        args = extractor.find_calls(call, "Say")[0][1]
        say = extractor.parse_say(1, args)
        self.assertEqual(say["raw"], "Welcome$R;")
        self.assertEqual(say["text"], "Welcome")
        self.assertEqual(say["speaker"], "Master")
        self.assertEqual(say["actor"], "11000405")

    def test_short_say_overload(self):
        args = extractor.find_calls('Say(pc, 131, "Hello")', "Say")[0][1]
        say = extractor.parse_say(3, args)
        self.assertIsNone(say["actor"])
        self.assertEqual(say["motion"], "131")
        self.assertEqual(say["text"], "Hello")

    def test_dynamic_say_expression_is_retained(self):
        args = extractor.find_calls('Say(pc, 131, "Hello " + pc.Name)', "Say")[0][1]
        say = extractor.parse_say(3, args)
        self.assertEqual(say["text"], "Hello")
        self.assertTrue(say["dynamic"])
        self.assertEqual(say["text_expression"], '"Hello " + pc.Name')

    def test_select_skips_empty_placeholder(self):
        args = extractor.find_calls(
            'Select(pc, "Question", "", "One", "Two")', "Select"
        )[0][1]
        select = extractor.parse_select(5, args)
        self.assertEqual(select["title"], "Question")
        self.assertEqual(select["options"], ["One", "Two"])


class FileParsingTest(unittest.TestCase):
    def test_file_metadata_and_multiple_event_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "TownMap" / "Area(10023000)" / "Npc(11000001).cs"
            path.parent.mkdir(parents=True)
            path.write_text(
                """namespace SagaScript.M10023000 {
                class S11000001 { S11000001(){ EventID = 11000001; }
                void A(){ Say(pc, 131, \"Hello\"); } }
                class S11000002 { S11000002(){ EventID = 11000002; } }
                }""",
                encoding="utf-8",
            )
            record = extractor.parse_file(path, root)
        self.assertEqual(record["primary_event_id"], "11000001")
        self.assertEqual(record["event_ids"], ["11000001", "11000002"])
        self.assertEqual(record["primary_map_id"], "10023000")
        self.assertEqual(record["npc"], "Npc")
        self.assertEqual(record["all_text"], ["Hello"])

    def test_unresolved_dynamic_call_is_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "Npc(11000001).cs"
            path.write_text(
                "class S11000001 { void A(){ Say(pc, 131, value.ToString()); } }",
                encoding="utf-8",
            )
            record = extractor.parse_file(path, root)
        self.assertEqual(record["says"], [])
        self.assertEqual(record["unresolved_calls"][0]["kind"], "Say")


if __name__ == "__main__":
    unittest.main()
