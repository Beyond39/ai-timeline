from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from .compiler import KnowledgeCompiler
from .database import Database
from .qa import QAPipeline


class ExperienceService:
    """Read model for the V0.3 local summary and review experience."""

    def __init__(self, database: Database):
        self.db = database
        self.compiler = KnowledgeCompiler(database)
        self.qa = QAPipeline(database)

    def dashboard(self) -> dict[str, Any]:
        self.db.initialize()
        with self.db.connect() as connection:
            counts = {}
            for key, sql in {
                "projects": "SELECT COUNT(*) AS n FROM projects",
                "conversations": "SELECT COUNT(*) AS n FROM conversations WHERE active=1",
                "messages": "SELECT COUNT(*) AS n FROM messages WHERE active=1",
                "qa_units": "SELECT COUNT(*) AS n FROM qa_units u JOIN conversations c ON c.id=u.conversation_id WHERE c.active=1",
                "topics": "SELECT COUNT(*) AS n FROM topics WHERE status!='merged'",
                "documents": "SELECT COUNT(*) AS n FROM knowledge_documents",
            }.items():
                counts[key] = connection.execute(sql).fetchone()["n"]
            counts["pending_documents"] = connection.execute(
                "SELECT COUNT(*) AS n FROM knowledge_documents WHERE review_status='needs_review'"
            ).fetchone()["n"]
            counts["pending_merges"] = connection.execute(
                "SELECT COUNT(*) AS n FROM merge_reviews WHERE status='pending'"
            ).fetchone()["n"]
        return {
            "version": "0.4.2",
            "engine_version": "0.4.2",
            "counts": counts,
            "projects": self._projects(),
            "topics": self.compiler.list_topics(),
            "documents": self.compiler.list_documents(),
        }

    def _projects(self) -> list[dict[str, Any]]:
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT p.id, p.title, p.provider, COUNT(DISTINCT c.id) AS conversation_count, "
                "COUNT(DISTINCT m.id) AS message_count FROM projects p "
                "LEFT JOIN conversations c ON c.project_id=p.id AND c.active=1 LEFT JOIN messages m ON m.conversation_id=c.id AND m.active=1 "
                "GROUP BY p.id ORDER BY p.created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def timeline(self, *, project_id: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        self.db.initialize()
        params: list[Any] = []
        message_where = "WHERE c.active=1 AND m.active=1"
        if project_id:
            message_where += " AND p.id=?"
            params.append(project_id)
        sql = (
            "SELECT 'message' AS kind, m.id AS item_id, m.created_at AS occurred_at, m.role AS label, "
            "substr(m.text, 1, 240) AS detail, p.id AS project_id, p.title AS project_title, "
            "c.id AS conversation_id, c.title AS conversation_title "
            "FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id "
            f"{message_where} ORDER BY occurred_at DESC, item_id DESC LIMIT ?"
        )
        params.append(max(1, min(1000, limit)))
        with self.db.connect() as connection:
            rows = [dict(row) for row in connection.execute(sql, params).fetchall()]
            if not project_id:
                reviews = connection.execute(
                    "SELECT 'review' AS kind, r.id AS item_id, r.created_at AS occurred_at, r.action AS label, "
                    "r.note AS detail, NULL AS project_id, '' AS project_title, NULL AS conversation_id, "
                    "d.title AS conversation_title FROM review_events r "
                    "JOIN knowledge_documents d ON d.id=r.document_id ORDER BY r.created_at DESC LIMIT 50"
                ).fetchall()
                rows.extend(dict(row) for row in reviews)
        def timestamp(item: dict[str, Any]) -> float:
            value = item["occurred_at"]
            if value is None:
                return 0.0
            if isinstance(value, (int, float)):
                return float(value)
            try:
                return datetime.fromisoformat(str(value)).timestamp()
            except ValueError:
                return 0.0

        return sorted(rows, key=timestamp, reverse=True)[:limit]

    def context_package(self, topic_id_or_slug: str) -> dict[str, Any]:
        topic = self.compiler.get_topic(topic_id_or_slug)
        if not topic:
            raise ValueError("Topic not found")
        with self.db.connect() as connection:
            qa_rows = connection.execute(
                "SELECT u.id, u.question_text, u.summary, u.content_sha256, p.title AS project_title, "
                "c.title AS conversation_title FROM qa_units u JOIN qa_evidence qe ON qe.qa_unit_id=u.id "
                "JOIN topic_evidence te ON te.sentence_id=qe.sentence_id "
                "JOIN conversations c ON c.id=u.conversation_id JOIN projects p ON p.id=c.project_id "
                "WHERE te.topic_id=? AND c.active=1 GROUP BY u.id ORDER BY p.title, c.title, u.id",
                (topic["id"],),
            ).fetchall()
        lines = [
            f"# Context Package: {topic['title']}",
            "",
            "> 用途：把经过整理且仍可回到原句的上下文交给另一个 AI。请继续核对证据，不要把 AI 扩展当作原文。",
            "",
            "## 主题摘要",
            "",
            topic["summary"],
            "",
            "## 已归纳 Q/A",
            "",
        ]
        if qa_rows:
            for row in qa_rows:
                lines.extend(
                    [
                        f"### {row['question_text']}",
                        "",
                        row["summary"],
                        "",
                        f"来源：{row['project_title']} / {row['conversation_title']} / Q/A `{row['id']}`",
                        "",
                    ]
                )
        else:
            lines.extend(["当前主题还没有绑定 Q/A 单元。", ""])
        lines.extend(["## 原句证据", ""])
        for index, item in enumerate(topic["evidence"], 1):
            text = re.sub(r"\s+", " ", item["text"]).strip()
            lines.append(
                f"- E{index} [{item['role']}] {text} "
                f"({item['project_title']} / {item['conversation_title']} / `{item['sentence_id']}`)"
            )
        lines.extend(["", "## AI 扩展（非原始证据）", "", topic["ai_extension"] or "无。", ""])
        return {
            "topic_id": topic["id"],
            "topic_slug": topic["slug"],
            "title": topic["title"],
            "qa_unit_count": len(qa_rows),
            "evidence_count": len(topic["evidence"]),
            "content": "\n".join(lines),
        }
