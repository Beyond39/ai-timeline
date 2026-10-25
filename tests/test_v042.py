from __future__ import annotations

import json
import shutil
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from ai_memory.api import make_handler
from ai_memory.database import Database
from ai_memory.extractors.base import EvidenceSentence, TopicCandidate
from ai_memory.extractors.openai_responses import OpenAIResponsesExtractor
from ai_memory.llm import OpenAIProvider
from ai_memory.service import MemoryService
from ai_memory.tree import ProjectTree


class FakeProvider:
    def __init__(self):
        self.calls = 0

    def structured_generate(self, *, input_text, **kwargs):
        self.calls += 1
        request = json.loads(input_text)
        if isinstance(request, list):
            return {"labels": [{"turn": index, "topic": next((name for name in ("Database", "Agent", "UI")
                    if name in item["text"]), "Other")} for index, item in enumerate(request)]}
        existing = request["existing"]
        return {"decision": "ATTACH_EXISTING", "selected_titles": [existing[0]["title"]],
                "confidence": 0.96, "reason": "Same project concept"}


class FakeSemanticExtractor:
    name = "fake-semantic"
    model_name = "fake-model"
    max_input_chars = 80_000

    def __init__(self, provider):
        self.provider = provider

    def extract(self, sentences):
        text = " ".join(item.text for item in sentences)
        title = next((name for name in ("GPT-SaaS", "Conversation Manager", "Project Memory Engine") if name in text),
                     "Project Memory Engine")
        return [TopicCandidate(title=title, summary="Project knowledge from conversation",
                               ai_extension="", evidence_ids=[item.sentence_id for item in sentences],
                               keywords=["memory", "project"], claims=[], decisions=[], open_questions=[])]


class UncertainProvider(FakeProvider):
    def structured_generate(self, *, input_text, **kwargs):
        request = json.loads(input_text)
        if isinstance(request, list):
            return super().structured_generate(input_text=input_text, **kwargs)
        self.calls += 1
        return {"decision": "REVIEW_REQUIRED", "selected_titles": [], "confidence": 0.4,
                "reason": "Needs human judgment"}


