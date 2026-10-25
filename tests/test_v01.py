from __future__ import annotations

import json
import unittest
from pathlib import Path

from ai_memory.connectors.chatgpt import ChatGPTConnector
from ai_memory.database import Database
from ai_memory.service import MemoryService
from ai_memory.text import split_sentences


class V01Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("tmp/v01-tests") / self._testMethodName
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ("memory.sqlite", "memory.sqlite-wal", "memory.sqlite-shm", "one.json", "two.json"):
            target = self.root / name
            if target.exists():
                target.unlink()
        self.db = Database(self.root / "memory.sqlite")
        self.service = MemoryService(self.db)

    def tearDown(self):
        pass

    def _write(self, name: str, project_id: str, title: str, text: str) -> Path:
        path = self.root / name
        path.write_text(
            json.dumps(
                {
                    "provider": "test-llm",
                    "project_id": project_id,
                    "project_title": title,
                    "conversations": [
                        {
                            "id": "c1",
                            "title": "mixed topic",
                            "messages": [
                                {"id": "u1", "role": "user", "text": text, "created_at": 1},
                                {"id": "a1", "role": "assistant", "parent_id": "u1", "text": "使用主动回忆。", "created_at": 2},
                            ],
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return path

    def test_sentence_offsets_round_trip(self):
        text = "第一句。 第二句？\n第三句"
        sentences = split_sentences(text)
        self.assertEqual([item.text for item in sentences], ["第一句。", "第二句？", "第三句"])
        for item in sentences:
            self.assertEqual(text[item.start:item.end], item.text)

    def test_import_is_idempotent_and_links_answer(self):
        source = self._write("one.json", "p1", "学习", "如何复习？")
        first = self.service.import_file(source)
        second = self.service.import_file(source)
        self.assertEqual(first["status"], "imported")
        self.assertEqual(second["status"], "skipped")
        questions = self.service.list_questions(first["project_id"])
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]["status"], "answered")
        self.assertEqual(questions[0]["answer_count"], 1)

    def test_cross_project_search_returns_traceable_locations(self):
        one = self._write("one.json", "p1", "学习", "怎样安排复习？")
        two = self._write("two.json", "p2", "高数", "高数复习怎样安排？")
        self.service.import_file(one)
        self.service.import_file(two)
        hits = self.service.search("复习")
        self.assertGreaterEqual(len(hits), 2)
        self.assertEqual({item["project_title"] for item in hits}, {"学习", "高数"})
        self.assertTrue(all(item["message_id"] and item["start_offset"] >= 0 for item in hits))

    def test_chatgpt_connector_maps_parent_node_to_message_id(self):
        connector = ChatGPTConnector()
        bundle = connector.parse(
            [
                {
                    "id": "conv-1",
                    "title": "学习方法",
                    "mapping": {
                        "node-user": {
                            "parent": None,
                            "message": {
                                "id": "msg-user",
                                "author": {"role": "user"},
                                "content": {"parts": ["如何安排复习？"]},
                            },
                        },
                        "node-assistant": {
                            "parent": "node-user",
                            "message": {
                                "id": "msg-assistant",
                                "author": {"role": "assistant"},
                                "content": {"parts": ["先回忆，再检查。"]},
                            },
                        },
                    },
                }
            ],
            project_title="学习",
        )
        answer = next(message for message in bundle.conversations[0].messages if message.role == "assistant")
        self.assertEqual(answer.parent_external_id, "msg-user")


if __name__ == "__main__":
    unittest.main()
