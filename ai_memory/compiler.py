from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .database import Database
from .extractors import EvidenceSentence, Extractor, TopicCandidate
from .qa import QAPipeline


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_id(prefix: str, *parts: str) -> str:
    return f"{prefix}_{uuid.uuid5(uuid.NAMESPACE_URL, chr(31).join(parts)).hex}"


def topic_slug(title: str) -> str:
    value = re.sub(r"[^\w\u3400-\u9fff]+", "-", title.strip().casefold(), flags=re.UNICODE).strip("-_")
    if not value:
        value = hashlib.sha256(title.encode("utf-8")).hexdigest()[:12]
    if value.upper() in {"CON", "PRN", "AUX", "NUL", "COM1", "LPT1"}:
        value = f"topic-{value}"
    return value[:80]


class KnowledgeCompiler:
    def __init__(self, database: Database):
        self.db = database

    def compile(
        self,
        extractor: Extractor,
        *,
        output_dir: str | Path = "output/generated/knowledge",
        project_id: str | None = None,
        force: bool = False,
        analyze_qa: bool = True,
    ) -> dict[str, Any]:
        self.db.initialize()
        qa_analysis = QAPipeline(self.db).analyze(project_id=project_id, force=force) if analyze_qa else None
        sentences = self._load_sentences(project_id)
        if not sentences:
            raise ValueError("No sentence evidence found in the selected scope; import conversations first")

        output = Path(output_dir).resolve()
        fingerprint = self._fingerprint(sentences)
        config_fingerprint = self._config_fingerprint(extractor)
        model = extractor.model_name
        with self.db.connect() as connection:
            previous = connection.execute(
                "SELECT id, result_json FROM compiler_runs "
                "WHERE project_id IS ? AND extractor=? AND model IS ? AND source_fingerprint=? AND config_fingerprint=? "
                "AND output_dir=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
                (project_id, extractor.name, model, fingerprint, config_fingerprint, str(output)),
            ).fetchone()
        if previous and not force:
            result = json.loads(previous["result_json"] or "{}")
            return {
                "status": "skipped",
                "reason": "unchanged_source",
                "previous_run_id": previous["id"],
                **result,
            }

        run_id = f"cmp_{uuid.uuid4().hex}"
        started_at = _utc_now()
        with self.db.connect() as connection:
            connection.execute(
                "INSERT INTO compiler_runs(id, project_id, extractor, model, source_fingerprint, config_fingerprint, "
                "output_dir, status, started_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'running', ?)",
                (run_id, project_id, extractor.name, model, fingerprint, config_fingerprint, str(output), started_at),
            )

        try:
            candidates = self._merge_candidates(extractor.extract(sentences))
            result, files = self._persist(
                run_id,
                extractor,
                candidates,
                sentences,
                output,
                project_id,
            )
            for path, content in files:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            self._write_index(output)
            completed = {"run_id": run_id, "output_dir": str(output), "qa_analysis": qa_analysis, **result}
            with self.db.connect() as connection:
                connection.execute(
                    "UPDATE compiler_runs SET status='completed', completed_at=?, result_json=? WHERE id=?",
                    (_utc_now(), json.dumps(completed, ensure_ascii=False, sort_keys=True), run_id),
                )
            return {"status": "compiled", **completed}
        except Exception as exc:
            with self.db.connect() as connection:
                connection.execute(
                    "UPDATE compiler_runs SET status='failed', completed_at=?, result_json=? WHERE id=?",
                    (
                        _utc_now(),
                        json.dumps({"error": type(exc).__name__, "detail": str(exc)}, ensure_ascii=False),
                        run_id,
                    ),
                )
            raise

    def _load_sentences(self, project_id: str | None) -> list[EvidenceSentence]:
        sql = (
            "SELECT s.id AS sentence_id, s.start_offset, s.end_offset, s.text, "
            "m.id AS message_id, m.role, c.id AS conversation_id, c.title AS conversation_title, "
            "p.id AS project_id, p.title AS project_title "
            "FROM sentence_segments s JOIN messages m ON m.id=s.message_id "
            "JOIN conversations c ON c.id=m.conversation_id JOIN projects p ON p.id=c.project_id "
        )
        params: list[Any] = []
        if project_id:
            sql += "WHERE c.active=1 AND m.active=1 AND p.id=? "
            params.append(project_id)
        else:
            sql += "WHERE c.active=1 AND m.active=1 "
        sql += "ORDER BY p.id, c.id, m.ordinal, s.segment_index"
        with self.db.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [EvidenceSentence(**dict(row)) for row in rows]

    @staticmethod
    def _fingerprint(sentences: list[EvidenceSentence]) -> str:
        digest = hashlib.sha256()
        for item in sentences:
            digest.update(item.sentence_id.encode("utf-8"))
            digest.update(b"\0")
            digest.update(item.text.encode("utf-8"))
            digest.update(b"\0")
        return digest.hexdigest()

    @staticmethod
    def _config_fingerprint(extractor: Extractor) -> str:
        config = {
            "extractor": extractor.name,
            "model": extractor.model_name,
            "rules": repr(getattr(extractor, "rules", None)),
            "max_input_chars": getattr(extractor, "max_input_chars", None),
        }
        return hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()

    @staticmethod
    def _merge_candidates(candidates: list[TopicCandidate]) -> list[TopicCandidate]:
        merged: dict[str, TopicCandidate] = {}
        for item in candidates:
            title = item.title.strip()
            if not title or not item.evidence_ids:
                continue
            slug = topic_slug(title)
            if slug not in merged:
                merged[slug] = TopicCandidate(
                    title=title,
                    summary=item.summary.strip(),
                    ai_extension=item.ai_extension.strip(),
                    evidence_ids=list(dict.fromkeys(item.evidence_ids)),
                    keywords=list(dict.fromkeys(item.keywords)),
                    claims=list(item.claims), decisions=list(item.decisions), open_questions=list(item.open_questions),
                )
                continue
            current = merged[slug]
            current.evidence_ids = list(dict.fromkeys(current.evidence_ids + item.evidence_ids))
            current.keywords = list(dict.fromkeys(current.keywords + item.keywords))
            current.claims.extend(item.claims)
            current.decisions.extend(item.decisions)
            current.open_questions.extend(item.open_questions)
            if len(item.summary) > len(current.summary):
                current.summary = item.summary.strip()
            if len(item.ai_extension) > len(current.ai_extension):
                current.ai_extension = item.ai_extension.strip()
        return [merged[key] for key in sorted(merged)]

    def _persist(
        self,
        run_id: str,
        extractor: Extractor,
        candidates: list[TopicCandidate],
        selected_sentences: list[EvidenceSentence],
        output_dir: Path,
        project_id: str | None,
    ) -> tuple[dict[str, Any], list[tuple[Path, str]]]:
        selected = {item.sentence_id: item for item in selected_sentences}
        now = _utc_now()
        files: list[tuple[Path, str]] = []
        revision_count = 0
        evidence_count = 0

        with self.db.connect() as connection:
            scope_sql = (
                "SELECT DISTINCT te.topic_id FROM topic_evidence te "
                "JOIN sentence_segments s ON s.id=te.sentence_id JOIN messages m ON m.id=s.message_id "
                "JOIN conversations c ON c.id=m.conversation_id"
            )
            scope_params: list[Any] = []
            if project_id:
                scope_sql += " WHERE c.project_id=?"
                scope_params.append(project_id)
            old_topic_ids = {row["topic_id"] for row in connection.execute(scope_sql, scope_params).fetchall()}

            if project_id:
                connection.execute(
                    "DELETE FROM topic_insights WHERE id IN (SELECT DISTINCT tie.insight_id FROM topic_insight_evidence tie "
                    "JOIN sentence_segments s ON s.id=tie.sentence_id JOIN messages m ON m.id=s.message_id "
                    "JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=?)", (project_id,)
                )
                connection.execute(
                    "DELETE FROM topic_evidence WHERE sentence_id IN ("
                    "SELECT s.id FROM sentence_segments s JOIN messages m ON m.id=s.message_id "
                    "JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=?"
                    ")",
                    (project_id,),
                )
            else:
                connection.execute("DELETE FROM topic_insights")
                connection.execute("DELETE FROM topic_evidence")

            new_topic_ids: set[str] = set()
            for candidate in candidates:
                slug = topic_slug(candidate.title)
                unknown = sorted(set(candidate.evidence_ids) - set(selected))
                if unknown:
                    raise ValueError(f"Extractor returned evidence outside the selected scope: {unknown[:5]}")
                topic_id, _ = QAPipeline(self.db)._resolve_tag(connection, candidate.title, now)
                for keyword in candidate.keywords:
                    if keyword.strip():
                        connection.execute("INSERT OR IGNORE INTO topic_keywords(topic_id, keyword) VALUES(?, ?)",
                                           (topic_id, keyword.strip()[:100]))
                approved = connection.execute("SELECT 1 FROM knowledge_documents WHERE topic_id=? AND review_status='approved'",
                                              (topic_id,)).fetchone()
                if approved:
                    connection.execute("UPDATE topics SET status='active', updated_at=? WHERE id=?", (now, topic_id))
                else:
                    connection.execute(
                        "UPDATE topics SET summary=?, ai_extension=?, status='active', updated_at=? WHERE id=?",
                        (candidate.summary, candidate.ai_extension, now, topic_id),
                    )
                new_topic_ids.add(topic_id)
                for sentence_id in candidate.evidence_ids:
                    connection.execute(
                        "INSERT INTO topic_evidence(topic_id, sentence_id, compiler_run_id, extractor, relevance, created_at) "
                        "VALUES(?, ?, ?, ?, 1.0, ?) "
                        "ON CONFLICT(topic_id, sentence_id) DO UPDATE SET compiler_run_id=excluded.compiler_run_id, "
                        "extractor=excluded.extractor, relevance=excluded.relevance, created_at=excluded.created_at",
                        (topic_id, sentence_id, run_id, extractor.name, now),
                    )
                    evidence_count += 1
                for kind in ("claims", "decisions", "open_questions"):
                    for insight in getattr(candidate, kind):
                        cited = list(dict.fromkeys(insight.get("evidence_ids", [])))
                        if not cited or not set(cited) <= set(candidate.evidence_ids):
                            raise ValueError(f"Unsupported {kind} evidence")
                        insight_id = _stable_id("ins", run_id, topic_id, kind, insight["text"])
                        connection.execute(
                            "INSERT OR IGNORE INTO topic_insights(id, topic_id, kind, text, compiler_run_id) VALUES(?, ?, ?, ?, ?)",
                            (insight_id, topic_id, kind, insight["text"], run_id),
                        )
                        for sentence_id in cited:
                            connection.execute(
                                "INSERT OR IGNORE INTO topic_insight_evidence(insight_id, sentence_id) VALUES(?, ?)",
                                (insight_id, sentence_id),
                            )

            impacted_topic_ids = old_topic_ids | new_topic_ids
            for topic_id in sorted(impacted_topic_ids):
                evidence = self._topic_evidence(connection, topic_id)
                if not evidence:
                    connection.execute("UPDATE topics SET status='stale', updated_at=? WHERE id=?", (now, topic_id))
                    connection.execute(
                        "UPDATE knowledge_documents SET review_status='stale', updated_at=? WHERE topic_id=?",
                        (now, topic_id),
                    )
                    continue

                topic = connection.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
                relative_path = f"{topic['slug']}/README.md"
                document_id = _stable_id("doc", topic_id)
                existing = connection.execute(
                    "SELECT * FROM knowledge_documents WHERE topic_id=?",
                    (topic_id,),
                ).fetchone()
                review_status = existing["review_status"] if existing else "needs_review"
                content = self._render_document(dict(topic), evidence, extractor.name)
                content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                connection.execute(
                    "INSERT INTO knowledge_documents(id, topic_id, relative_path, title, review_status, created_at, updated_at) "
                    "VALUES(?, ?, ?, ?, 'needs_review', ?, ?) "
                    "ON CONFLICT(topic_id) DO UPDATE SET relative_path=excluded.relative_path, title=excluded.title, "
                    "updated_at=excluded.updated_at",
                    (document_id, topic_id, relative_path, topic["title"], now, now),
                )
                prior_revision = connection.execute(
                    "SELECT id FROM document_revisions WHERE document_id=? AND content_sha256=?",
                    (document_id, content_hash),
                ).fetchone()
                if prior_revision:
                    revision_id = prior_revision["id"]
                else:
                    revision_no = connection.execute(
                        "SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_no FROM document_revisions WHERE document_id=?",
                        (document_id,),
                    ).fetchone()["next_no"]
                    revision_id = _stable_id("rev", document_id, str(revision_no), content_hash)
                    connection.execute(
                        "INSERT INTO document_revisions(id, document_id, revision_no, content_sha256, content, "
                        "generated_by, compiler_run_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                        (revision_id, document_id, revision_no, content_hash, content, extractor.name, run_id, now),
                    )
                    revision_count += 1
                    review_status = "needs_review"
                connection.execute(
                    "UPDATE knowledge_documents SET current_revision_id=?, review_status=?, updated_at=? WHERE id=?",
                    (revision_id, review_status, now, document_id),
                )
                files.append((output_dir / relative_path, content))

        return (
            {
                "extractor": extractor.name,
                "model": extractor.model_name,
                "source_sentences": len(selected_sentences),
                "topics": len(candidates),
                "evidence_links": evidence_count,
                "documents_written": len(files),
                "revisions_created": revision_count,
            },
            files,
        )

    @staticmethod
    def _topic_evidence(connection, topic_id: str) -> list[dict[str, Any]]:
        rows = connection.execute(
            "SELECT s.id AS sentence_id, s.text, s.start_offset, s.end_offset, m.id AS message_id, m.role, "
            "c.id AS conversation_id, c.title AS conversation_title, p.id AS project_id, p.title AS project_title, "
            "src.source_path, src.source_type, COALESCE(c.source_sha256, p.source_sha256) AS source_sha256 "
            "FROM topic_evidence te JOIN sentence_segments s ON s.id=te.sentence_id "
            "JOIN messages m ON m.id=s.message_id JOIN conversations c ON c.id=m.conversation_id "
            "JOIN projects p ON p.id=c.project_id LEFT JOIN source_files src ON src.id=c.source_id "
            "WHERE te.topic_id=? AND c.active=1 AND m.active=1 "
            "ORDER BY p.title, c.title, m.ordinal, s.segment_index",
            (topic_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _render_document(topic: dict[str, Any], evidence: list[dict[str, Any]], extractor_name: str) -> str:
        lines = [
            f"# {topic['title']}",
            "",
            "> 这是由 AI Project Memory V0.3 编译的候选知识文件。核心内容来自可追溯原句；AI 扩展不是原始证据。",
            "",
            "## 核心归纳",
            "",
            topic["summary"],
            "",
            "## 可追溯核心内容",
            "",
        ]
        assistant_evidence = [(index, item) for index, item in enumerate(evidence, 1) if item["role"] == "assistant"]
        user_evidence = [(index, item) for index, item in enumerate(evidence, 1) if item["role"] == "user"]
        for index, item in assistant_evidence:
            clean = re.sub(r"\s+", " ", item["text"]).strip()
            lines.append(f"- {clean} 〔E{index}〕")
        if not assistant_evidence:
            lines.append("- 当前主题只有问题或上下文证据，尚未找到可直接采用的回答内容。")
        if user_evidence:
            lines.extend(["", "## 相关问题", ""])
            for index, item in user_evidence:
                clean = re.sub(r"\s+", " ", item["text"]).strip()
                lines.append(f"- {clean} 〔E{index}〕")
        lines.extend(["", "## AI 扩展（非原始证据）", "", topic["ai_extension"] or "本次没有生成额外扩展。", ""])
        lines.extend(["## 来源与证据坐标", ""])
        for index, item in enumerate(evidence, 1):
            clean = re.sub(r"\s+", " ", item["text"]).strip()
            lines.extend(
                [
                    f"### E{index}",
                    "",
                    f"- 位置：{item['project_title']} / {item['conversation_title']} / {item['role']}",
                    f"- 证据 ID：`{item['sentence_id']}`",
                    f"- 消息 ID：`{item['message_id']}`",
                    f"- 字符位置：`{item['start_offset']}:{item['end_offset']}`",
                    f"- 原句：{clean}",
                    "",
                ]
            )
        lines.extend(
            [
                "## 审核提示",
                "",
                "请确认主题边界、上下文、重复观点与潜在冲突。确认后使用 `review --approve` 记录人工审核。",
                "",
                f"生成器：`{extractor_name}`",
                "",
            ]
        )
        return "\n".join(lines)

    def list_topics(self) -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT t.id, t.slug, t.title, t.summary, t.status, t.updated_at, "
                "COUNT(DISTINCT CASE WHEN c.active=1 AND m.active=1 THEN te.sentence_id END) AS evidence_count, "
                "COUNT(DISTINCT CASE WHEN c.active=1 AND m.active=1 THEN c.id END) AS conversation_count, "
                "COUNT(DISTINCT CASE WHEN c.active=1 AND m.active=1 THEN c.project_id END) AS project_count "
                "FROM topics t LEFT JOIN topic_evidence te ON te.topic_id=t.id "
                "LEFT JOIN sentence_segments s ON s.id=te.sentence_id LEFT JOIN messages m ON m.id=s.message_id "
                "LEFT JOIN conversations c ON c.id=m.conversation_id GROUP BY t.id ORDER BY t.title"
            ).fetchall()
        return [dict(row) for row in rows]

    def list_documents(self) -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT d.*, t.slug AS topic_slug, t.status AS topic_status, "
                "COALESCE(r.revision_no, 0) AS revision_no, COALESCE(e.cnt, 0) AS evidence_count "
                "FROM knowledge_documents d JOIN topics t ON t.id=d.topic_id "
                "LEFT JOIN document_revisions r ON r.id=d.current_revision_id "
                "LEFT JOIN (SELECT topic_id, COUNT(*) AS cnt FROM topic_evidence GROUP BY topic_id) e ON e.topic_id=t.id "
                "ORDER BY d.title"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_topic(self, topic_id_or_slug: str) -> dict[str, Any] | None:
        self.db.initialize()
        with self.db.connect() as connection:
            topic = connection.execute(
                "SELECT * FROM topics WHERE id=? OR slug=?",
                (topic_id_or_slug, topic_id_or_slug),
            ).fetchone()
            if not topic:
                return None
            result = dict(topic)
            result["evidence"] = self._topic_evidence(connection, topic["id"])
            document = connection.execute(
                "SELECT * FROM knowledge_documents WHERE topic_id=?",
                (topic["id"],),
            ).fetchone()
            result["document"] = dict(document) if document else None
            return result

    def list_revisions(self, document_id: str) -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT id, document_id, revision_no, content_sha256, generated_by, compiler_run_id, created_at "
                "FROM document_revisions WHERE document_id=? ORDER BY revision_no DESC",
                (document_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def review(
        self,
        document_or_topic: str,
        action: str,
        *,
        note: str = "",
        output_dir: str | Path = "output/generated/knowledge",
    ) -> dict[str, Any]:
        statuses = {"approve": "approved", "reject": "rejected", "reset": "needs_review"}
        if action not in statuses:
            raise ValueError(f"Unsupported review action: {action}")
        self.db.initialize()
        now = _utc_now()
        with self.db.connect() as connection:
            document = connection.execute(
                "SELECT d.*, t.slug AS topic_slug FROM knowledge_documents d JOIN topics t ON t.id=d.topic_id "
                "WHERE d.id=? OR d.topic_id=? OR t.slug=?",
                (document_or_topic, document_or_topic, document_or_topic),
            ).fetchone()
            if not document:
                raise ValueError("Knowledge document or topic not found")
            status = statuses[action]
            connection.execute(
                "UPDATE knowledge_documents SET review_status=?, updated_at=? WHERE id=?",
                (status, now, document["id"]),
            )
            connection.execute(
                "INSERT INTO review_events(id, document_id, action, note, created_at) VALUES(?, ?, ?, ?, ?)",
                (f"rvw_{uuid.uuid4().hex}", document["id"], action, note, now),
            )
            result = {
                "document_id": document["id"],
                "topic_id": document["topic_id"],
                "topic_slug": document["topic_slug"],
                "review_status": status,
                "note": note,
            }
        self._write_index(Path(output_dir).resolve())
        return result

    def _write_index(self, output_dir: Path) -> None:
        documents = self.list_documents()
        lines = [
            "# AI Project Memory 知识目录",
            "",
            "> 本目录由 V0.3 自动生成。知识文件是候选结果；请优先使用已审核内容。",
            "",
            "| 主题 | 状态 | 证据 | 修订 | 文件 |",
            "|---|---|---:|---:|---|",
        ]
        for item in documents:
            path = item["relative_path"].replace("\\", "/")
            lines.append(
                f"| {item['title']} | {item['review_status']} | {item['evidence_count']} | "
                f"{item['revision_no']} | [{path}]({path}) |"
            )
        lines.append("")
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "README.md").write_text("\n".join(lines), encoding="utf-8")
