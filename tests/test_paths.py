import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from eco_paths import find_data_file, resolve_dirs, ensure_data_layout, data_path


class PathResolutionTest(unittest.TestCase):
    def test_prefers_sibling_data_directory_in_dev(self):
        # src/eco_paths.py should resolve repo/data when present.
        res_dir, data_dir = resolve_dirs()
        self.assertTrue(res_dir.endswith("src") or res_dir.replace("\\", "/").endswith("/src"))
        # In this repo layout, data/ is next to src/.
        expected = Path(res_dir).resolve().parent / "data"
        if expected.is_dir():
            self.assertEqual(Path(data_dir).resolve(), expected)

    def test_eco_data_dir_env_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"ECO_DATA_DIR": tmp}, clear=False):
                res_dir, data_dir = resolve_dirs()
            self.assertEqual(os.path.abspath(data_dir), os.path.abspath(tmp))
            self.assertTrue(os.path.isdir(res_dir))

    def test_find_data_file_prefers_data_dir(self):
        with tempfile.TemporaryDirectory() as data_tmp:
            with tempfile.TemporaryDirectory() as res_tmp:
                preferred = Path(data_tmp) / "skill_names.json"
                fallback = Path(res_tmp) / "skill_names.json"
                preferred.write_text('{"1":"a"}', encoding="utf-8")
                fallback.write_text('{"2":"b"}', encoding="utf-8")
                found = find_data_file(data_tmp, res_tmp, "skill_names.json")
                self.assertEqual(Path(found).resolve(), preferred.resolve())

    def test_ensure_data_layout_creates_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = ensure_data_layout(tmp)
            self.assertTrue(os.path.isdir(data_path(root, "logs")))


if __name__ == "__main__":
    unittest.main()
