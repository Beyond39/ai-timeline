from __future__ import annotations

import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
import unittest
from urllib.parse import quote
from urllib.request import Request, urlopen

from ai_memory.api import make_handler
from ai_memory.compiler import KnowledgeCompiler
from ai_memory.database import Database
from ai_memory.experience import ExperienceService
from ai_memory.extractors import HeuristicExtractor
from ai_memory.qa import QAPipeline, normalize_tag, tag_hash
from ai_memory.service import MemoryService


ROOT = Path(__file__).resolve().parents[1]


class V021AndV03Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("tmp/v021-v03-tests") / self._testMethodName
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = Database(self.root / "memory.sqlite")
        self.memory = MemoryService(self.db)
        self.compiler = KnowledgeCompiler(self.db)
        self.qa = QAPipeline(self.db)
        self.experience = ExperienceService(self.db)
        self.output = self.root / "knowledge"

    def _prepare(self):
        self.memory.import_file(ROOT / "examples" / "learning-project.json")
        return self.compiler.compile(HeuristicExtractor(), output_dir=self.output)

    def test_qa_units_are_traceable_and_conversation_cache_is_reused(self):
        self.memory.import_file(ROOT / "examples" / "learning-project.json")
        first = self.qa.analyze()
        second = self.qa.analyze()
        self.assertEqual(first["qa_units_created"], 2)
        self.assertEqual(second["cache_hits"], 2)
        units = self.qa.list_units()
        self.assertEqual(len(units), 2)
        with self.db.connect() as connection:
            evidence_count = connection.execute("SELECT COUNT(*) AS n FROM qa_evidence").fetchone()["n"]
        self.assertEqual(evidence_count, 8)
        self.assertTrue(all(item["content_sha256"] for item in units))

    def test_hashes_detect_exact_normalized_identity_not_meaning(self):
        self.assertEqual(normalize_tag(" 学习－方法 "), "学习方法")
        self.assertEqual(tag_hash("学习 方法"), tag_hash("学习方法"))
        self.assertNotEqual(tag_hash("学习技巧"), tag_hash("学习方法"))

    def test_similar_labels_create_review_instead_of_silent_merge(self):
        self.db.initialize()
        with self.db.connect() as connection:
            now = "2026-01-01T00:00:00+00:00"
            connection.execute(
                "INSERT INTO topics(id, slug, title, summary, ai_extension, status, created_at, updated_at) "
                "VALUES('top-plan', '学习规划', '学习规划', '', '', 'active', ?, ?)",
                (now, now),
            )
            pipeline = QAPipeline(self.db, similarity_threshold=0.7)
            topic_id, suggested = pipeline._resolve_tag(connection, "学习计划", now)
        self.assertTrue(suggested)
        self.assertNotEqual(topic_id, "top-plan")
        reviews = self.qa.list_merge_reviews()
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0]["suggested_title"], "学习规划")

    def test_context_package_contains_qa_and_sentence_evidence(self):
        self._prepare()
        package = self.experience.context_package("学习方法")
        self.assertEqual(package["qa_unit_count"], 2)
        self.assertGreaterEqual(package["evidence_count"], 6)
        self.assertIn("## 已归纳 Q/A", package["content"])
        self.assertIn("## 原句证据", package["content"])
        self.assertIn("seg_", package["content"])

    def test_v03_local_ui_and_write_actions_are_connected(self):
        self._prepare()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.memory, self.compiler))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(root + "/", timeout=5) as response:
                html = response.read().decode("utf-8")
            self.assertIn("Project Memory Engine", html)
            with urlopen(root + "/v0/dashboard", timeout=5) as response:
                dashboard = json.loads(response.read().decode("utf-8"))
            self.assertEqual(dashboard["version"], "0.4.2")
            self.assertEqual(dashboard["counts"]["qa_units"], 2)

            request = Request(
                root + "/v0/review",
                data=json.dumps({"document_or_topic": "学习方法", "action": "approve", "output_dir": str(self.output)}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                result = json.loads(response.read().decode("utf-8"))
            self.assertEqual(result["review_status"], "approved")

            with urlopen(root + "/v0/timeline?limit=10", timeout=5) as response:
                timeline = json.loads(response.read().decode("utf-8"))
            self.assertTrue(any(item["kind"] == "review" for item in timeline["data"]))

            with urlopen(root + "/v0/context/" + quote("学习方法"), timeout=5) as response:
                context = json.loads(response.read().decode("utf-8"))
            self.assertIn("Context Package", context["content"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_timeline_retains_project_and_conversation_coordinates(self):
        self._prepare()
        items = self.experience.timeline(limit=10)
        self.assertEqual(len([item for item in items if item["kind"] == "message"]), 4)
        self.assertTrue(all(item["project_id"] for item in items if item["kind"] == "message"))
        self.assertTrue(all(item["conversation_id"] for item in items if item["kind"] == "message"))


if __name__ == "__main__":
    unittest.main()
