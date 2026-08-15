# -*- coding: utf-8 -*-
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MITM_JS = os.path.join(ROOT, "src", "_mitm.js")


class MitmFirstWaitTests(unittest.TestCase):
    def test_hook_has_first_wait_placeholder(self):
        src = open(MITM_JS, encoding="utf-8").read()
        self.assertIn("__FIRST_WAIT_MS__", src)
        self.assertIn("sync:allowSync", src)

    def test_placeholder_becomes_number(self):
        src = open(MITM_JS, encoding="utf-8").read().replace("__FIRST_WAIT_MS__", "1500")
        self.assertIn("const firstWaitMs=1500;", src)
        self.assertNotIn("__FIRST_WAIT_MS__", src)

    def test_first_wait_recv_uses_callback(self):
        src = open(MITM_JS, encoding="utf-8").read()
        self.assertNotIn("recv('t'+h).wait()", src)
        self.assertIn("recv('t'+h, function(value){ reply=value; }).wait()", src)
        self.assertIn("reply.sub", src)

    def test_looks_like_sub_checks_structure(self):
        src = open(MITM_JS, encoding="utf-8").read()
        self.assertIn("function looksLike1017(sub)", src)
        self.assertIn("function looksLike1526(sub)", src)
        self.assertIn("function waitUntilIdle(maxMs)", src)
        self.assertIn("pause()", src)
        self.assertIn("resume()", src)
        self.assertIn("markDialogue()", src)


if __name__ == "__main__":
    unittest.main()
