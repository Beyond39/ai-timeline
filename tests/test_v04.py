from __future__ import annotations

import json
import csv
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import sqlite3
import threading
import time
import unittest
from urllib.request import Request, urlopen

from ai_memory.api import make_handler
from ai_memory.database import Database
from ai_memory.extractors import HeuristicExtractor
from ai_memory.extractors.base import TopicCandidate
from ai_memory.evals import export_review, review_report
from ai_memory.service import MemoryService
from ai_memory.tree import ProjectTree


class V04Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("tmp/v04-tests") / self._testMethodName
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.source = self.root / "project.json"
        self.db = Database(self.root / "memory.sqlite")
        self.memory = MemoryService(self.db)
        self.tree = ProjectTree(self.db)
        self.output = self.root / "knowledge"

    def write_source(self, *, changed=False):
        messages = [
            {"id": "u1", "role": "user", "text": "如何安排英语复习计划？"},
            {"id": "a1", "role": "assistant", "text": "每周安排英语单词和阅读复习。"},
            {"id": "u2", "role": "user", "text": "高等数学错题怎么复习？"},
            {"id": "a2", "role": "assistant", "text": "高数错题要重新推导并记录原因。"},
        ]
        if changed:
            messages.append({"id": "u3", "role": "user", "text": "怎样练习英语听力？"})
        self.source.write_text(json.dumps({"provider": "test", "project_id": "project-one",
            "project_title": "学习项目", "conversations": [
                {"id": "c1", "title": "混合话题", "messages": messages},
                {"id": "c2", "title": "复习计划", "messages": [
                    {"id": "u4", "role": "user", "text": "如何制定每周复习计划？"},
                    {"id": "a4", "role": "assistant", "text": "按进度安排每周目标。"},
                ]},
            ]}, ensure_ascii=False), encoding="utf-8")

    def test_preview_import_fragment_tree_and_evidence(self):
        self.write_source()
        preview = self.memory.preview_path(self.source)
        self.assertEqual((preview["file_count"], preview["conversation_count"], preview["message_count"]), (1, 2, 6))
        self.assertEqual(preview["files"][0]["status"], "NEW")
        project_id = self.memory.import_path(self.source)["project_id"]
        self.assertEqual(self.memory.preview_path(self.source)["files"][0]["status"], "UNCHANGED")
        first = self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))
        self.assertEqual(first["segmentation"]["created_or_changed"], 3)
        self.assertEqual(len(self.tree.fragments.list_fragments(project_id)), 3)
        self.assertGreater(len(first["tree"]["nodes"]), 1)
        topic = self.tree.topic_detail(project_id, first["tree"]["nodes"][0]["id"])
        self.assertTrue(topic["fragments"])
        self.assertTrue(topic["evidence"])
        message_id = topic["evidence"][0]["message_id"]
        self.assertEqual(self.memory.get_message(message_id)["id"], message_id)
        second = self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))
        self.assertEqual(second["compilation"]["status"], "skipped")
        self.assertEqual(self.memory.import_file(self.source)["status"], "skipped")

    def test_changed_and_removed_source_keep_history_inactive(self):
        self.write_source()
        project_id = self.memory.import_file(self.source)["project_id"]
        self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))
        self.write_source(changed=True)
        self.assertEqual(self.memory.preview_path(self.source)["files"][0]["status"], "CHANGED")
        self.assertEqual(self.memory.import_file(self.source)["status"], "changed")
        with self.db.connect() as connection:
            self.assertGreater(connection.execute("SELECT COUNT(*) FROM conversations WHERE active=0").fetchone()[0], 0)
            self.assertGreater(connection.execute("SELECT COUNT(*) FROM knowledge_documents WHERE dirty=1").fetchone()[0], 0)
        self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))
        self.assertEqual(self.memory.remove_source(self.source)["status"], "REMOVED")
        self.assertEqual(self.tree.fragments.list_fragments(project_id), [])
        with self.db.connect() as connection:
            self.assertGreater(connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 6)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_versions").fetchone()[0], 2)

    def test_tree_refinement_uses_reviewable_proposals(self):
        self.write_source()
        project_id = self.memory.import_file(self.source)["project_id"]
        nodes = self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))["tree"]["nodes"]
        source, target = nodes[:2]
        proposal = self.tree.propose(project_id, source["id"], "rename", title="新的主题名")
        self.assertEqual(self.tree.resolve(proposal["id"], "reject")["status"], "rejected")
        proposal = self.tree.propose(project_id, source["id"], "move", parent_topic_id=target["id"])
        self.tree.resolve(proposal["id"], "accept")
        self.assertEqual(next(item for item in self.tree.tree(project_id)["nodes"] if item["id"] == source["id"])["parent_id"], target["id"])
        proposal = self.tree.propose(project_id, source["id"], "rename", title="新主题名")
        self.tree.resolve(proposal["id"], "accept")
        self.assertIn("新主题名", [item["title"] for item in self.tree.tree(project_id)["nodes"]])
        proposal = self.tree.propose(project_id, source["id"], "merge", target_topic_id=target["id"])
        self.tree.resolve(proposal["id"], "accept")
        self.assertNotIn(source["id"], [item["id"] for item in self.tree.tree(project_id)["nodes"]])

    def test_failed_import_does_not_create_project(self):
        self.source.write_text("{broken", encoding="utf-8")
        self.assertEqual(self.memory.preview_path(self.source)["files"][0]["status"], "FAILED")
        with self.assertRaises(ValueError):
            self.memory.import_file(self.source)
        self.db.initialize()
        with self.db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0], 0)

    def test_folder_scan_detects_removed_file(self):
        folder = self.root / "sources"
        folder.mkdir()
        self.source = folder / "project.json"
        self.write_source()
        self.memory.import_path(folder)
        self.source.unlink()
        preview = self.memory.preview_path(folder)
        self.assertEqual(preview["files"][0]["status"], "REMOVED")
        self.assertEqual(self.memory.import_path(folder)["files"][0]["status"], "REMOVED")

    def test_reimport_removed_source_reactivates_original_version(self):
        self.write_source()
        project_id = self.memory.import_file(self.source)["project_id"]
        original = self.source.read_bytes()
        self.write_source(changed=True)
        self.memory.import_file(self.source)
        self.memory.remove_source(self.source)
        self.source.write_bytes(original)
        self.assertEqual(self.memory.import_file(self.source)["project_id"], project_id)
        with self.db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_versions").fetchone()[0], 2)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM conversations WHERE active=1").fetchone()[0], 2)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM conversations WHERE active=0").fetchone()[0], 2)

    def test_fake_provider_is_cached_and_insights_are_evidence_bound(self):
        class FakeExtractor:
            name = "fake-v1"
            model_name = "local-fake"
            calls = 0

            def extract(self, sentences):
                self.calls += 1
                return [TopicCandidate(title="学习事项", summary="按来源记录复习事项。", ai_extension="",
                    evidence_ids=[item.sentence_id for item in sentences],
                    decisions=[{"text": "按周安排复习", "evidence_ids": [sentences[0].sentence_id]}])]

        self.write_source()
        project_id = self.memory.import_file(self.source)["project_id"]
        fake = FakeExtractor()
        self.tree.compile(project_id, fake, output_dir=str(self.output))
        calls = fake.calls
        second = self.tree.compile(project_id, fake, output_dir=str(self.output), force=True)
        self.assertEqual(fake.calls, calls)
        self.assertEqual(second["fragment_cache_hits"], 3)
        topic = self.tree.topic_detail(project_id, second["tree"]["nodes"][0]["id"])
        self.assertTrue(topic["insights"])
        self.assertIn(topic["insights"][0]["evidence_ids"][0], {item["sentence_id"] for item in topic["evidence"]})

    def test_long_fragment_is_batched_before_provider_call(self):
        class BoundedExtractor:
            name = "bounded-fake-v1"
            model_name = "fake"
            max_input_chars = 2_000
            calls = 0

            def extract(self, sentences):
                self.calls += 1
                return [TopicCandidate(title="长片段", summary="来自一组句子。", ai_extension="",
                                       evidence_ids=[item.sentence_id for item in sentences])]

        self.source.write_text(json.dumps({"project_id": "long", "conversations": [{"id": "c", "title": "长对话",
            "messages": [{"id": "u", "role": "user", "text": "如何处理很长的对话？"},
                         {"id": "a", "role": "assistant", "text": "这是一个需要拆分的句子。" * 120}]}]}, ensure_ascii=False), encoding="utf-8")
        project_id = self.memory.import_file(self.source)["project_id"]
        extractor = BoundedExtractor()
        self.tree.compile(project_id, extractor, output_dir=str(self.output))
        self.assertGreater(extractor.calls, 1)
        calls = extractor.calls
        second = self.tree.compile(project_id, extractor, output_dir=str(self.output), force=True)
        self.assertEqual(extractor.calls, calls)
        self.assertEqual(second["fragment_cache_hits"], 1)

    def test_evaluation_export_and_report(self):
        self.write_source()
        project_id = self.memory.import_file(self.source)["project_id"]
        self.tree.compile(project_id, HeuristicExtractor(), output_dir=str(self.output))
        review = self.root / "review.csv"
        result = export_review(self.db, project_id, review)
        self.assertGreater(result["rows"], 0)
        with review.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        summary = next(item for item in rows if item["check"] == "unsupported_summary")
        summary["verdict"] = "fail"
        with review.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
        report = review_report(review)
        self.assertEqual(report["unsupported_knowledge_rate"], 1.0)

    def test_project_api_preview_compile_and_tree(self):
        self.write_source()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.memory))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"
        def post(path, body):
            request = Request(root + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=5) as response:
                return json.load(response)
        try:
            self.assertEqual(post("/v0/import-preview", {"path": str(self.source)})["files"][0]["status"], "NEW")
            project_id = post("/v0/import", {"path": str(self.source)})["project_id"]
            job = post(f"/v0/projects/{project_id}/compile", {"extractor": "heuristic", "output_dir": str(self.output)})
            for _ in range(50):
                with urlopen(root + "/v0/compile-jobs/" + job["id"], timeout=5) as response:
                    status = json.load(response)
                if status["status"] != "running":
                    break
                time.sleep(.1)
            self.assertEqual(status["status"], "completed", status.get("error"))
            with urlopen(root + f"/v0/projects/{project_id}/tree", timeout=5) as response:
                nodes = json.load(response)["nodes"]
            self.assertTrue(nodes)
            with urlopen(root + f"/v0/projects/{project_id}/tree/topics/{nodes[0]['id']}", timeout=5) as response:
                detail = json.load(response)
            self.assertTrue(detail["evidence"])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)

    def test_v03_schema_migrates_without_dropping_existing_rows(self):
        legacy = self.root / "legacy.sqlite"
        connection = sqlite3.connect(legacy)
        connection.execute("CREATE TABLE conversations(id TEXT PRIMARY KEY, project_id TEXT, external_id TEXT, title TEXT, created_at REAL)")
        connection.execute("CREATE TABLE messages(id TEXT PRIMARY KEY, conversation_id TEXT, external_id TEXT, parent_external_id TEXT, ordinal INTEGER, role TEXT, text TEXT, created_at REAL, raw_json TEXT)")
        connection.execute("CREATE TABLE knowledge_documents(id TEXT PRIMARY KEY, topic_id TEXT, relative_path TEXT, title TEXT, review_status TEXT, current_revision_id TEXT, created_at TEXT, updated_at TEXT)")
        connection.execute("CREATE TABLE compiler_runs(id TEXT PRIMARY KEY, project_id TEXT, extractor TEXT, model TEXT, source_fingerprint TEXT, output_dir TEXT, status TEXT, started_at TEXT, completed_at TEXT, result_json TEXT)")
        connection.execute("INSERT INTO conversations VALUES('old', 'p', 'c', 'Old conversation', NULL)")
        connection.commit(); connection.close()
        upgraded = Database(legacy)
        upgraded.initialize()
        with upgraded.connect() as connection:
            self.assertEqual(connection.execute("SELECT title, active FROM conversations WHERE id='old'").fetchone()["active"], 1)
            self.assertEqual(connection.execute("SELECT value FROM schema_meta WHERE key='schema_version'").fetchone()[0], "6")
            self.assertIn("source_sha256", {item["name"] for item in connection.execute("PRAGMA table_info(conversations)")})
