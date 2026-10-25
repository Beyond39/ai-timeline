from __future__ import annotations

import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from ai_memory.database import Database
from ai_memory.doctor import inspect_project
from ai_memory.cli import main
from ai_memory.service import MemoryService


class DoctorTests(unittest.TestCase):
    def setUp(self):
        self.root = (Path("tmp/doctor-tests") / self._testMethodName).resolve()
        assert self.root.is_relative_to(Path.cwd().resolve())
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)

    def test_read_only_check_does_not_create_database(self):
        db = Database(self.root / "memory.sqlite")
        with patch.dict("os.environ", {"OPENAI_API_KEY": "", "AI_MEMORY_MODEL": ""}):
            report = inspect_project(db)
        self.assertFalse(db.path.exists())
        self.assertEqual(report["stage"], "not_started")
        self.assertEqual(report["counts"]["projects"], 0)

    def test_check_detects_imported_but_uncompiled_project(self):
        db = Database(self.root / "memory.sqlite")
        service = MemoryService(db)
        preview = service.preview_content("paste.txt", b"User: Project design?\nAssistant: Keep evidence.")
        service.import_staged(preview["token"])
        with patch.dict("os.environ", {"OPENAI_API_KEY": "", "AI_MEMORY_MODEL": ""}):
            report = inspect_project(db)
        self.assertEqual(report["counts"]["projects"], 1)
        self.assertEqual(report["counts"]["active_conversations"], 1)
        self.assertEqual(report["stage"], "offline_trial")

    def test_launch_initializes_database_and_opens_ready_app(self):
        database_path = self.root / "memory.sqlite"
        def ready_server(service, host, port, *, compiler, on_ready):
            self.assertEqual((host, port), ("127.0.0.1", 8765))
            on_ready()
        with patch("ai_memory.cli.serve", side_effect=ready_server), \
             patch("ai_memory.cli.urlopen") as health, \
             patch("ai_memory.cli.webbrowser.open", return_value=True) as browser:
            self.assertEqual(main(["--db", str(database_path), "launch"]), 0)
        self.assertTrue(database_path.is_file())
        health.assert_called_once_with("http://127.0.0.1:8765/health", timeout=1)
        browser.assert_called_once_with("http://127.0.0.1:8765")


if __name__ == "__main__":
    unittest.main()
