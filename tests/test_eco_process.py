# -*- coding: utf-8 -*-
import unittest
from types import SimpleNamespace

from eco_process import is_eco_process_name, resolve_attach_pid


class EcoProcessTests(unittest.TestCase):
    def test_name_match(self):
        self.assertTrue(is_eco_process_name("eco.exe"))
        self.assertTrue(is_eco_process_name("ECO.EXE"))
        self.assertTrue(is_eco_process_name("eco"))
        self.assertFalse(is_eco_process_name("notepad.exe"))
        self.assertFalse(is_eco_process_name(""))

    def test_preferred_pid_even_if_not_named_eco(self):
        class Device:
            def enumerate_processes(self):
                return [
                    SimpleNamespace(pid=10, name="chrome.exe"),
                    SimpleNamespace(pid=8008, name="something.exe"),
                ]

        pid, how = resolve_attach_pid(Device(), preferred_pid=8008)
        self.assertEqual(pid, 8008)
        self.assertIn("pid", how)

    def test_preferred_pid_when_frida_list_empty_uses_live_pid(self):
        class Device:
            def enumerate_processes(self):
                return []

        import os

        live = os.getpid()
        pid, how = resolve_attach_pid(Device(), preferred_pid=live)
        self.assertEqual(pid, live)
        self.assertEqual(how, "pid-direct")

    def test_preferred_pid_missing_is_rejected(self):
        class Device:
            def enumerate_processes(self):
                return []

        with self.assertRaises(RuntimeError):
            resolve_attach_pid(Device(), preferred_pid=99999999)

    def test_no_pid_requires_eco_name(self):
        class Device:
            def enumerate_processes(self):
                return [SimpleNamespace(pid=1, name="chrome.exe")]

        with self.assertRaises(RuntimeError):
            resolve_attach_pid(Device(), preferred_pid=None)


if __name__ == "__main__":
    unittest.main()
