from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .connectors import ChatGPTConnector, GenericJSONConnector, ImportBundle
from .connectors.base import CanonicalConversation, CanonicalMessage
from .database import Database
from .text import split_sentences


def _id(prefix: str, *parts: str) -> str:
    seed = "\x1f".join(parts)
    return f"{prefix}_{uuid.uuid5(uuid.NAMESPACE_URL, seed).hex}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_question(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class MemoryService:
    def __init__(self, database: Database):
        self.db = database
        self.connectors = [ChatGPTConnector(), GenericJSONConnector()]
        self.staged: dict[str, tuple[str, bytes, ImportBundle, str]] = {}

    def _bundle_from_content(self, filename: str, content: bytes, project_title: str | None,
                             conversation_title: str | None = None) -> tuple[ImportBundle, str]:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".json", ".txt", ".md"}:
            raise ValueError("Choose a .json, .txt or .md file")
        if not content or len(content) > 20_000_000:
            raise ValueError("File must contain 1 byte to 20 MB")
        if suffix == ".json":
            payload = json.loads(content.decode("utf-8-sig"))
            connector = next((item for item in self.connectors if item.can_read(payload)), None)
            if not connector:
                raise ValueError("Unsupported JSON shape. Use ChatGPT conversations.json or generic JSON.")
            return connector.parse(payload, project_title=project_title), connector.name
        text = content.decode("utf-8-sig").strip()
        if not text:
            raise ValueError("Conversation text is empty")
        marker = re.compile(r"(?im)^(?:#{1,3}\s*)?(user|human|assistant|ai)\s*[:：]\s*")
        matches = list(marker.finditer(text))
        messages: list[CanonicalMessage] = []
        if matches and not text[:matches[0].start()].strip():
            for index, match in enumerate(matches):
                body = text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)].strip()
                if body:
                    role = "user" if match.group(1).lower() in {"user", "human"} else "assistant"
                    messages.append(CanonicalMessage(f"message-{index}", role, body,
                                                     parent_external_id=f"message-{index-1}" if index else None,
                                                     raw={"source_span": [match.start(), match.end() + len(body)]}))
        if not messages:
            messages = [CanonicalMessage("raw-0", "unknown", text, raw={"unparsed": True})]
        title = (conversation_title or Path(filename).stem or "Pasted conversation").strip()
        bundle = ImportBundle("pasted-conversation", None, project_title or "Project Memory Engine",
                              [CanonicalConversation("conversation-0", title, None, messages)])
        return bundle, "conversation-text"

    def preview_content(self, filename: str, content: bytes, *, project_title: str | None = None,
                        conversation_title: str | None = None) -> dict[str, Any]:
        bundle, source_type = self._bundle_from_content(filename, content, project_title, conversation_title)
        token = uuid.uuid4().hex
        if len(self.staged) >= 10:
            self.staged.pop(next(iter(self.staged)))
        self.staged[token] = (filename, content, bundle, source_type)
        count = sum(len(conv.messages) for conv in bundle.conversations)
        return {"token": token, "filename": Path(filename).name, "source_type": source_type,
                "conversation_count": len(bundle.conversations), "message_count": count,
                "sample_titles": [conv.title for conv in bundle.conversations[:5]],
                "byte_size": len(content), "approx_tokens": len(content) // 4,
                "warnings": ["Role could not be identified; complete original text is retained"]
                if source_type == "conversation-text" and bundle.conversations[0].messages[0].role == "unknown" else []}

    def import_staged(self, token: str, *, project_id: str | None = None) -> dict[str, Any]:
        if token not in self.staged:
            raise ValueError("Preview expired; choose or paste the source again")
        filename, content, bundle, source_type = self.staged[token]
        digest = hashlib.sha256(content).hexdigest()
        result = self._store_bundle(bundle, source_path=f"upload://{token}/{Path(filename).name}",
                                    source_sha256=digest, source_type=source_type,
                                    raw_bytes=content, project_id=project_id)
        del self.staged[token]
        return result

    def _read_source(self, path: str | Path, project_title: str | None = None):
        source = Path(path).resolve()
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        payload = json.loads(content.decode("utf-8-sig"))
        connector = next((item for item in self.connectors if item.can_read(payload)), None)
        if connector is None:
            raise ValueError("Unsupported JSON shape. Use ChatGPT conversations.json or the generic format.")
        return source, digest, connector, connector.parse(payload, project_title=project_title), content

    def preview_path(self, path: str | Path, *, project_title: str | None = None) -> dict[str, Any]:
        if not str(path).strip():
            raise ValueError("Source path is required")
        self.db.initialize()
        source = Path(path).resolve()
        paths = sorted(source.rglob("*.json")) if source.is_dir() else [source]
        files = []
        with self.db.connect() as connection:
            for item in paths:
                try:
                    resolved, digest, connector, bundle, content = self._read_source(item, project_title)
                    prior = connection.execute(
                        "SELECT source_sha256, status FROM source_files WHERE source_path=?", (str(resolved),)
                    ).fetchone()
                    duplicate = connection.execute(
                        "SELECT source_path FROM import_runs WHERE source_sha256=? AND status='completed'", (digest,)
                    ).fetchone()
                    lifecycle = ("UNCHANGED" if prior and prior["source_sha256"] == digest and prior["status"] == "active"
                                 else "CHANGED" if prior else "UNCHANGED" if duplicate else "NEW")
                    message_count = sum(len(conv.messages) for conv in bundle.conversations)
                    files.append({
                        "path": str(resolved), "source_type": connector.name, "status": lifecycle,
                        "duplicate_status": ("same_source" if duplicate and duplicate["source_path"] == str(resolved)
                                             else "duplicate_content" if duplicate else "none"),
                        "conversation_count": len(bundle.conversations), "message_count": message_count,
                        "text_characters": sum(len(message.text) for conv in bundle.conversations for message in conv.messages),
                        "approx_tokens": sum(len(message.text) for conv in bundle.conversations for message in conv.messages) // 4,
                        "byte_size": len(content), "sample_titles": [conv.title for conv in bundle.conversations[:5]],
                        "warnings": (["No conversations found"] if not bundle.conversations else []) +
                                    (["Identical content was imported from another path"] if duplicate and duplicate["source_path"] != str(resolved) else []),
                        "errors": [],
                    })
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    files.append({"path": str(item), "status": "FAILED", "source_type": "unknown", "duplicate_status": "unknown",
                                  "conversation_count": 0, "message_count": 0, "text_characters": 0,
                                  "approx_tokens": 0, "byte_size": 0, "sample_titles": [],
                                  "warnings": [], "errors": [str(exc)]})
            if source.is_dir():
                discovered = {str(item.resolve()) for item in paths}
                for old in connection.execute("SELECT source_path, source_type FROM source_files WHERE status='active'").fetchall():
                    if source in Path(old["source_path"]).parents and old["source_path"] not in discovered:
                        files.append({"path": old["source_path"], "status": "REMOVED", "source_type": old["source_type"], "duplicate_status": "none",
                                      "conversation_count": 0, "message_count": 0, "text_characters": 0,
                                      "approx_tokens": 0, "byte_size": 0, "sample_titles": [],
                                      "warnings": ["Source file is no longer in this folder"], "errors": []})
        if not files:
            raise ValueError("No JSON files found")
        return {
            "file_count": len(files), "conversation_count": sum(x["conversation_count"] for x in files),
            "message_count": sum(x["message_count"] for x in files),
            "approx_tokens": sum(x["approx_tokens"] for x in files), "files": files,
        }

    def import_path(self, path: str | Path, *, project_title: str | None = None) -> dict[str, Any]:
        if not str(path).strip():
            raise ValueError("Source path is required")
        source = Path(path).resolve()
        if source.is_file():
            return self.import_file(source, project_title=project_title)
        if not source.is_dir():
            raise ValueError("Source path does not exist")
        preview = self.preview_path(source, project_title=project_title)
        if any(item["errors"] for item in preview["files"]):
            raise ValueError("Folder contains invalid sources; inspect preview before importing")
        return {"files": [self.remove_source(item["path"]) if item["status"] == "REMOVED" else
                          self.import_file(item["path"], project_title=project_title) for item in preview["files"]]}

    def remove_source(self, path: str | Path) -> dict[str, Any]:
        if not str(path).strip():
            raise ValueError("Source path is required")
        self.db.initialize()
        resolved = str(Path(path).resolve())
        with self.db.connect() as connection:
            row = connection.execute("SELECT id, project_id FROM source_files WHERE source_path=?", (resolved,)).fetchone()
            if not row:
                raise ValueError("Source not found")
            connection.execute("UPDATE source_files SET status='removed', updated_at=? WHERE id=?", (_utc_now(), row["id"]))
            connection.execute("UPDATE conversations SET active=0 WHERE source_id=?", (row["id"],))
            connection.execute("UPDATE messages SET active=0 WHERE conversation_id IN (SELECT id FROM conversations WHERE source_id=?)", (row["id"],))
            connection.execute("UPDATE fragments SET status='inactive' WHERE conversation_id IN (SELECT id FROM conversations WHERE source_id=?)", (row["id"],))
            connection.execute("UPDATE knowledge_documents SET dirty=1, review_status='stale' WHERE topic_id IN ("
                               "SELECT te.topic_id FROM topic_evidence te JOIN sentence_segments s ON s.id=te.sentence_id "
                               "JOIN messages m ON m.id=s.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.source_id=?)", (row["id"],))
        return {"status": "REMOVED", "source_path": resolved, "project_id": row["project_id"]}

    def import_file(self, path: str | Path, *, project_title: str | None = None) -> dict[str, Any]:
        source, digest, connector, bundle, content = self._read_source(path, project_title)
        return self._store_bundle(bundle, source_path=str(source), source_sha256=digest,
                                  source_type=connector.name, raw_bytes=content)

    def _store_bundle(self, bundle: ImportBundle, *, source_path: str, source_sha256: str,
                      source_type: str = "generic-json", raw_bytes: bytes = b"",
                      project_id: str | None = None) -> dict[str, Any]:
        self.db.initialize()
        with self.db.connect() as connection:
            existing = connection.execute(
                "SELECT project_id, source_path FROM import_runs WHERE source_sha256 = ?",
                (source_sha256,),
            ).fetchone()
            prior = connection.execute("SELECT * FROM source_files WHERE source_path=?", (source_path,)).fetchone()
            if existing and (not prior or (prior["source_sha256"] == source_sha256 and prior["status"] == "active")):
                if not prior and existing["source_path"] != source_path:
                    return {"status": "skipped", "reason": "duplicate_content_other_path", "project_id": existing["project_id"]}
                if not prior:
                    source_id = _id("src", source_path)
                    connection.execute(
                        "INSERT OR IGNORE INTO source_files(id, source_path, project_id, source_sha256, source_type, status, updated_at) "
                        "VALUES(?, ?, ?, ?, ?, 'active', ?)",
                        (source_id, source_path, existing["project_id"], source_sha256, source_type, _utc_now()),
                    )
                    connection.execute("UPDATE conversations SET source_id=? WHERE project_id=? AND source_id IS NULL",
                                       (source_id, existing["project_id"]))
                else:
                    source_id = prior["id"]
                connection.execute("INSERT OR IGNORE INTO source_versions(source_id, source_sha256, raw_bytes, imported_at) VALUES(?, ?, ?, ?)",
                                   (source_id, source_sha256, raw_bytes, _utc_now()))
                return {"status": "skipped", "reason": "duplicate_source", "project_id": existing["project_id"]}

            project_key = bundle.external_project_id or source_path
            project_id = project_id or (prior["project_id"] if prior else _id("prj", bundle.provider, project_key))
            source_id = prior["id"] if prior else _id("src", source_path)
            register_run = not existing or existing["source_path"] == source_path
            run_id = _id("imp", source_sha256)
            if register_run:
                connection.execute(
                    "INSERT INTO import_runs(id, source_path, source_sha256, provider, status, imported_at, project_id) "
                    "VALUES(?, ?, ?, ?, 'running', ?, ?) ON CONFLICT(source_sha256) DO UPDATE SET "
                    "source_path=excluded.source_path, status='running', imported_at=excluded.imported_at, project_id=excluded.project_id",
                    (run_id, source_path, source_sha256, bundle.provider, _utc_now(), project_id),
                )
            connection.execute(
                "INSERT OR IGNORE INTO projects(id, provider, external_id, title, source_sha256, created_at) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (project_id, bundle.provider, bundle.external_project_id, bundle.project_title, source_sha256, _utc_now()),
            )
            if prior:
                connection.execute("UPDATE conversations SET active=0 WHERE source_id=?", (source_id,))
                connection.execute("UPDATE messages SET active=0 WHERE conversation_id IN (SELECT id FROM conversations WHERE source_id=?)", (source_id,))
                connection.execute("UPDATE fragments SET status='inactive' WHERE conversation_id IN (SELECT id FROM conversations WHERE source_id=?)", (source_id,))
                connection.execute("UPDATE knowledge_documents SET dirty=1, review_status='stale' WHERE topic_id IN ("
                                   "SELECT te.topic_id FROM topic_evidence te JOIN sentence_segments s ON s.id=te.sentence_id "
                                   "JOIN messages m ON m.id=s.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.source_id=?)", (source_id,))
            connection.execute(
                "INSERT INTO source_files(id, source_path, project_id, source_sha256, source_type, status, updated_at) "
                "VALUES(?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(source_path) DO UPDATE SET "
                "source_sha256=excluded.source_sha256, source_type=excluded.source_type, status='active', updated_at=excluded.updated_at",
                (source_id, source_path, project_id, source_sha256, source_type, _utc_now()),
            )
            connection.execute("INSERT OR IGNORE INTO source_versions(source_id, source_sha256, raw_bytes, imported_at) VALUES(?, ?, ?, ?)",
                               (source_id, source_sha256, raw_bytes, _utc_now()))

            message_count = 0
            sentence_count = 0
            question_count = 0
            answer_count = 0
            for conversation in bundle.conversations:
                versioned_external_id = f"{conversation.external_id}@{source_sha256[:12]}"
                conversation_id = _id("cnv", project_id, versioned_external_id)
                connection.execute(
                    "INSERT OR IGNORE INTO conversations(id, project_id, external_id, title, created_at) "
                    "VALUES(?, ?, ?, ?, ?)",
                    (conversation_id, project_id, versioned_external_id, conversation.title, conversation.created_at),
                )
                connection.execute("UPDATE conversations SET source_id=?, source_sha256=?, active=1, title=? WHERE id=?",
                                   (source_id, source_sha256, conversation.title, conversation_id))
                message_ids: dict[str, str] = {}
                role_by_external_id: dict[str, str] = {}
                for ordinal, message in enumerate(conversation.messages):
                    message_id = _id("msg", conversation_id, message.external_id)
                    message_ids[message.external_id] = message_id
                    role_by_external_id[message.external_id] = message.role
                    connection.execute(
                        "INSERT OR IGNORE INTO messages(id, conversation_id, external_id, parent_external_id, ordinal, role, text, created_at, raw_json) "
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            message_id,
                            conversation_id,
                            message.external_id,
                            message.parent_external_id,
                            ordinal,
                            message.role,
                            message.text,
                            message.created_at,
                            json.dumps(message.raw, ensure_ascii=False, sort_keys=True),
                        ),
                    )
                    connection.execute("UPDATE messages SET active=1, parent_external_id=?, ordinal=?, role=?, text=?, created_at=?, raw_json=? WHERE id=?",
                                       (message.parent_external_id, ordinal, message.role, message.text, message.created_at,
                                        json.dumps(message.raw, ensure_ascii=False, sort_keys=True), message_id))
                    message_count += 1
                    for sentence in split_sentences(message.text):
                        sentence_id = _id("seg", message_id, str(sentence.index))
                        connection.execute(
                            "INSERT OR IGNORE INTO sentence_segments(id, message_id, segment_index, start_offset, end_offset, text, text_sha256) "
                            "VALUES(?, ?, ?, ?, ?, ?, ?)",
                            (
                                sentence_id,
                                message_id,
                                sentence.index,
                                sentence.start,
                                sentence.end,
                                sentence.text,
                                sentence.sha256,
                            ),
                        )
                        sentence_count += 1
                    if message.role == "user":
                        question_id = _id("q", message_id)
                        connection.execute(
                            "INSERT OR IGNORE INTO questions(id, message_id, normalized_text, status, detected_by, created_at) "
                            "VALUES(?, ?, ?, 'open', 'user-turn-v0.1', ?)",
                            (question_id, message_id, _normalize_question(message.text), message.created_at),
                        )
                        question_count += 1

                for message in conversation.messages:
                    if message.role != "assistant" or not message.parent_external_id:
                        continue
                    if role_by_external_id.get(message.parent_external_id) != "user":
                        continue
                    question_message_id = message_ids.get(message.parent_external_id)
                    answer_message_id = message_ids.get(message.external_id)
                    if question_message_id and answer_message_id:
                        question_id = _id("q", question_message_id)
                        connection.execute(
                            "INSERT OR IGNORE INTO question_answers(question_id, answer_message_id) VALUES(?, ?)",
                            (question_id, answer_message_id),
                        )
                        connection.execute("UPDATE questions SET status = 'answered' WHERE id = ?", (question_id,))
                        answer_count += 1

            if register_run:
                connection.execute("UPDATE import_runs SET status = 'completed' WHERE id = ?", (run_id,))
            return {
                "status": "changed" if prior else "imported",
                "project_id": project_id,
                "provider": bundle.provider,
                "conversations": len(bundle.conversations),
                "messages": message_count,
                "sentences": sentence_count,
                "questions": question_count,
                "answers": answer_count,
            }

    def list_projects(self) -> list[dict[str, Any]]:
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT p.*, COUNT(DISTINCT c.id) AS conversation_count, COUNT(DISTINCT m.id) AS message_count "
                "FROM projects p LEFT JOIN conversations c ON c.project_id=p.id AND c.active=1 "
                "LEFT JOIN messages m ON m.conversation_id=c.id AND m.active=1 GROUP BY p.id ORDER BY p.created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def list_conversations(self, project_id: str) -> list[dict[str, Any]]:
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT c.*, COUNT(m.id) AS message_count FROM conversations c "
                "LEFT JOIN messages m ON m.conversation_id=c.id AND m.active=1 WHERE c.project_id=? AND c.active=1 "
                "GROUP BY c.id ORDER BY c.created_at, c.id",
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_questions(self, project_id: str | None = None, *, limit: int = 100) -> list[dict[str, Any]]:
        query = (
            "SELECT q.id, q.normalized_text, q.status, q.created_at, p.id AS project_id, p.title AS project_title, "
            "c.id AS conversation_id, c.title AS conversation_title, m.id AS message_id, "
            "COUNT(qa.answer_message_id) AS answer_count "
            "FROM questions q JOIN messages m ON m.id=q.message_id "
            "JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id "
            "LEFT JOIN question_answers qa ON qa.question_id=q.id "
        )
        params: list[Any] = []
        if project_id:
            query += "WHERE p.id=? AND m.active=1 AND c.active=1 "
            params.append(project_id)
        else:
            query += "WHERE m.active=1 AND c.active=1 "
        query += "GROUP BY q.id ORDER BY q.created_at DESC, q.id LIMIT ?"
        params.append(limit)
        with self.db.connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def search(self, query: str, *, project_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        sql = (
            "SELECT s.id AS sentence_id, s.text, s.start_offset, s.end_offset, s.segment_index, "
            "m.id AS message_id, m.role, c.id AS conversation_id, c.title AS conversation_title, "
            "p.id AS project_id, p.title AS project_title, p.provider "
            "FROM sentence_segments s JOIN messages m ON m.id=s.message_id "
            "JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id "
            "WHERE lower(s.text) LIKE lower(?) AND m.active=1 AND c.active=1 "
        )
        params: list[Any] = [f"%{query}%"]
        if project_id:
            sql += "AND p.id=? "
            params.append(project_id)
        sql += "ORDER BY m.created_at DESC, s.id LIMIT ?"
        params.append(limit)
        with self.db.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def get_message(self, message_id: str) -> dict[str, Any] | None:
        with self.db.connect() as connection:
            row = connection.execute(
                "SELECT m.*, c.title AS conversation_title, c.project_id, p.title AS project_title, "
                "src.source_path, src.source_type, COALESCE(c.source_sha256, p.source_sha256) AS source_sha256 "
                "FROM messages m JOIN conversations c ON c.id=m.conversation_id "
                "JOIN projects p ON p.id=c.project_id LEFT JOIN source_files src ON src.id=c.source_id WHERE m.id=?",
                (message_id,),
            ).fetchone()
        return dict(row) if row else None

    def conversation_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        with self.db.connect() as connection:
            return [dict(row) for row in connection.execute(
                "SELECT id, role, text, ordinal, created_at FROM messages WHERE conversation_id=? AND active=1 ORDER BY ordinal",
                (conversation_id,))]
