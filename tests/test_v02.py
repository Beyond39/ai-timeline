from __future__ import annotations

import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
import unittest
from urllib.parse import quote
from urllib.request import urlopen

from ai_memory.api import make_handler
from ai_memory.compiler import KnowledgeCompiler
from ai_memory.database import Database
from ai_memory.extractors import EvidenceSentence, HeuristicExtractor, OpenAIResponsesExtractor
from ai_memory.service import MemoryService


ROOT = Path(__file__).resolve().parents[1]


class FakeOpenAIExtractor(OpenAIResponsesExtractor):
    def __init__(self, response: dict):
        super().__init__(model="test-model", api_key="test-key")
        self.response = response

    def _post(self, payload: dict) -> dict:
        self.last_payload = payload
        return self.response


class V02Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("tmp/v02-tests") / self._testMethodName
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = Database(self.root / "memory.sqlite")
        self.memory = MemoryService(self.db)
        self.compiler = KnowledgeCompiler(self.db)
        self.output = self.root / "knowledge"

    def _import_learning_demo(self) -> str:
        result = self.memory.import_file(ROOT / "examples" / "learning-project.json")
        return result["project_id"]

    def _write_second_project(self) -> Path:
        path = self.root / "second-project.json"
        path.write_text(
            json.dumps(
                {
                    "provider": "test-llm",
                    "project_id": "exam-demo",
                    "project_title": "考试准备",
                    "conversations": [
                        {
                            "id": "review-method",
                            "title": "复习经验",
                            "messages": [
                                {"id": "u1", "role": "user", "text": "如何长期记忆？", "created_at": 10},
                                {
                                    "id": "a1",
                                    "parent_id": "u1",
                                    "role": "assistant",
                                    "text": "使用间隔复习，并根据回忆结果调整下一次复习时间。",
                                    "created_at": 11,
                                },
                            ],
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return path

    def test_compile_creates_cross_conversation_traceable_tree(self):
        self._import_learning_demo()
        result = self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        self.assertEqual(result["status"], "compiled")
        self.assertGreaterEqual(result["topics"], 3)
        learning = self.compiler.get_topic("学习方法")
        self.assertIsNotNone(learning)
        conversations = {item["conversation_id"] for item in learning["evidence"]}
        self.assertEqual(len(conversations), 2)
        document = self.output / "学习方法" / "README.md"
        content = document.read_text(encoding="utf-8")
        self.assertIn("## 可追溯核心内容", content)
        self.assertIn("## AI 扩展（非原始证据）", content)
        self.assertIn("证据 ID：`seg_", content)

    def test_unchanged_compile_skips_and_force_does_not_create_revision(self):
        self._import_learning_demo()
        first = self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        second = self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        forced = self.compiler.compile(HeuristicExtractor(), output_dir=self.output, force=True)
        self.assertEqual(second["status"], "skipped")
        self.assertEqual(second["previous_run_id"], first["run_id"])
        self.assertEqual(forced["revisions_created"], 0)

    def test_new_source_creates_revision_and_requires_review_again(self):
        self._import_learning_demo()
        self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        approved = self.compiler.review("学习方法", "approve", note="人工核对完成", output_dir=self.output)
        self.assertEqual(approved["review_status"], "approved")
        self.memory.import_file(self._write_second_project())
        result = self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        self.assertGreater(result["revisions_created"], 0)
        learning_doc = next(item for item in self.compiler.list_documents() if item["topic_slug"] == "学习方法")
        self.assertEqual(learning_doc["review_status"], "needs_review")
        self.assertEqual(learning_doc["revision_no"], 2)

    def test_openai_extractor_uses_schema_and_rejects_unknown_evidence(self):
        sentence = EvidenceSentence(
            sentence_id="seg-1",
            message_id="msg-1",
            role="assistant",
            text="使用主动回忆。",
            start_offset=0,
            end_offset=7,
            project_id="p1",
            project_title="学习",
            conversation_id="c1",
            conversation_title="方法",
        )
        body = {
            "topics": [
                {
                    "title": "学习方法",
                    "summary": "主动回忆是一种学习方法。",
                    "ai_extension": "可以配合间隔练习。",
                    "evidence_ids": ["seg-1"],
                    "keywords": ["主动回忆"],
                }
            ]
        }
        response = {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(body, ensure_ascii=False)}],
                }
            ]
        }
        extractor = FakeOpenAIExtractor(response)
        topics = extractor.extract([sentence])
        self.assertEqual(topics[0].evidence_ids, ["seg-1"])
        self.assertEqual(extractor.last_payload["text"]["format"]["type"], "json_schema")

        body["topics"][0]["evidence_ids"] = ["invented-id"]
        extractor.response = {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(body, ensure_ascii=False)}],
                }
            ]
        }
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            extractor.extract([sentence])

    def test_api_decodes_chinese_topic_slug(self):
        self._import_learning_demo()
        self.compiler.compile(HeuristicExtractor(), output_dir=self.output)
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.memory, self.compiler))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/v0/topics/{quote('学习方法')}"
            with urlopen(url, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(payload["slug"], "学习方法")
            self.assertGreater(len(payload["evidence"]), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
