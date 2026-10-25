from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from .compiler import KnowledgeCompiler
from .database import Database
from .extractors import Extractor
from .fragments import FragmentExtractor, FragmentService
from .semantic import SemanticMatchingExtractor


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectTree:
    def __init__(self, db: Database):
        self.db = db
        self.fragments = FragmentService(db)

    def compile(self, project_id: str, extractor: Extractor, *, force: bool = False,
                output_dir: str = "output/generated/knowledge",
                progress: Callable[[str, int, int], None] | None = None) -> dict[str, Any]:
        self.db.initialize()
        with self.db.connect() as connection:
            if not connection.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
                raise ValueError("Project not found")
        if progress:
            progress("segmenting", 0, 0)
        segmentation = self.fragments.segment(project_id)
        if hasattr(extractor, "provider"):
            semantic_segments = self.fragments.semantic_segment(project_id, extractor.provider, extractor.model_name,
                progress=(lambda done, total: progress("segmenting", done, total)) if progress else None)
            segmentation.update(semantic_segments)
        wrapped = FragmentExtractor(self.db, project_id, extractor,
                                    progress=(lambda done, total: progress("analyzing", done, total)) if progress else None)
        effective = SemanticMatchingExtractor(self.db, project_id, wrapped, progress=progress) if hasattr(extractor, "provider") else wrapped
        if progress:
            progress("compiling", 0, 0)
        result = KnowledgeCompiler(self.db).compile(effective, project_id=project_id, force=force,
                                                     output_dir=output_dir,
                                                     analyze_qa=not hasattr(extractor, "provider"))
        if isinstance(effective, SemanticMatchingExtractor) and effective.aliases_to_add:
            from .qa import normalize_tag, tag_hash
            with self.db.connect() as connection:
                for alias, title in effective.aliases_to_add:
                    target = connection.execute("SELECT id FROM topics WHERE title=? AND status!='merged'", (title,)).fetchone()
                    if target:
                        connection.execute("INSERT OR IGNORE INTO topic_aliases(alias_sha256, alias, normalized_alias, topic_id, source, created_at) "
                                           "VALUES(?, ?, ?, ?, 'semantic-match', ?)",
                                           (tag_hash(alias), alias, normalize_tag(alias), target["id"], _now()))
        if progress:
            progress("building_tree", 0, 0)
        with self.db.connect() as connection:
            connection.execute("DELETE FROM fragment_topics WHERE fragment_id IN ("
                               "SELECT f.id FROM fragments f JOIN conversations c ON c.id=f.conversation_id WHERE c.project_id=?)",
                               (project_id,))
            connection.execute(
                "INSERT OR IGNORE INTO fragment_topics(fragment_id, topic_id) "
                "SELECT DISTINCT f.id, te.topic_id FROM fragments f "
                "JOIN conversations c ON c.id=f.conversation_id JOIN fragment_evidence fe ON fe.fragment_id=f.id "
                "JOIN topic_evidence te ON te.sentence_id=fe.sentence_id "
                "WHERE c.project_id=? AND c.active=1 AND f.status='active'", (project_id,)
            )
            connection.execute("DELETE FROM fragment_topics WHERE fragment_id IN ("
                               "SELECT fragment_id FROM fragment_topic_overrides WHERE fragment_id IN ("
                               "SELECT f.id FROM fragments f JOIN conversations c ON c.id=f.conversation_id WHERE c.project_id=?))",
                               (project_id,))
            connection.execute("INSERT OR IGNORE INTO fragment_topics(fragment_id, topic_id) "
                               "SELECT o.fragment_id, o.topic_id FROM fragment_topic_overrides o "
                               "JOIN fragments f ON f.id=o.fragment_id JOIN conversations c ON c.id=f.conversation_id "
                               "WHERE c.project_id=? AND c.active=1 AND f.status='active'", (project_id,))
            connection.execute(
                "INSERT OR IGNORE INTO topic_tree_nodes(project_id, topic_id, parent_topic_id, updated_at) "
                "SELECT DISTINCT ?, ft.topic_id, NULL, ? FROM fragment_topics ft "
                "JOIN fragments f ON f.id=ft.fragment_id JOIN conversations c ON c.id=f.conversation_id "
                "WHERE c.project_id=? AND f.status='active' AND c.active=1",
                (project_id, _now(), project_id),
            )
            connection.execute(
                "UPDATE knowledge_documents SET dirty=0 WHERE topic_id IN ("
                "SELECT topic_id FROM topic_tree_nodes WHERE project_id=?)", (project_id,)
            )
            self._apply_manual_evidence(connection, project_id)
        hierarchy = self._semantic_hierarchy(project_id, extractor.provider, extractor.model_name) if hasattr(extractor, "provider") else {"suggested_links": 0}
        return {"project_id": project_id, "segmentation": segmentation,
                "fragments_analyzed": wrapped.analyzed, "fragment_cache_hits": wrapped.cache_hits,
                "compilation": result, "hierarchy": hierarchy, "tree": self.tree(project_id)}

    def _semantic_hierarchy(self, project_id: str, provider, model: str) -> dict[str, int]:
        with self.db.connect() as connection:
            project_title = connection.execute("SELECT title FROM projects WHERE id=?", (project_id,)).fetchone()["title"]
            rows = [dict(row) for row in connection.execute(
                "SELECT n.topic_id, n.parent_topic_id, t.title, t.summary FROM topic_tree_nodes n "
                "JOIN topics t ON t.id=n.topic_id WHERE n.project_id=? AND t.status!='merged' ORDER BY t.title",
                (project_id,))]
            manual = {row["topic_id"] for row in connection.execute(
                "SELECT topic_id FROM tree_change_proposals WHERE project_id=? AND action='move' AND status='accepted'",
                (project_id,))}
        if len(rows) < 3 or not any(not row["parent_topic_id"] and row["topic_id"] not in manual for row in rows):
            return {"suggested_links": 0}
        catalog = [{"title": row["title"], "summary": row["summary"][:400]} for row in rows[:40]]
        key = hashlib.sha256(json.dumps({"model": model, "project": project_title, "topics": catalog,
                                         "version": 1}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with self.db.connect() as connection:
            cached = connection.execute("SELECT payload_json FROM semantic_hierarchy_cache WHERE cache_key=?", (key,)).fetchone()
        if cached:
            answer = json.loads(cached["payload_json"])
        else:
            schema = {"type": "object", "additionalProperties": False, "required": ["links"],
                      "properties": {"links": {"type": "array", "items": {"type": "object",
                      "additionalProperties": False, "required": ["child_title", "parent_title", "confidence"],
                      "properties": {"child_title": {"type": "string"}, "parent_title": {"type": "string"},
                      "confidence": {"type": "number"}}}}}}
            answer = provider.structured_generate(
                model=model,
                instructions=("Suggest only clear parent-child relations among the listed project topics. "
                              "Use exact titles from the list. A parent must be broader than its child. "
                              "Return an empty links array if topics are peers or uncertain. Never force a hierarchy."),
                input_text=json.dumps({"project": project_title, "topics": catalog}, ensure_ascii=False),
                schema_name="project_topic_hierarchy", schema=schema)
            if not isinstance(answer, dict) or not isinstance(answer.get("links"), list):
                raise ValueError("Invalid semantic hierarchy result")
            with self.db.connect() as connection:
                connection.execute("INSERT OR IGNORE INTO semantic_hierarchy_cache(cache_key, payload_json, created_at) "
                                   "VALUES(?, ?, ?)", (key, json.dumps(answer, ensure_ascii=False), _now()))
        by_title = {row["title"]: row for row in rows}
        parents = {row["topic_id"]: row["parent_topic_id"] for row in rows}
        changed = 0
        with self.db.connect() as connection:
            for link in answer["links"]:
                if not isinstance(link, dict) or link.get("child_title") not in by_title or link.get("parent_title") not in by_title:
                    continue
                if not isinstance(link.get("confidence"), (int, float)) or link["confidence"] < .85:
                    continue
                child, parent = by_title[link["child_title"]]["topic_id"], by_title[link["parent_title"]]["topic_id"]
                if child == parent or parents[child] or child in manual:
                    continue
                cursor = parent
                seen = {child}
                while cursor and cursor not in seen:
                    seen.add(cursor)
                    cursor = parents.get(cursor)
                if cursor in seen and cursor is not None:
                    continue
                connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=?, updated_at=? WHERE project_id=? AND topic_id=?",
                                   (parent, _now(), project_id, child))
                parents[child] = parent
                changed += 1
        return {"suggested_links": changed}

    @staticmethod
    def _apply_manual_evidence(connection, project_id: str) -> None:
        run = connection.execute("SELECT id FROM compiler_runs WHERE project_id=? AND status IN ('completed', 'running') "
                                 "ORDER BY started_at DESC LIMIT 1", (project_id,)).fetchone()
        if not run:
            return
        overrides = connection.execute("SELECT o.fragment_id, o.topic_id FROM fragment_topic_overrides o "
                                       "JOIN fragments f ON f.id=o.fragment_id JOIN conversations c ON c.id=f.conversation_id "
                                       "WHERE c.project_id=? AND c.active=1 AND f.status='active'", (project_id,)).fetchall()
        for override in overrides:
            evidence = connection.execute("SELECT sentence_id FROM fragment_evidence WHERE fragment_id=?",
                                          (override["fragment_id"],)).fetchall()
            for item in evidence:
                connection.execute("UPDATE knowledge_documents SET dirty=1, review_status='stale' WHERE topic_id IN ("
                                   "SELECT topic_id FROM topic_evidence WHERE sentence_id=? AND topic_id!=?)",
                                   (item["sentence_id"], override["topic_id"]))
                connection.execute("DELETE FROM topic_insight_evidence WHERE sentence_id=? AND insight_id IN ("
                                   "SELECT id FROM topic_insights WHERE topic_id!=?)",
                                   (item["sentence_id"], override["topic_id"]))
                connection.execute("DELETE FROM topic_evidence WHERE sentence_id=? AND topic_id!=?",
                                   (item["sentence_id"], override["topic_id"]))
                connection.execute("INSERT OR IGNORE INTO topic_evidence(topic_id, sentence_id, compiler_run_id, extractor, relevance, created_at) "
                                   "VALUES(?, ?, ?, 'human-correction', 1.0, ?)",
                                   (override["topic_id"], item["sentence_id"], run["id"], _now()))
        connection.execute("DELETE FROM topic_insights WHERE id NOT IN (SELECT insight_id FROM topic_insight_evidence)")

    def tree(self, project_id: str) -> dict[str, Any]:
        self.db.initialize()
        with self.db.connect() as connection:
            project = connection.execute("SELECT id, title FROM projects WHERE id=?", (project_id,)).fetchone()
            if not project:
                raise ValueError("Project not found")
            rows = connection.execute(
                "SELECT n.topic_id AS id, n.parent_topic_id AS parent_id, t.slug, t.title, t.summary, "
                "t.status, t.updated_at, d.review_status, d.dirty, "
                "COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN f.id END) AS fragment_count, "
                "COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN te.sentence_id END) AS evidence_count, "
                "COUNT(DISTINCT c.id) AS conversation_count, "
                "MAX(CASE WHEN a.source LIKE 'human%' THEN 1 ELSE 0 END) AS manual_indicator "
                "FROM topic_tree_nodes n JOIN topics t ON t.id=n.topic_id "
                "LEFT JOIN knowledge_documents d ON d.topic_id=t.id "
                "LEFT JOIN fragment_topics ft ON ft.topic_id=t.id "
                "LEFT JOIN fragments f ON f.id=ft.fragment_id AND f.status='active' "
                "LEFT JOIN conversations c ON c.id=f.conversation_id AND c.active=1 AND c.project_id=n.project_id "
                "LEFT JOIN fragment_evidence fe ON fe.fragment_id=f.id "
                "LEFT JOIN topic_evidence te ON te.topic_id=n.topic_id AND te.sentence_id=fe.sentence_id "
                "LEFT JOIN topic_aliases a ON a.topic_id=n.topic_id "
                "WHERE n.project_id=? AND t.status!='merged' GROUP BY n.topic_id ORDER BY t.title",
                (project_id,),
            ).fetchall()
            nodes = [dict(row) for row in rows]
        return {"project_id": project_id, "title": project["title"], "nodes": nodes}

    def create_topic(self, project_id: str, title: str) -> dict[str, Any]:
        from .qa import QAPipeline
        title = title.strip()
        if not title:
            raise ValueError("Topic title is required")
        self.tree(project_id)
        with self.db.connect() as connection:
            topic_id, _ = QAPipeline(self.db)._resolve_tag(connection, title, _now())
            connection.execute("INSERT OR IGNORE INTO topic_tree_nodes(project_id, topic_id, parent_topic_id, updated_at) VALUES(?, ?, NULL, ?)",
                               (project_id, topic_id, _now()))
        return {"id": topic_id, "title": title}

    def assign_fragment(self, project_id: str, fragment_id: str, topic_id: str) -> dict[str, Any]:
        self.db.initialize()
        with self.db.connect() as connection:
            valid = connection.execute("SELECT 1 FROM fragments f JOIN conversations c ON c.id=f.conversation_id "
                                       "WHERE f.id=? AND c.project_id=? AND c.active=1", (fragment_id, project_id)).fetchone()
            if not valid or not connection.execute("SELECT 1 FROM topic_tree_nodes WHERE project_id=? AND topic_id=?",
                                                   (project_id, topic_id)).fetchone():
                raise ValueError("Fragment or topic not found in project")
            connection.execute("INSERT OR REPLACE INTO fragment_topic_overrides(fragment_id, topic_id, created_at) VALUES(?, ?, ?)",
                               (fragment_id, topic_id, _now()))
            connection.execute("DELETE FROM fragment_topics WHERE fragment_id=?", (fragment_id,))
            connection.execute("INSERT INTO fragment_topics(fragment_id, topic_id) VALUES(?, ?)", (fragment_id, topic_id))
            self._apply_manual_evidence(connection, project_id)
            connection.execute("UPDATE knowledge_documents SET dirty=1, review_status='stale' WHERE topic_id=?", (topic_id,))
        return {"fragment_id": fragment_id, "topic_id": topic_id, "saved": True}

    def report_issue(self, project_id: str, object_id: str, issue_type: str, current_result: str,
                     correction: str) -> dict[str, Any]:
        if issue_type not in {"wrong_fragment", "wrong_topic", "duplicate_topic", "wrong_summary", "broken_evidence", "other"}:
            raise ValueError("Unknown issue type")
        self.tree(project_id)
        issue_id = "iss_" + uuid.uuid4().hex
        with self.db.connect() as connection:
            connection.execute("INSERT INTO issue_reports(id, project_id, object_id, issue_type, current_result, correction, created_at) "
                               "VALUES(?, ?, ?, ?, ?, ?, ?)",
                               (issue_id, project_id, object_id, issue_type, current_result, correction, _now()))
        return {"id": issue_id, "saved": True}

    def evaluate_fragment(self, project_id: str, fragment_id: str, scores: dict[str, Any]) -> dict[str, Any]:
        if not any(item["id"] == fragment_id for item in self.fragments.list_fragments(project_id)):
            raise ValueError("Fragment not found in project")
        keys = ("fragment_correct", "topic_correct", "evidence_correct", "summary_supported", "duplicate_topic")
        if any(scores.get(key) not in (True, False, None) for key in keys):
            raise ValueError("Evaluation scores must be true, false or null")
        with self.db.connect() as connection:
            connection.execute("INSERT OR REPLACE INTO fragment_evaluations(fragment_id, fragment_correct, topic_correct, evidence_correct, "
                               "summary_supported, duplicate_topic, note, reviewed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                               (fragment_id, *(scores.get(key) for key in keys), str(scores.get("note", "")), _now()))
        return {"fragment_id": fragment_id, "saved": True}

    def evaluation_queue(self, project_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.db.connect() as connection:
            return [dict(row) for row in connection.execute(
                "SELECT f.id, f.text, c.title AS conversation_title, e.fragment_correct, e.topic_correct, "
                "e.evidence_correct, e.summary_supported, e.duplicate_topic, e.note "
                "FROM fragments f JOIN conversations c ON c.id=f.conversation_id "
                "LEFT JOIN fragment_evaluations e ON e.fragment_id=f.id "
                "WHERE c.project_id=? AND c.active=1 AND f.status='active' "
                "ORDER BY CASE WHEN e.fragment_id IS NULL THEN 0 ELSE 1 END, c.id, f.start_ordinal LIMIT ?",
                (project_id, max(1, min(limit, 100))))]

    def resolve_semantic_review(self, review_id: str, action: str, topic_id: str | None = None) -> dict[str, Any]:
        if action not in {"attach_existing", "create_new", "ignore"}:
            raise ValueError("Unknown semantic review action")
        from .qa import QAPipeline, normalize_tag, tag_hash
        self.db.initialize()
        with self.db.connect() as connection:
            review = connection.execute("SELECT * FROM semantic_review_queue WHERE id=? AND status='pending'",
                                        (review_id,)).fetchone()
            if not review:
                raise ValueError("Pending review not found")
            candidate = json.loads(review["candidate_json"])
            project_id = review["project_id"]
            if action == "attach_existing":
                if not connection.execute("SELECT 1 FROM topic_tree_nodes WHERE project_id=? AND topic_id=?",
                                          (project_id, topic_id)).fetchone():
                    raise ValueError("Target topic not in project")
            elif action == "create_new":
                topic_id, _ = QAPipeline(self.db)._resolve_tag(connection, candidate["title"], _now())
                connection.execute("UPDATE topics SET summary=?, status='active', updated_at=? WHERE id=?",
                                   (candidate["summary"], _now(), topic_id))
                connection.execute("INSERT OR IGNORE INTO topic_tree_nodes(project_id, topic_id, parent_topic_id, updated_at) "
                                   "VALUES(?, ?, NULL, ?)", (project_id, topic_id, _now()))
            if action != "ignore":
                run = connection.execute("SELECT id FROM compiler_runs WHERE project_id=? AND status='completed' "
                                         "ORDER BY completed_at DESC LIMIT 1", (project_id,)).fetchone()
                if not run:
                    raise ValueError("Compile this project before resolving semantic reviews")
                if action == "attach_existing":
                    connection.execute("INSERT OR IGNORE INTO topic_aliases(alias_sha256, alias, normalized_alias, topic_id, source, created_at) "
                                       "VALUES(?, ?, ?, ?, 'human-semantic-review', ?)",
                                       (tag_hash(candidate["title"]), candidate["title"],
                                        normalize_tag(candidate["title"]), topic_id, _now()))
                for sentence_id in candidate["evidence_ids"]:
                    valid = connection.execute("SELECT 1 FROM sentence_segments s JOIN messages m ON m.id=s.message_id "
                                               "JOIN conversations c ON c.id=m.conversation_id "
                                               "WHERE s.id=? AND c.project_id=? AND c.active=1", (sentence_id, project_id)).fetchone()
                    if not valid:
                        raise ValueError("Review contains evidence outside project")
                    connection.execute("INSERT OR IGNORE INTO topic_evidence(topic_id, sentence_id, compiler_run_id, extractor, relevance, created_at) "
                                       "VALUES(?, ?, ?, 'human-semantic-review', 1.0, ?)",
                                       (topic_id, sentence_id, run["id"], _now()))
                    connection.execute("INSERT OR IGNORE INTO fragment_topics(fragment_id, topic_id) "
                                       "SELECT fe.fragment_id, ? FROM fragment_evidence fe JOIN fragments f ON f.id=fe.fragment_id "
                                       "WHERE fe.sentence_id=? AND f.status='active'", (topic_id, sentence_id))
            connection.execute("UPDATE semantic_review_queue SET status=? WHERE id=?", (action, review_id))
        return {"id": review_id, "status": action, "topic_id": topic_id}

    def topic_detail(self, project_id: str, topic_id: str) -> dict[str, Any]:
        tree = self.tree(project_id)
        node = next((item for item in tree["nodes"] if item["id"] == topic_id or item["slug"] == topic_id), None)
        if not node:
            raise ValueError("Topic not found in project")
        topic = KnowledgeCompiler(self.db).get_topic(node["id"])
        topic["evidence"] = [item for item in topic["evidence"] if item["project_id"] == project_id]
        topic["fragments"] = self.fragments.list_fragments(project_id, topic_id=node["id"])
        with self.db.connect() as connection:
            qa = connection.execute(
                "SELECT DISTINCT u.id, u.question_text, u.summary FROM qa_units u "
                "JOIN qa_evidence qe ON qe.qa_unit_id=u.id JOIN topic_evidence te ON te.sentence_id=qe.sentence_id "
                "JOIN conversations c ON c.id=u.conversation_id "
                "WHERE te.topic_id=? AND c.project_id=? AND c.active=1 ORDER BY u.updated_at DESC LIMIT 100",
                (node["id"], project_id),
            ).fetchall()
            aliases = connection.execute("SELECT alias FROM topic_aliases WHERE topic_id=? ORDER BY alias",
                                         (node["id"],)).fetchall()
            keywords = connection.execute("SELECT keyword FROM topic_keywords WHERE topic_id=? ORDER BY keyword",
                                          (node["id"],)).fetchall()
            insights = connection.execute(
                "SELECT i.id, i.kind, i.text, GROUP_CONCAT(DISTINCT s.id) AS evidence_ids "
                "FROM topic_insights i JOIN topic_insight_evidence ie ON ie.insight_id=i.id "
                "JOIN sentence_segments s ON s.id=ie.sentence_id JOIN messages m ON m.id=s.message_id "
                "JOIN conversations c ON c.id=m.conversation_id "
                "WHERE i.topic_id=? AND c.project_id=? AND c.active=1 AND m.active=1 GROUP BY i.id ORDER BY i.kind, i.text",
                (node["id"], project_id),
            ).fetchall()
        topic["qa_units"] = [dict(item) for item in qa]
        topic["aliases"] = [item["alias"] for item in aliases]
        topic["keywords"] = [item["keyword"] for item in keywords]
        topic["insights"] = [{**dict(item), "evidence_ids": item["evidence_ids"].split(",")} for item in insights]
        topic["tree_node"] = node
        return topic

    def propose(self, project_id: str, topic_id: str, action: str, **payload: Any) -> dict[str, Any]:
        if action not in {"rename", "move", "merge"}:
            raise ValueError("Unsupported tree action")
        tree = self.tree(project_id)
        ids = {node["id"] for node in tree["nodes"]}
        if topic_id not in ids:
            raise ValueError("Topic not found in project")
        if action == "rename" and not str(payload.get("title", "")).strip():
            raise ValueError("New title is required")
        target = payload.get("parent_topic_id") if action == "move" else payload.get("target_topic_id")
        if target is not None and target not in ids:
            raise ValueError("Target topic not found in project")
        if target == topic_id:
            raise ValueError("A topic cannot target itself")
        if action == "merge" and not target:
            raise ValueError("Merge target is required")
        proposal_id = "tcp_" + uuid.uuid4().hex
        with self.db.connect() as connection:
            connection.execute(
                "INSERT INTO tree_change_proposals(id, project_id, topic_id, action, payload_json, created_at) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (proposal_id, project_id, topic_id, action, json.dumps(payload, ensure_ascii=False), _now()),
            )
        return {"id": proposal_id, "status": "pending", "action": action, "topic_id": topic_id, "payload": payload}

    def resolve(self, proposal_id: str, decision: str) -> dict[str, Any]:
        if decision not in {"accept", "reject"}:
            raise ValueError("Decision must be accept or reject")
        self.db.initialize()
        with self.db.connect() as connection:
            row = connection.execute("SELECT * FROM tree_change_proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row or row["status"] != "pending":
                raise ValueError("Pending proposal not found")
            payload = json.loads(row["payload_json"])
            project_id, topic_id = row["project_id"], row["topic_id"]
            now = _now()
            if decision == "accept":
                if row["action"] == "rename":
                    title = str(payload["title"]).strip()
                    if connection.execute("SELECT 1 FROM topics WHERE title=? AND id!=? AND status!='merged'", (title, topic_id)).fetchone():
                        raise ValueError("A topic with this title already exists; use merge")
                    old_title = connection.execute("SELECT title FROM topics WHERE id=?", (topic_id,)).fetchone()["title"]
                    from .qa import normalize_tag, tag_hash
                    connection.execute("INSERT OR IGNORE INTO topic_aliases(alias_sha256, alias, normalized_alias, topic_id, source, created_at) "
                                       "VALUES(?, ?, ?, ?, 'human-rename', ?)",
                                       (tag_hash(old_title), old_title, normalize_tag(old_title), topic_id, now))
                    connection.execute("UPDATE topics SET title=?, updated_at=? WHERE id=?", (title, now, topic_id))
                    connection.execute("UPDATE knowledge_documents SET title=?, review_status='needs_review', dirty=1 WHERE topic_id=?", (title, topic_id))
                elif row["action"] == "move":
                    parent = payload.get("parent_topic_id")
                    ancestors = {topic_id}
                    cursor = parent
                    while cursor:
                        if cursor in ancestors:
                            raise ValueError("Move would create a cycle")
                        ancestors.add(cursor)
                        parent_row = connection.execute(
                            "SELECT parent_topic_id FROM topic_tree_nodes WHERE project_id=? AND topic_id=?", (project_id, cursor)
                        ).fetchone()
                        if not parent_row:
                            raise ValueError("Parent not in project")
                        cursor = parent_row["parent_topic_id"]
                    connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=?, updated_at=? WHERE project_id=? AND topic_id=?",
                                       (parent, now, project_id, topic_id))
                elif row["action"] == "merge":
                    target = payload["target_topic_id"]
                    if not connection.execute("SELECT 1 FROM topic_tree_nodes WHERE project_id=? AND topic_id=?", (project_id, target)).fetchone():
                        raise ValueError("Merge target not found")
                    connection.execute("INSERT OR IGNORE INTO fragment_topics(fragment_id, topic_id) SELECT fragment_id, ? FROM fragment_topics WHERE topic_id=?", (target, topic_id))
                    connection.execute("DELETE FROM fragment_topics WHERE topic_id=?", (topic_id,))
                    connection.execute("UPDATE fragment_topic_overrides SET topic_id=? WHERE topic_id=?", (target, topic_id))
                    connection.execute("INSERT OR IGNORE INTO qa_topics(qa_unit_id, topic_id, confidence, assigned_by) SELECT qa_unit_id, ?, confidence, 'human-tree-merge' FROM qa_topics WHERE topic_id=?", (target, topic_id))
                    connection.execute("DELETE FROM qa_topics WHERE topic_id=?", (topic_id,))
                    connection.execute("INSERT OR IGNORE INTO topic_evidence(topic_id, sentence_id, compiler_run_id, extractor, relevance, created_at) SELECT ?, sentence_id, compiler_run_id, extractor, relevance, created_at FROM topic_evidence WHERE topic_id=?", (target, topic_id))
                    connection.execute("DELETE FROM topic_evidence WHERE topic_id=?", (topic_id,))
                    connection.execute("UPDATE topic_aliases SET topic_id=?, source='human-tree-merge' WHERE topic_id=?", (target, topic_id))
                    connection.execute("INSERT OR IGNORE INTO topic_keywords(topic_id, keyword) SELECT ?, keyword FROM topic_keywords WHERE topic_id=?",
                                       (target, topic_id))
                    connection.execute("DELETE FROM topic_keywords WHERE topic_id=?", (topic_id,))
                    connection.execute("UPDATE topic_insights SET topic_id=? WHERE topic_id=?", (target, topic_id))
                    connection.execute("INSERT OR IGNORE INTO topic_tree_nodes(project_id, topic_id, parent_topic_id, updated_at) "
                                       "SELECT project_id, ?, NULL, ? FROM topic_tree_nodes WHERE topic_id=?", (target, now, topic_id))
                    connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=NULL WHERE topic_id=? AND parent_topic_id=?", (target, topic_id))
                    connection.execute("UPDATE topic_tree_nodes SET parent_topic_id=? WHERE parent_topic_id=?", (target, topic_id))
                    connection.execute("DELETE FROM topic_tree_nodes WHERE topic_id=?", (topic_id,))
                    connection.execute("UPDATE topics SET status='merged', updated_at=? WHERE id=?", (now, topic_id))
                    connection.execute("UPDATE merge_reviews SET status='merged', resolved_at=?, resolution_note='Accepted tree merge' "
                                       "WHERE candidate_topic_id=? AND suggested_topic_id=? AND status='pending'",
                                       (now, topic_id, target))
                    connection.execute("UPDATE knowledge_documents SET review_status='stale', dirty=1 WHERE topic_id IN (?, ?)", (topic_id, target))
                connection.execute("UPDATE topic_tree_nodes SET updated_at=? WHERE project_id=? AND topic_id=?", (now, project_id, topic_id))
            status = "accepted" if decision == "accept" else "rejected"
            connection.execute("UPDATE tree_change_proposals SET status=?, resolved_at=? WHERE id=?", (status, now, proposal_id))
        return {"id": proposal_id, "status": status, "tree": self.tree(project_id)}

    def proposals(self, project_id: str) -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            rows = connection.execute("SELECT * FROM tree_change_proposals WHERE project_id=? ORDER BY created_at DESC", (project_id,)).fetchall()
        return [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]
