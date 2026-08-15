# -*- coding: utf-8 -*-
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_npc_mitm import looks_like_dialogue_sub, rebuild_1017, rebuild_1526  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