class V042Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("tmp/v042-tests") / self._testMethodName
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.db = Database(self.root / "memory.sqlite")
        self.service = MemoryService(self.db)
        self.tree = ProjectTree(self.db)

    def test_paste_preview_preserves_original_and_unknown_role(self):
        raw = "This is an unlabelled complete conversation about a database."
        preview = self.service.preview_content("paste.txt", raw.encode(), conversation_title="Raw dialog")
        self.db.initialize()
        with self.db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0], 0)
        result = self.service.import_staged(preview["token"])
        messages = self.service.conversation_messages(self.service.list_conversations(result["project_id"])[0]["id"])
        self.assertEqual((messages[0]["role"], messages[0]["text"]), ("unknown", raw))
        with self.db.connect() as connection:
            self.assertEqual(connection.execute("SELECT raw_bytes FROM source_versions").fetchone()[0], raw.encode())

    def test_file_preview_and_same_project_import(self):
        payload = {"conversations": [{"title": "JSON dialogue", "messages": [
            {"role": "user", "text": "Question"}, {"role": "assistant", "text": "Answer"}]}]}
        preview = self.service.preview_content("dialog.json", json.dumps(payload).encode())
        project_id = self.service.import_staged(preview["token"])["project_id"]
        pasted = self.service.preview_content("paste.md", b"User: Another question\nAssistant: Another answer")
        self.service.import_staged(pasted["token"], project_id=project_id)
        self.assertEqual(len(self.service.list_conversations(project_id)), 2)
        self.assertEqual(pasted["message_count"], 2)

    def test_semantic_matching_evidence_correction_and_cache(self):
        project_id = None
        for title in ("GPT-SaaS", "Conversation Manager", "Project Memory Engine"):
            preview = self.service.preview_content("paste.txt", f"User: Let's design {title}.\nAssistant: {title} stores project knowledge.".encode(),
                                                   conversation_title=title)
            project_id = self.service.import_staged(preview["token"], project_id=project_id)["project_id"]
        provider = FakeProvider()
        extractor = FakeSemanticExtractor(provider)
        compiled = self.tree.compile(project_id, extractor, output_dir=str(self.root / "output"))
        nodes = compiled["tree"]["nodes"]
        self.assertEqual(len(nodes), 1)
        topic = self.tree.topic_detail(project_id, nodes[0]["id"])
        self.assertEqual(len({item["conversation_id"] for item in topic["evidence"]}), 3)
        self.assertEqual(len(topic["fragments"]), 3)
        prior_calls = provider.calls
        skipped = self.tree.compile(project_id, extractor, output_dir=str(self.root / "output"))
        self.assertEqual(skipped["compilation"]["status"], "skipped")
        self.assertEqual(provider.calls, prior_calls)
        new = self.tree.create_topic(project_id, "UI")
        fragment_id = topic["fragments"][0]["id"]
        self.tree.assign_fragment(project_id, fragment_id, new["id"])
        self.tree.compile(project_id, extractor, force=True, output_dir=str(self.root / "output"))
        self.assertEqual(provider.calls, prior_calls)
        self.assertEqual(self.tree.topic_detail(project_id, new["id"])["fragments"][0]["id"], fragment_id)
        self.assertTrue(self.tree.topic_detail(project_id, new["id"])["evidence"])
        self.tree.report_issue(project_id, topic["id"], "wrong_summary", topic["summary"], "Needs revision")
        queue = self.tree.evaluation_queue(project_id)
        self.assertEqual(len(queue), 3)
        self.tree.evaluate_fragment(project_id, fragment_id, {"fragment_correct": True,
                                                             "topic_correct": True, "evidence_correct": True,
                                                             "summary_supported": False, "duplicate_topic": False})
        with self.db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM issue_reports").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT fragment_correct FROM fragment_evaluations WHERE fragment_id=?",
                                                (fragment_id,)).fetchone()[0], 1)

    def test_semantic_turn_boundaries_and_cache(self):
        lines = []
        for name in ("Database", "Database", "Agent", "UI", "Database"):
            lines += [f"User: Discuss {name}.", f"Assistant: Improve {name}."]
        preview = self.service.preview_content("paste.txt", "\n".join(lines).encode())
        project_id = self.service.import_staged(preview["token"])["project_id"]
        self.tree.fragments.segment(project_id)
        provider = FakeProvider()
        first = self.tree.fragments.semantic_segment(project_id, provider, "fake")
        self.assertEqual(first["merged_turn_groups"], 1)
        self.assertEqual(len(self.tree.fragments.list_fragments(project_id)), 4)
        calls = provider.calls
        self.tree.fragments.segment(project_id)
        second = self.tree.fragments.semantic_segment(project_id, provider, "fake")
        self.assertEqual(second["segment_cache_hits"], 1)
        self.assertEqual(provider.calls, calls)

    def test_local_api_upload_paste_and_missing_key(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"
        def post(path, payload):
            with urlopen(Request(root + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}), timeout=5) as response:
                return json.load(response)
        try:
            with urlopen(root + "/", timeout=5) as response:
                html = response.read().decode()
            self.assertIn('id="upload-file"', html)
            self.assertIn('id="paste-text"', html)
            file_content = json.dumps({"conversations": [{"title": "File", "messages": [
                {"role": "user", "text": "Hello"}]}]}).encode()
            request = Request(root + "/v0/upload-preview", data=file_content,
                              headers={"Content-Type": "application/octet-stream", "X-File-Name": "source.json"})
            with urlopen(request, timeout=5) as response:
                preview = json.load(response)
            self.assertEqual(preview["conversation_count"], 1)
            project_id = post("/v0/staged-import", {"token": preview["token"]})["project_id"]
            pasted = post("/v0/paste-preview", {"title": "Pasted", "text": "User: Hi\nAssistant: Hello"})
            post("/v0/staged-import", {"token": pasted["token"], "project_id": project_id})
            with urlopen(root + f"/v0/projects/{project_id}/conversations", timeout=5) as response:
                self.assertEqual(len(json.load(response)["data"]), 2)
            with patch.dict("os.environ", {"OPENAI_API_KEY": ""}):
                with self.assertRaises(HTTPError) as error:
                    post(f"/v0/projects/{project_id}/compile", {"extractor": "openai", "model": "test"})
                self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)

    def test_uncertain_match_review_and_human_alias(self):
        project_id = None
        for title in ("GPT-SaaS", "Conversation Manager"):
            preview = self.service.preview_content("paste.txt", f"User: {title} keeps project memory.\nAssistant: Keep evidence.".encode(),
                                                   conversation_title=title)
            project_id = self.service.import_staged(preview["token"], project_id=project_id)["project_id"]
        self.tree.compile(project_id, FakeSemanticExtractor(UncertainProvider()), output_dir=str(self.root / "output"))
        with self.db.connect() as connection:
            reviews = connection.execute("SELECT id, candidate_json FROM semantic_review_queue WHERE status='pending'").fetchall()
        self.assertEqual(len(reviews), 1)
        topic_id = self.tree.tree(project_id)["nodes"][0]["id"]
        self.tree.resolve_semantic_review(reviews[0]["id"], "attach_existing", topic_id)
        self.assertEqual(len({item["conversation_id"] for item in self.tree.topic_detail(project_id, topic_id)["evidence"]}), 2)
        with self.db.connect() as connection:
            alias = json.loads(reviews[0]["candidate_json"])["title"]
            self.assertEqual(connection.execute("SELECT source FROM topic_aliases WHERE alias=?", (alias,)).fetchone()[0],
                             "human-semantic-review")

    def test_openai_provider_structured_transport_with_local_stub(self):
        seen = []
        class Stub(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers["Content-Length"])
                seen.append((self.path, self.headers.get("Authorization"), json.loads(self.rfile.read(length))))
                body = json.dumps({"output": [{"type": "message", "content": [
                    {"type": "output_text", "text": '{"ok":true}'}]}]}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            provider = OpenAIProvider(api_key="test-only", base_url=f"http://127.0.0.1:{server.server_port}")
            answer = provider.structured_generate(model="test-model", instructions="Return JSON", input_text="test",
                                                  schema_name="test_schema", schema={"type": "object", "properties": {
                                                      "ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False})
            self.assertEqual(answer, {"ok": True})
            self.assertEqual(seen[0][0:2], ("/responses", "Bearer test-only"))
            self.assertEqual(seen[0][2]["text"]["format"]["type"], "json_schema")
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)

    def test_structured_extraction_retries_malformed_result(self):
        class FlakyExtractor(OpenAIResponsesExtractor):
            def __init__(self):
                super().__init__(model="test-model", api_key="test-only")
                self.calls = 0
            def _post(self, payload):
                self.calls += 1
                if self.calls == 1:
                    return {"output_text": "not-json"}
                return {"output_text": json.dumps({"topics": [{"title": "Database", "summary": "Original claim",
                    "ai_extension": "", "evidence_ids": ["s1"], "keywords": ["database"],
                    "claims": [{"text": "Keep source versions", "evidence_ids": ["s1"]}],
                    "decisions": [], "open_questions": []}]})}
        extractor = FlakyExtractor()
        sentence = EvidenceSentence("s1", "m1", "user", "Keep source versions", 0, 20,
                                    "p1", "Project", "c1", "Conversation")
        result = extractor.extract([sentence])
        self.assertEqual((extractor.calls, result[0].title), (2, "Database"))

    def test_compile_failure_then_retry_preserves_source(self):
        preview = self.service.preview_content("paste.txt", b"User: Keep source data.\nAssistant: Yes, keep it.")
        project_id = self.service.import_staged(preview["token"])["project_id"]
        class Flaky:
            name = "flaky"
            model_name = "fake"
            max_input_chars = 80_000
            calls = 0
            def extract(self, sentences):
                self.calls += 1
                if self.calls == 1:
                    raise RuntimeError("temporary model failure")
                return [TopicCandidate("Source", "Keep raw data", "", [item.sentence_id for item in sentences])]
        extractor = Flaky()
        with self.assertRaisesRegex(RuntimeError, "temporary"):
            self.tree.compile(project_id, extractor, output_dir=str(self.root / "output"))
        self.assertEqual(len(self.service.list_conversations(project_id)), 1)
        result = self.tree.compile(project_id, extractor, output_dir=str(self.root / "output"))
        self.assertEqual(result["compilation"]["status"], "compiled")

    def test_semantic_hierarchy_respects_manual_move(self):
        project_id = None
        for title in ("Project Memory Engine", "Database", "UI"):
            preview = self.service.preview_content("paste.txt", f"User: Explain {title}.\nAssistant: We need {title}.".encode(),
                                                   conversation_title=title)
            project_id = self.service.import_staged(preview["token"], project_id=project_id)["project_id"]
        class HierarchyProvider(FakeProvider):
            def structured_generate(self, *, input_text, **kwargs):
                request = json.loads(input_text)
                if "topics" in request:
                    return {"links": [{"child_title": "UI", "parent_title": "Project Memory Engine",
                                       "confidence": .95}]}
                if "existing" in request:
                    return {"decision": "CREATE_NEW", "selected_titles": [], "confidence": .95, "reason": "Distinct"}
                return super().structured_generate(input_text=input_text, **kwargs)
        class Extractor(FakeSemanticExtractor):
            def extract(self, sentences):
                text = " ".join(item.text for item in sentences)
                title = next(name for name in ("Project Memory Engine", "Database", "UI") if name in text)
                return [TopicCandidate(title, text[:60], "", [item.sentence_id for item in sentences])]
        extractor = Extractor(HierarchyProvider())
        result = self.tree.compile(project_id, extractor, output_dir=str(self.root / "output"))
        by_title = {item["title"]: item for item in result["tree"]["nodes"]}
        self.assertEqual(by_title["UI"]["parent_id"], by_title["Project Memory Engine"]["id"])
        proposal = self.tree.propose(project_id, by_title["UI"]["id"], "move",
                                     parent_topic_id=by_title["Database"]["id"])
        self.tree.resolve(proposal["id"], "accept")
        after = self.tree.compile(project_id, extractor, force=True, output_dir=str(self.root / "output"))
        ui = next(item for item in after["tree"]["nodes"] if item["title"] == "UI")
        self.assertEqual(ui["parent_id"], by_title["Database"]["id"])


if __name__ == "__main__":
    unittest.main()
