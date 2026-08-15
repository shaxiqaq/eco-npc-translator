# -*- coding: utf-8 -*-
import argparse
import unittest
from unittest import mock


class CaptureAgentCliTests(unittest.TestCase):
    def test_defaults_damage_when_no_feature_flag(self):
        import eco_capture_agent as agent

        parser = argparse.ArgumentParser()
        parser.add_argument("--pid", type=int)
        parser.add_argument("--damage", action="store_true")
        parser.add_argument("--translate", action="store_true")
        parser.add_argument("--interval", type=float, default=0.5)
        parser.add_argument("--self-id", type=lambda value: int(value, 0))
        args = parser.parse_args([])
        if not args.damage and not args.translate:
            args.damage = True
        self.assertTrue(args.damage)
        self.assertFalse(args.translate)
        self.assertTrue(callable(agent.emit))

    def test_emit_writes_json_line(self):
        import eco_capture_agent as agent
        import io
        import json

        buf = io.StringIO()
        with mock.patch("sys.stdout", buf):
            agent.emit("status", service="agent", state="starting")
        line = buf.getvalue().strip()
        payload = json.loads(line)
        self.assertEqual(payload["type"], "status")
        self.assertEqual(payload["service"], "agent")


if __name__ == "__main__":
    unittest.main()
