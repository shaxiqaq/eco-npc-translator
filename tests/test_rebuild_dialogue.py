# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_npc_mitm import (  # noqa: E402
    looks_like_dialogue_sub,
    rebuild_1017,
    rebuild_1526,
    split_eco_markup,
)


def pack_1017(segments, npc=b"\x00\x00\x00\x01", flag=b"\x00\x00", tail=b"\x00\x00\x00"):
    body = bytearray([len(segments) & 0xff])
    for seg in segments:
        raw = seg if isinstance(seg, (bytes, bytearray)) else str(seg).encode("utf-8")
        body.append(len(raw) & 0xff)
        body += raw
    return bytes([0x03, 0xF9]) + npc + flag + bytes(body) + tail


def pack_1526(question, options, tail=b"\x01"):
    q = question.encode("utf-8") if isinstance(question, str) else question
    out = bytearray([0x05, 0xF6])
    out.append((len(q) + 1) & 0xff)
    out += q
    out.append(0)
    out.append(len(options) & 0xff)
    out += bytes(range(len(options) + 1))
    for opt in options:
        raw = opt.encode("utf-8") if isinstance(opt, str) else opt
        out.append(len(raw) & 0xff)
        out += raw
    out += tail
    return bytes(out)


class LooksLikeDialogueSubTests(unittest.TestCase):
    def test_valid_1017(self):
        sub = pack_1017([b"Hello"])
        self.assertTrue(looks_like_dialogue_sub(sub, 1017))

    def test_empty_1017_rejected(self):
        sub = pack_1017([b""])
        self.assertFalse(looks_like_dialogue_sub(sub, 1017))
        self.assertIsNone(rebuild_1017(sub))

    def test_zero_seg_1017_rejected(self):
        sub = pack_1017([])
        self.assertFalse(looks_like_dialogue_sub(sub, 1017))
        self.assertIsNone(rebuild_1017(sub))

    def test_opcode_only_blob_rejected(self):
        sub = bytes([0x03, 0xF9]) + bytes(783)
        self.assertFalse(looks_like_dialogue_sub(sub, 1017))

    def test_valid_1526(self):
        sub = pack_1526("What now?", ["Yes", "No"])
        self.assertTrue(looks_like_dialogue_sub(sub, 1526))

    def test_empty_1526_rejected(self):
        sub = pack_1526("", [])
        self.assertFalse(looks_like_dialogue_sub(sub, 1526))
        self.assertIsNone(rebuild_1526(sub))

    def test_empty_question_with_option_kept(self):
        sub = pack_1526("", ["Let's visit the Guild Merchant!"])
        self.assertTrue(looks_like_dialogue_sub(sub, 1526))

    def test_wrong_expect_op(self):
        sub = pack_1017([b"Hello"])
        self.assertFalse(looks_like_dialogue_sub(sub, 1526))


class EcoMarkupTests(unittest.TestCase):
    def test_one_point_wrapper(self):
        prefix, body, suffix = split_eco_markup(
            "HUsing Event Navigation, Primula will show you the way.D"
        )
        self.assertEqual(prefix, "H")
        self.assertEqual(suffix, "D")
        self.assertTrue(body.startswith("Using Event Navigation"))

    def test_hello_is_not_markup(self):
        prefix, body, suffix = split_eco_markup("Hello there")
        self.assertEqual(prefix, "")
        self.assertEqual(suffix, "")
        self.assertEqual(body, "Hello there")

    def test_ht_and_hd_prefixes(self):
        self.assertEqual(split_eco_markup("HTGo to the plains")[0], "HT")
        self.assertEqual(split_eco_markup("HDBy obtaining the clothes")[0], "HD")


class RebuildSizeGuardTests(unittest.TestCase):
    def test_1017_keeps_seg_count_and_length(self):
        long_en = (
            "HUsing Event Navigation, Primula will show you the direction "
            "to the event. Event Navigation can be found in the Quest Navi "
            "Info menu. Select First Time Job and click Navi Start. "
            "Primula will only appear if Event Navi is activated.D"
        )
        mid = len(long_en) // 2
        sub = pack_1017([long_en[:mid], long_en[mid:]])
        zh = "使用活动导航，普莉姆拉会为你指引方向。请打开任务导航并点开始。"
        with mock.patch("eco_npc_mitm.translate", return_value=zh):
            built = rebuild_1017(sub)
        self.assertIsNotNone(built)
        self.assertLessEqual(len(built), len(sub))
        self.assertLessEqual(built[8], sub[8])
        self.assertTrue(looks_like_dialogue_sub(built, 1017))
        self.assertTrue(built[9:].startswith(b"H") or b"H" in built)

    def test_1017_restores_one_point_codes(self):
        sub = pack_1017([b"HPlease open the menu.D"])
        with mock.patch("eco_npc_mitm.translate", return_value="请打开菜单。"):
            built = rebuild_1017(sub)
        text = built[10:10 + built[9]].decode("utf-8", "replace")
        self.assertTrue(text.startswith("H"))
        self.assertTrue(text.endswith("D"))

    def test_1526_fits_when_cached_option_is_too_long(self):
        """Steering Wheel: short EN 'Nothing' mapped to a long wrong ZH used to hard-fail."""
        sub = pack_1526(
            "What do you want to do?",
            ["Descend to the city", "Nothing"],
        )
        zh_map = {
            "What do you want to do?": "你想做什么？",
            "Descend to the city": "下到城市",
            # Wrong context contamination (was stuck English forever with hard size guard).
            "Nothing": "没什么特别要问的",
        }

        def fake_batch(texts, cache_only=False, kind="select"):
            return [zh_map.get(t, t) for t in texts]

        with mock.patch("eco_npc_mitm.translate_batch", side_effect=fake_batch):
            built = rebuild_1526(sub)
        self.assertIsNotNone(built)
        self.assertLessEqual(len(built), len(sub))
        self.assertTrue(looks_like_dialogue_sub(built, 1526))
        # Question should still be Chinese; long option may be clipped but present.
        qlen = built[2]
        q = built[3:3 + qlen].split(b"\0")[0].decode("utf-8", "replace")
        self.assertIn("想", q)


if __name__ == "__main__":
    unittest.main()
