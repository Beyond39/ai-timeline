from __future__ import annotations

import json
import os
import threading
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from urllib.parse import parse_qs, unquote, urlparse

from .compiler import KnowledgeCompiler
from .experience import ExperienceService
from .extractors import HeuristicExtractor, OpenAIResponsesExtractor
from .qa import QAPipeline
from .service import MemoryService
from .tree import ProjectTree


def make_handler(service: MemoryService, compiler: KnowledgeCompiler | None = None):
    compiler = compiler or KnowledgeCompiler(service.db)
    qa = QAPipeline(service.db)
    experience = ExperienceService(service.db)
    tree = ProjectTree(service.db)
    jobs: dict[str, dict] = {}

    class Handler(BaseHTTPRequestHandler):
        server_version = "AIMemory/0.4.2"

        def _send(self, payload, status=HTTPStatus.OK):
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_static(self, name: str, content_type: str):
            body = files("ai_memory.static").joinpath(name).read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urlparse(self.path)
            parts = [unquote(part) for part in parsed.path.split("/") if part]
            query = parse_qs(parsed.query)
            try:
                if parsed.path == "/":
                    return self._send_static("index.html", "text/html; charset=utf-8")
                if parsed.path == "/app.css":
                    return self._send_static("app.css", "text/css; charset=utf-8")
                if parsed.path == "/app.js":
                    return self._send_static("app.js", "text/javascript; charset=utf-8")
                if parsed.path == "/health":
                    return self._send({"status": "ok", "version": "0.4.2"})
                if parsed.path == "/v0/provider-status":
                    return self._send({"semantic_available": bool(os.getenv("OPENAI_API_KEY")),
                                       "model": os.getenv("AI_MEMORY_MODEL", ""),
                                       "setup": "Set OPENAI_API_KEY and AI_MEMORY_MODEL in the server environment, then restart."})
                if len(parts) == 3 and parts[:2] == ["v0", "compile-jobs"]:
                    job = jobs.get(parts[2])
                    return self._send(job or {"error": "not found"}, HTTPStatus.OK if job else HTTPStatus.NOT_FOUND)
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "tree":
                    return self._send(tree.tree(parts[2]))
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "fragments":
                    return self._send({"data": tree.fragments.list_fragments(parts[2])})
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "evaluation-queue":
                    return self._send({"data": tree.evaluation_queue(parts[2], _integer(query, "limit", 20))})
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "semantic-reviews":
                    with service.db.connect() as connection:
                        rows = connection.execute("SELECT * FROM semantic_review_queue WHERE project_id=? AND status='pending' "
                                                  "ORDER BY created_at DESC", (parts[2],)).fetchall()
                    return self._send({"data": [dict(row) for row in rows]})
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "tree-proposals":
                    return self._send({"data": tree.proposals(parts[2])})
                if len(parts) == 6 and parts[:2] == ["v0", "projects"] and parts[3] == "tree" and parts[4] == "topics":
                    return self._send(tree.topic_detail(parts[2], parts[5]))
                if parsed.path == "/v0/dashboard":
                    return self._send(experience.dashboard())
                if parsed.path == "/v0/projects":
                    return self._send({"data": service.list_projects()})
                if parsed.path == "/v0/questions":
                    return self._send({"data": service.list_questions(limit=_integer(query, "limit", 100))})
                if parsed.path == "/v0/search":
                    term = (query.get("q") or [""])[0]
                    if not term:
                        return self._send({"error": "q is required"}, HTTPStatus.BAD_REQUEST)
                    project_id = (query.get("project_id") or [None])[0]
                    return self._send({"data": service.search(term, project_id=project_id, limit=_integer(query, "limit", 50))})
                if parsed.path == "/v0/topics":
                    return self._send({"data": compiler.list_topics()})
                if parsed.path == "/v0/knowledge-documents":
                    return self._send({"data": compiler.list_documents()})
                if parsed.path == "/v0/qa-units":
                    return self._send({"data": qa.list_units(project_id=(query.get("project_id") or [None])[0], limit=_integer(query, "limit", 200))})
                if parsed.path == "/v0/merge-reviews":
                    return self._send({"data": qa.list_merge_reviews(status=(query.get("status") or ["pending"])[0])})
                if parsed.path == "/v0/timeline":
                    return self._send({"data": experience.timeline(project_id=(query.get("project_id") or [None])[0], limit=_integer(query, "limit", 300))})
                if len(parts) == 3 and parts[:2] == ["v0", "context"]:
                    return self._send(experience.context_package(parts[2]))
                if len(parts) == 3 and parts[:2] == ["v0", "topics"]:
                    topic = compiler.get_topic(parts[2])
                    return self._send(topic or {"error": "not found"}, HTTPStatus.OK if topic else HTTPStatus.NOT_FOUND)
                if len(parts) == 4 and parts[:2] == ["v0", "knowledge-documents"] and parts[3] == "revisions":
                    return self._send({"data": compiler.list_revisions(parts[2])})
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "conversations":
                    return self._send({"data": service.list_conversations(parts[2])})
                if len(parts) == 4 and parts[:2] == ["v0", "conversations"] and parts[3] == "messages":
                    return self._send({"data": service.conversation_messages(parts[2])})
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "questions":
                    return self._send({"data": service.list_questions(parts[2])})
                if len(parts) == 3 and parts[:2] == ["v0", "messages"]:
                    message = service.get_message(parts[2])
                    return self._send(message or {"error": "not found"}, HTTPStatus.OK if message else HTTPStatus.NOT_FOUND)
                return self._send({"error": "not found"}, HTTPStatus.NOT_FOUND)
            except ValueError as exc:
                return self._send({"error": type(exc).__name__, "detail": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:  # Boundary converts failures into JSON.
                return self._send({"error": type(exc).__name__, "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def do_POST(self):
            parsed = urlparse(self.path)
            parts = [unquote(part) for part in parsed.path.split("/") if part]
            try:
                origin = self.headers.get("Origin")
                if origin and origin not in {f"http://{self.headers.get('Host')}", f"https://{self.headers.get('Host')}"}:
                    return self._send({"error": "origin not allowed"}, HTTPStatus.FORBIDDEN)
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 20_000_000:
                    raise ValueError("Request must be no larger than 20 MB")
                if parsed.path == "/v0/upload-preview":
                    filename = unquote(self.headers.get("X-File-Name", ""))
                    return self._send(service.preview_content(filename, self.rfile.read(length),
                                      project_title=unquote(self.headers.get("X-Project-Title") or "") or None), HTTPStatus.OK)
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                if parsed.path == "/v0/paste-preview":
                    return self._send(service.preview_content("paste.txt", str(payload.get("text", "")).encode("utf-8"),
                                      project_title=payload.get("project_title"),
                                      conversation_title=payload.get("title")))
                if parsed.path == "/v0/staged-import":
                    return self._send(service.import_staged(str(payload.get("token", "")),
                                                            project_id=payload.get("project_id")))
                if parsed.path == "/v0/import-preview":
                    return self._send(service.preview_path(str(payload.get("path", "")), project_title=payload.get("project_title")))
                if parsed.path == "/v0/import":
                    return self._send(service.import_path(str(payload.get("path", "")), project_title=payload.get("project_title")))
                if parsed.path == "/v0/remove-source":
                    return self._send(service.remove_source(str(payload.get("path", ""))))
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "compile":
                    project_id = parts[2]
                    extractor_name = str(payload.get("extractor", "heuristic"))
                    if extractor_name == "openai":
                        if not os.getenv("OPENAI_API_KEY"):
                            raise ValueError("Semantic Compile requires OPENAI_API_KEY. Configure it in the server environment, restart, or use Offline Mode.")
                        extractor = OpenAIResponsesExtractor(model=str(payload.get("model") or os.getenv("AI_MEMORY_MODEL", "")))
                    elif extractor_name == "heuristic":
                        extractor = HeuristicExtractor()
                    else:
                        raise ValueError("Unsupported extractor")
                    job_id = "job_" + uuid.uuid4().hex
                    jobs[job_id] = {"id": job_id, "status": "running", "phase": "queued", "current": 0, "total": 0}
                    def run_compile():
                        try:
                            def update(phase, current, total):
                                jobs[job_id].update(phase=phase, current=current, total=total)
                            result = tree.compile(project_id, extractor, force=bool(payload.get("force", False)),
                                                  output_dir=str(payload.get("output_dir", "output/generated/knowledge")),
                                                  progress=update)
                            jobs[job_id].update(status="completed", phase="done", result=result)
                        except Exception as exc:
                            jobs[job_id].update(status="failed", failed_phase=jobs[job_id]["phase"],
                                                phase="failed", error=str(exc))
                    threading.Thread(target=run_compile, daemon=True).start()
                    return self._send(jobs[job_id], HTTPStatus.ACCEPTED)
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "topics":
                    return self._send(tree.create_topic(parts[2], str(payload.get("title", ""))))
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "assign-fragment":
                    return self._send(tree.assign_fragment(parts[2], str(payload.get("fragment_id", "")),
                                                           str(payload.get("topic_id", ""))))
                if len(parts) == 4 and parts[:2] == ["v0", "projects"] and parts[3] == "issues":
                    return self._send(tree.report_issue(parts[2], str(payload.get("object_id", "")),
                                                        str(payload.get("issue_type", "other")),
                                                        str(payload.get("current_result", "")),
                                                        str(payload.get("correction", ""))))
                if len(parts) == 5 and parts[:2] == ["v0", "projects"] and parts[3] == "evaluate":
                    return self._send(tree.evaluate_fragment(parts[2], parts[4], payload))
                if len(parts) == 4 and parts[:2] == ["v0", "semantic-reviews"] and parts[3] == "resolve":
                    return self._send(tree.resolve_semantic_review(parts[2], str(payload.get("action", "")),
                                                                   payload.get("topic_id")))
                if len(parts) == 5 and parts[:2] == ["v0", "projects"] and parts[3] == "tree" and parts[4] == "proposals":
                    action = str(payload.get("action", ""))
                    return self._send(tree.propose(parts[2], str(payload.get("topic_id", "")), action,
                                                   **{key: value for key, value in payload.items() if key not in {"action", "topic_id"}}))
                if len(parts) == 4 and parts[:2] == ["v0", "tree-proposals"] and parts[3] == "resolve":
                    return self._send(tree.resolve(parts[2], str(payload.get("decision", ""))))
                if parsed.path == "/v0/refresh":
                    analysis = qa.analyze(force=bool(payload.get("force", False)))
                    compilation = compiler.compile(
                        HeuristicExtractor(),
                        output_dir=payload.get("output_dir", "output/generated/knowledge"),
                        force=bool(payload.get("force", False)),
                        analyze_qa=False,
                    )
                    return self._send({"analysis": analysis, "compilation": compilation})
                if parsed.path == "/v0/review":
                    return self._send(
                        compiler.review(
                            str(payload.get("document_or_topic", "")),
                            str(payload.get("action", "")),
                            note=str(payload.get("note", "")),
                            output_dir=payload.get("output_dir", "output/generated/knowledge"),
                        )
                    )
                if len(parts) == 3 and parts[:2] == ["v0", "merge-reviews"]:
                    return self._send(
                        qa.resolve_merge(parts[2], str(payload.get("action", "")), note=str(payload.get("note", "")))
                    )
                return self._send({"error": "not found"}, HTTPStatus.NOT_FOUND)
            except (ValueError, json.JSONDecodeError) as exc:
                return self._send({"error": type(exc).__name__, "detail": str(exc)}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                return self._send({"error": type(exc).__name__, "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def log_message(self, format, *args):
            return

    return Handler


def _integer(query: dict[str, list[str]], name: str, default: int) -> int:
    try:
        return max(1, min(500, int((query.get(name) or [str(default)])[0])))
    except ValueError:
        return default


def serve(service: MemoryService, host: str, port: int, *, compiler: KnowledgeCompiler | None = None,
          on_ready=None) -> None:
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("V0.4 local API must bind to loopback")
    server = ThreadingHTTPServer((host, port), make_handler(service, compiler))
    print(f"Project Memory Engine V0.4.2 listening on http://{host}:{port}", flush=True)
    if on_ready:
        threading.Thread(target=on_ready, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
