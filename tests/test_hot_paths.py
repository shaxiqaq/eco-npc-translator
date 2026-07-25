import re
import time
import unittest

from eco_damage_categories import category_for_damage, SKILL, NORMAL, PET, TAKEN


# Mirror the precompiled cleaners used by eco_npc_mitm / harvester.
CLEAN_RE = re.compile(r"\$[A-Za-z]")
WS_RE = re.compile(r"[ \t]+")
NL_WS_RE = re.compile(r"\n[ \t]+")


def clean_text(t: str) -> str:
    t = t.replace("$R", "\n").replace("$P", "\n")
    t = CLEAN_RE.sub("", t)
    t = WS_RE.sub(" ", t)
    return NL_WS_RE.sub("\n", t).strip()


class HotPathCorrectnessTest(unittest.TestCase):
    def test_clean_text_strips_control_tokens(self):
        raw = "Hello$R  $Bworld$P  there"
        self.assertEqual(clean_text(raw), "Hello\nworld\nthere")

    def test_category_hot_path_mapping(self):
        self.assertEqual(category_for_damage("dealt", 3001), SKILL)
        self.assertEqual(category_for_damage("dealt", None), NORMAL)
        self.assertEqual(category_for_damage("pet_dealt", 1), PET)
        self.assertEqual(category_for_damage("taken", None), TAKEN)


class HotPathBenchmarkTest(unittest.TestCase):
    """Light microbenchmarks — assert they stay in a generous budget."""

    def test_clean_text_throughput(self):
        sample = "Welcome back, $P hero!$R Choose carefully $B$C option."
        # Warmup
        for _ in range(100):
            clean_text(sample)
        t0 = time.perf_counter()
        n = 20000
        for _ in range(n):
            clean_text(sample)
        elapsed = time.perf_counter() - t0
        # Very loose budget so CI / slow machines still pass.
        self.assertLess(elapsed, 1.5, f"clean_text too slow: {elapsed:.3f}s for {n} calls")

    def test_category_throughput(self):
        t0 = time.perf_counter()
        n = 100000
        for i in range(n):
            category_for_damage("dealt", 3001 if i % 2 else None)
        elapsed = time.perf_counter() - t0
        self.assertLess(elapsed, 1.0, f"category_for_damage too slow: {elapsed:.3f}s for {n} calls")


if __name__ == "__main__":
    unittest.main()
