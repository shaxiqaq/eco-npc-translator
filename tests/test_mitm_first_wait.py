# -*- coding: utf-8 -*-
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MITM_JS = os.path.join(ROOT, "src", "_mitm.js")


class MitmFirstWaitTests(unittest.TestCase):
    def test_hook_has_first_wait_placeholder(self):
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read()
        self.assertIn("__FIRST_WAIT_MS__", src)
        self.assertIn("sync:true", src)
        self.assertIn("sync:false", src)

    def test_placeholder_becomes_number(self):
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read().replace("__FIRST_WAIT_MS__", "1500")
        self.assertIn("const firstWaitMs=1500;", src)
        self.assertNotIn("__FIRST_WAIT_MS__", src)

    def test_sync_not_gated_on_first_wait(self):
        """Cache-hit same-frame Chinese must work even when first_wait=0."""
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read()
        # Old bug: allowSync required firstWaitMs>0, so cloud hits still showed English first.
        self.assertNotIn("firstWaitMs>0&&dialogueCount", src)
        self.assertIn(
            "const allowSync=dialogueCount>0&&dialogueCount<=2&&!processFrame._waiting&&!waitedThisFrame;",
            src,
        )

    def test_cache_recv_reregisters_first(self):
        """Lost Frida cache posts left JS CACHE empty → repeat dialogue stayed English."""
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read()
        # onCache must recv() before processing so concurrent posts are not dropped.
        self.assertIn("function onCache(msg){", src)
        idx = src.index("function onCache(msg){")
        body = src[idx:idx + 450]
        self.assertLess(body.index("recv('cache',onCache)"), body.index("fromHex"))
        # Sync need must not be gated by PENDING debounce.
        self.assertIn("send({t:'need',h:h,op:op,sub:hexsub,sync:true});", src)

    def test_first_wait_recv_uses_callback(self):
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read()
        self.assertNotIn("recv('t'+h).wait()", src)
        self.assertIn("recv('t'+h, function(value){ reply=value; }).wait()", src)
        self.assertIn("reply.sub", src)

    def test_looks_like_sub_checks_structure(self):
        with open(MITM_JS, encoding="utf-8") as f:
            src = f.read()
        self.assertIn("function looksLike1017(sub)", src)
        self.assertIn("function looksLike1526(sub)", src)
        self.assertIn("function waitUntilIdle(maxMs)", src)
        self.assertIn("pause()", src)
        self.assertIn("resume()", src)
        self.assertIn("markDialogue()", src)
        self.assertIn("cached.length<=subs[i].length", src)


if __name__ == "__main__":
    unittest.main()
