from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any

from .database import Database
from .extractors.heuristic import DEFAULT_RULES


PROMPT_VERSION = "qa-map-v0.2.1"
EXTRACTOR_NAME = "structural-qa-v0.2.1"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_id(prefix: str, *parts: str) -> str:
    return f"{prefix}_{uuid.uuid5(uuid.NAMESPACE_URL, chr(31).join(parts)).hex}"


def normalize_tag(value: str) -> str:
    """Normalize spelling for exact identity; this is not semantic matching."""
    text = unicodedata.normalize("NFKC", value).casefold().strip()
    return re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE)


def tag_hash(value: str) -> str:
    return hashlib.sha256(normalize_tag(value).encode("utf-8")).hexdigest()


def _content_hash(question: str, answer: str) -> str:
    normalized = "\n".join(re.sub(r"\s+", " ", value).strip() for value in (question, answer))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class QAPipeline:
    """Map conversations into traceable Q/A units, then attach conservative topic labels.

    Hashes provide exact identity and repeatable caching. Similarity only creates a
    review suggestion; it never silently merges two meanings.
    """

    def __init__(self, database: Database, *, similarity_threshold: float = 0.72):
        self.db = database
        self.similarity_threshold = similarity_threshold

    def analyze(self, *, project_id: str | None = None, force: bool = False) -> dict[str, Any]:
        self.db.initialize()
        conversations = self._load_conversations(project_id)
        now = _utc_now()
        created = 0
        updated = 0
        cache_hits = 0
        topic_links = 0
        review_suggestions = 0

        with self.db.connect() as connection:
            for conversation in conversations:
                source_hash = self._conversation_hash(connection, conversation["id"])
                cache_key = self._cache_key(conversation["id"], source_hash)
                cached = connection.execute(
                    "SELECT payload_json FROM analysis_cache WHERE cache_key=?",
                    (cache_key,),
                ).fetchone()
                if cached and not force:
                    cache_hits += 1
                    units = json.loads(cached["payload_json"])
                else:
                    units = self._map_conversation(connection, conversation["id"])
                    connection.execute(
                        "INSERT OR REPLACE INTO analysis_cache(cache_key, conversation_id, extractor, model, "
                        "prompt_version, source_sha256, payload_json, created_at) VALUES(?, ?, ?, NULL, ?, ?, ?, ?)",
                        (
                            cache_key,
                            conversation["id"],
                            EXTRACTOR_NAME,
                            PROMPT_VERSION,
                            source_hash,
                            json.dumps(units, ensure_ascii=False, sort_keys=True),
                            now,
                        ),
                    )

                for unit in units:
                    qa_id = _stable_id("qau", unit["question_id"], unit["answer_message_id"])
                    existed = connection.execute("SELECT 1 FROM qa_units WHERE id=?", (qa_id,)).fetchone()
                    connection.execute(
                        "INSERT INTO qa_units(id, question_id, answer_message_id, conversation_id, question_text, "
                        "answer_text, summary, content_sha256, extractor, model, status, created_at, updated_at) "
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'candidate', ?, ?) "
                        "ON CONFLICT(question_id, answer_message_id) DO UPDATE SET question_text=excluded.question_text, "
                        "answer_text=excluded.answer_text, summary=excluded.summary, content_sha256=excluded.content_sha256, "
                        "extractor=excluded.extractor, updated_at=excluded.updated_at",
                        (
                            qa_id,
                            unit["question_id"],
                            unit["answer_message_id"],
                            conversation["id"],
                            unit["question_text"],
                            unit["answer_text"],
                            unit["summary"],
                            unit["content_sha256"],
                            EXTRACTOR_NAME,
                            now,
                            now,
                        ),
                    )
                    if existed:
                        updated += 1
                    else:
                        created += 1

                    connection.execute("DELETE FROM qa_evidence WHERE qa_unit_id=?", (qa_id,))
                    for relation, sentence_ids in unit["evidence"].items():
                        for sentence_id in sentence_ids:
                            connection.execute(
                                "INSERT INTO qa_evidence(qa_unit_id, sentence_id, relation) VALUES(?, ?, ?)",
                                (qa_id, sentence_id, relation),
                            )

                    connection.execute("DELETE FROM qa_topics WHERE qa_unit_id=?", (qa_id,))
                    for raw_tag in unit["tags"]:
                        topic_id, suggestion_created = self._resolve_tag(connection, raw_tag, now)
                        connection.execute(
                            "INSERT OR IGNORE INTO qa_topics(qa_unit_id, topic_id, confidence, assigned_by) "
                            "VALUES(?, ?, 1.0, ?)",
                            (qa_id, topic_id, EXTRACTOR_NAME),
                        )
                        topic_links += 1
                        review_suggestions += int(suggestion_created)

        return {
            "status": "analyzed",
            "extractor": EXTRACTOR_NAME,
            "prompt_version": PROMPT_VERSION,
            "conversations": len(conversations),
            "qa_units_created": created,
            "qa_units_updated": updated,
            "cache_hits": cache_hits,
            "topic_links": topic_links,
            "merge_reviews_created": review_suggestions,
        }

    def _load_conversations(self, project_id: str | None) -> list[dict[str, Any]]:
        sql = "SELECT c.id, c.title, c.project_id FROM conversations c WHERE c.active=1"
        params: list[Any] = []
        if project_id:
            sql += " AND c.project_id=?"
            params.append(project_id)
        sql += " ORDER BY c.project_id, c.created_at, c.id"
        with self.db.connect() as connection:
            return [dict(row) for row in connection.execute(sql, params).fetchall()]

    @staticmethod
    def _conversation_hash(connection, conversation_id: str) -> str:
        digest = hashlib.sha256()
        rows = connection.execute(
            "SELECT id, role, text FROM messages WHERE conversation_id=? ORDER BY ordinal, id",
            (conversation_id,),
        ).fetchall()
        for row in rows:
            digest.update(row["id"].encode("utf-8"))
            digest.update(b"\0")
            digest.update(row["role"].encode("utf-8"))
            digest.update(b"\0")
            digest.update(row["text"].encode("utf-8"))
            digest.update(b"\0")
        return digest.hexdigest()

    @staticmethod
    def _cache_key(conversation_id: str, source_hash: str) -> str:
        value = "\x1f".join((conversation_id, source_hash, EXTRACTOR_NAME, PROMPT_VERSION, "none"))
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _map_conversation(connection, conversation_id: str) -> list[dict[str, Any]]:
        rows = connection.execute(
            "SELECT q.id AS question_id, q.normalized_text AS question_text, a.id AS answer_message_id, "
            "a.text AS answer_text, c.title AS conversation_title "
            "FROM questions q JOIN messages qm ON qm.id=q.message_id "
            "JOIN question_answers link ON link.question_id=q.id "
            "JOIN messages a ON a.id=link.answer_message_id JOIN conversations c ON c.id=qm.conversation_id "
            "WHERE qm.conversation_id=? AND qm.active=1 AND a.active=1 ORDER BY qm.ordinal, a.ordinal",
            (conversation_id,),
        ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            joined = f"{row['question_text']}\n{row['answer_text']}"
            tags: list[str] = []
            for title, keywords in DEFAULT_RULES:
                if any(keyword.casefold() in joined.casefold() for keyword in keywords):
                    tags.append(title)
            if not tags:
                tags.append(row["conversation_title"].strip() or "未分类主题")
            evidence = {"question": [], "answer": []}
            for item in connection.execute(
                "SELECT s.id, CASE WHEN m.id=? THEN 'answer' ELSE 'question' END AS relation "
                "FROM sentence_segments s JOIN messages m ON m.id=s.message_id "
                "JOIN questions q ON q.message_id=m.id OR m.id=? WHERE q.id=? ORDER BY relation, s.segment_index",
                (row["answer_message_id"], row["answer_message_id"], row["question_id"]),
            ).fetchall():
                evidence[item["relation"]].append(item["id"])
            answer = re.sub(r"\s+", " ", row["answer_text"]).strip()
            result.append(
                {
                    "question_id": row["question_id"],
                    "answer_message_id": row["answer_message_id"],
                    "question_text": row["question_text"],
                    "answer_text": row["answer_text"],
                    "summary": answer[:240] + ("..." if len(answer) > 240 else ""),
                    "content_sha256": _content_hash(row["question_text"], row["answer_text"]),
                    "tags": list(dict.fromkeys(tags)),
                    "evidence": evidence,
                }
            )
        return result

    def _resolve_tag(self, connection, raw_tag: str, now: str) -> tuple[str, bool]:
        normalized = normalize_tag(raw_tag)
        alias_digest = tag_hash(raw_tag)
        alias = connection.execute(
            "SELECT topic_id FROM topic_aliases WHERE alias_sha256=? OR normalized_alias=?",
            (alias_digest, normalized),
        ).fetchone()
        if alias:
            return alias["topic_id"], False

        existing_topics = connection.execute("SELECT id, title FROM topics WHERE status!='merged'").fetchall()
        exact = next((item for item in existing_topics if normalize_tag(item["title"]) == normalized), None)
        if exact:
            topic_id = exact["id"]
        else:
            topic_id = _stable_id("top", normalized or alias_digest[:16])
            slug = re.sub(r"[^\w\u3400-\u9fff]+", "-", raw_tag.strip().casefold()).strip("-_") or alias_digest[:12]
            connection.execute(
                "INSERT OR IGNORE INTO topics(id, slug, title, summary, ai_extension, status, created_at, updated_at) "
                "VALUES(?, ?, ?, ?, '', 'candidate', ?, ?)",
                (topic_id, slug[:80], raw_tag.strip(), "由 Q/A 分析发现的候选主题，等待知识编译与人工确认。", now, now),
            )

        connection.execute(
            "INSERT OR REPLACE INTO topic_aliases(alias_sha256, alias, normalized_alias, topic_id, source, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            (alias_digest, raw_tag.strip(), normalized, topic_id, EXTRACTOR_NAME, now),
        )

        best = None
        for item in existing_topics:
            if item["id"] == topic_id:
                continue
            score = SequenceMatcher(None, normalized, normalize_tag(item["title"])).ratio()
            if best is None or score > best[0]:
                best = (score, item)
        if best and best[0] >= self.similarity_threshold:
            review_id = _stable_id("mrg", topic_id, best[1]["id"])
            cursor = connection.execute(
                "INSERT OR IGNORE INTO merge_reviews(id, candidate_topic_id, suggested_topic_id, similarity, reason, "
                "status, created_at) VALUES(?, ?, ?, ?, ?, 'pending', ?)",
                (review_id, topic_id, best[1]["id"], best[0], "标签文字相似，需要人工判断是否同义。", now),
            )
            return topic_id, cursor.rowcount > 0
        return topic_id, False

    def list_units(self, *, project_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        self.db.initialize()
        sql = (
            "SELECT u.id, u.question_text, u.answer_text, u.summary, u.content_sha256, u.status, u.updated_at, "
            "c.title AS conversation_title, p.id AS project_id, p.title AS project_title, "
            "GROUP_CONCAT(DISTINCT t.title) AS topics "
            "FROM qa_units u JOIN conversations c ON c.id=u.conversation_id JOIN projects p ON p.id=c.project_id "
            "LEFT JOIN qa_topics qt ON qt.qa_unit_id=u.id LEFT JOIN topics t ON t.id=qt.topic_id "
        )
        params: list[Any] = []
        if project_id:
            sql += "WHERE c.active=1 AND p.id=? "
            params.append(project_id)
        else:
            sql += "WHERE c.active=1 "
        sql += "GROUP BY u.id ORDER BY u.updated_at DESC, u.id LIMIT ?"
        params.append(max(1, min(1000, limit)))
        with self.db.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["topics"] = [value for value in (item["topics"] or "").split(",") if value]
            result.append(item)
        return result

    def list_merge_reviews(self, *, status: str = "pending") -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT r.*, candidate.title AS candidate_title, suggested.title AS suggested_title "
                "FROM merge_reviews r JOIN topics candidate ON candidate.id=r.candidate_topic_id "
                "JOIN topics suggested ON suggested.id=r.suggested_topic_id WHERE r.status=? "
                "ORDER BY r.similarity DESC, r.created_at",
                (status,),
            ).fetchall()
        return [dict(row) for row in rows]

    def resolve_merge(self, review_id: str, action: str, *, note: str = "") -> dict[str, Any]:
        if action not in {"merge", "keep_separate"}:
            raise ValueError("action must be merge or keep_separate")
        self.db.initialize()
        now = _utc_now()
        with self.db.connect() as connection:
            review = connection.execute("SELECT * FROM merge_reviews WHERE id=?", (review_id,)).fetchone()
            if not review:
                raise ValueError("Merge review not found")
            if action == "merge":
                source_topic, target_topic = review["candidate_topic_id"], review["suggested_topic_id"]
                connection.execute(
                    "INSERT OR REPLACE INTO qa_topics(qa_unit_id, topic_id, confidence, assigned_by) "
                    "SELECT qa_unit_id, ?, confidence, 'human-merge-v0.2.1' FROM qa_topics WHERE topic_id=?",
                    (review["suggested_topic_id"], review["candidate_topic_id"]),
                )
                connection.execute("DELETE FROM qa_topics WHERE topic_id=?", (review["candidate_topic_id"],))
                connection.execute("INSERT OR IGNORE INTO fragment_topics(fragment_id, topic_id) SELECT fragment_id, ? FROM fragment_topics WHERE topic_id=?",
                                   (target_topic, source_topic))
                connection.execute("DELETE FROM fragment_topics WHERE topic_id=?", (source_topic,))
                connection.execute("INSERT OR IGNORE INTO topic_evidence(topic_id, sentence_id, compiler_run_id, extractor, relevance, created_at) "
                                   "SELECT ?, sentence_id, compiler_run_id, extractor, relevance, created_at FROM topic_evidence WHERE topic_id=?",
                                   (target_topic, source_topic))
                connection.execute("DELETE FROM topic_evidence WHERE topic_id=?", (source_topic,))
                connection.execute("UPDATE topic_insights SET topic_id=? WHERE topic_id=?", (target_topic, source_topic))
                connection.execute("INSERT OR IGNORE INTO topic_tree_nodes(project_id, topic_id, parent_topic_id, updated_at) "
                                   "SELECT project_id, ?, NULL, ? FROM topic_tree_nodes WHERE topic_id=?",
                                   (target_topic, now, source_topic))
                connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=NULL WHERE topic_id=? AND parent_topic_id=?",
                                   (target_topic, source_topic))
                connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=? WHERE parent_topic_id=?",
                                   (target_topic, source_topic))
                connection.execute("DELETE FROM topic_tree_nodes WHERE topic_id=?", (source_topic,))
                connection.execute("UPDATE knowledge_documents SET dirty=1, review_status='stale' WHERE topic_id IN (?, ?)",
                                   (source_topic, target_topic))
                connection.execute(
                    "UPDATE topic_aliases SET topic_id=?, source='human-merge-v0.2.1' WHERE topic_id=?",
                    (review["suggested_topic_id"], review["candidate_topic_id"]),
                )
                connection.execute(
                    "UPDATE topics SET status='merged', updated_at=? WHERE id=?",
                    (now, review["candidate_topic_id"]),
                )
            connection.execute(
                "UPDATE merge_reviews SET status=?, resolution_note=?, resolved_at=? WHERE id=?",
                ("merged" if action == "merge" else "kept_separate", note, now, review_id),
            )
        return {"review_id": review_id, "status": "merged" if action == "merge" else "kept_separate", "note": note}
