from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from .database import Database
from .extractors import EvidenceSentence, Extractor, TopicCandidate


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(*parts: str) -> str:
    return "frg_" + uuid.uuid5(uuid.NAMESPACE_URL, "\x1f".join(parts)).hex


class FragmentService:
    """Deterministic user-turn segmentation with sentence-level provenance."""

    def __init__(self, db: Database):
        self.db = db

    def segment(self, project_id: str) -> dict[str, int]:
        self.db.initialize()
        created = reused = 0
        now = _now()
        with self.db.connect() as connection:
            conversations = connection.execute(
                "SELECT id FROM conversations WHERE project_id=? AND active=1 ORDER BY id", (project_id,)
            ).fetchall()
            for conversation in conversations:
                conversation_id = conversation["id"]
                messages = connection.execute(
                    "SELECT id, ordinal, role, text FROM messages WHERE conversation_id=? AND active=1 ORDER BY ordinal",
                    (conversation_id,),
                ).fetchall()
                groups: list[list[Any]] = []
                current: list[Any] = []
                for message in messages:
                    if message["role"] == "user" and current:
                        groups.append(current)
                        current = []
                    current.append(message)
                if current:
                    groups.append(current)
                active_ids = set()
                for group in groups:
                    start, end = group[0]["ordinal"], group[-1]["ordinal"]
                    fragment_id = _id(conversation_id, str(start), str(end))
                    active_ids.add(fragment_id)
                    content = "\n".join(f"{item['role']}: {item['text']}" for item in group)
                    fingerprint = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    previous = connection.execute(
                        "SELECT source_fingerprint FROM fragments WHERE id=?", (fragment_id,)
                    ).fetchone()
                    if previous and previous["source_fingerprint"] == fingerprint:
                        reused += 1
                    else:
                        created += 1
                    connection.execute(
                        "INSERT INTO fragments(id, conversation_id, start_ordinal, end_ordinal, text, source_fingerprint, status, created_at, updated_at) "
                        "VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET "
                        "text=excluded.text, source_fingerprint=excluded.source_fingerprint, status='active', updated_at=excluded.updated_at",
                        (fragment_id, conversation_id, start, end, content, fingerprint, now, now),
                    )
                    connection.execute("DELETE FROM fragment_evidence WHERE fragment_id=?", (fragment_id,))
                    for message in group:
                        for sentence in connection.execute(
                            "SELECT id FROM sentence_segments WHERE message_id=? ORDER BY segment_index", (message["id"],)
                        ).fetchall():
                            connection.execute(
                                "INSERT INTO fragment_evidence(fragment_id, sentence_id) VALUES(?, ?)",
                                (fragment_id, sentence["id"]),
                            )
                for row in connection.execute(
                    "SELECT id FROM fragments WHERE conversation_id=? AND status='active'", (conversation_id,)
                ).fetchall():
                    if row["id"] not in active_ids:
                        connection.execute("UPDATE fragments SET status='inactive', updated_at=? WHERE id=?", (now, row["id"]))
        return {"created_or_changed": created, "cache_eligible": reused, "conversations": len(conversations)}

    def semantic_segment(self, project_id: str, provider, model: str,
                         progress: Callable[[int, int], None] | None = None) -> dict[str, int]:
        """Batch-label user turns, then combine adjacent turns with one semantic topic.

        Boundaries stay on message turns so all source offsets and evidence remain exact.
        """
        schema = {"type": "object", "additionalProperties": False, "required": ["labels"],
                  "properties": {"labels": {"type": "array", "items": {"type": "object",
                  "additionalProperties": False, "required": ["turn", "topic"],
                  "properties": {"turn": {"type": "integer"}, "topic": {"type": "string"}}}}}}
        with self.db.connect() as connection:
            conversations = connection.execute("SELECT id FROM conversations WHERE project_id=? AND active=1 ORDER BY id",
                                               (project_id,)).fetchall()
        merged = cache_hits = 0
        for position, conversation in enumerate(conversations, 1):
            with self.db.connect() as connection:
                turns = [dict(row) for row in connection.execute(
                    "SELECT id, start_ordinal, end_ordinal, text, source_fingerprint FROM fragments "
                    "WHERE conversation_id=? AND status='active' ORDER BY start_ordinal", (conversation["id"],))]
            if len(turns) < 2:
                if progress:
                    progress(position, len(conversations))
                continue
            labels = []
            for start in range(0, len(turns), 16):
                batch = turns[start:start + 16]
                input_data = [{"turn": i, "text": turn["text"][:1600]} for i, turn in enumerate(batch)]
                key = hashlib.sha256(json.dumps({"model": model, "version": 1,
                                                 "turns": [(turn["id"], turn["source_fingerprint"]) for turn in batch]},
                                                sort_keys=True).encode()).hexdigest()
                with self.db.connect() as connection:
                    cached = connection.execute("SELECT payload_json FROM semantic_segment_cache WHERE cache_key=?",
                                                (key,)).fetchone()
                if cached:
                    batch_labels = json.loads(cached["payload_json"])
                    cache_hits += 1
                else:
                    answer = provider.structured_generate(
                        model=model,
                        instructions=("Assign one short, stable semantic topic label to each user turn. "
                                      "Use the same label for adjacent turns continuing the same subject. "
                                      "Change the label only at a genuine topic shift. Preserve the turn indices exactly. "
                                      "A topic may recur after intervening topics."),
                        input_text=json.dumps(input_data, ensure_ascii=False),
                        schema_name="semantic_turn_boundaries", schema=schema)
                    raw = answer.get("labels") if isinstance(answer, dict) else None
                    if not isinstance(raw, list) or len(raw) != len(batch) or any(
                        not isinstance(item, dict) or item.get("turn") != i or not str(item.get("topic", "")).strip()
                        for i, item in enumerate(raw)):
                        raise ValueError("Semantic segmentation returned invalid turn labels")
                    batch_labels = [str(item["topic"]).strip().casefold() for item in raw]
                    with self.db.connect() as connection:
                        connection.execute("INSERT OR IGNORE INTO semantic_segment_cache(cache_key, payload_json, created_at) "
                                           "VALUES(?, ?, ?)", (key, json.dumps(batch_labels, ensure_ascii=False), _now()))
                labels.extend(batch_labels)
            runs: list[list[dict]] = []
            for index, (turn, label) in enumerate(zip(turns, labels)):
                if runs and labels[index - 1] == label:
                    runs[-1].append(turn)
                else:
                    runs.append([turn])
            with self.db.connect() as connection:
                for run in runs:
                    if len(run) < 2:
                        continue
                    start, end = run[0]["start_ordinal"], run[-1]["end_ordinal"]
                    fragment_id = _id(conversation["id"], str(start), str(end))
                    content = "\n".join(turn["text"] for turn in run)
                    fingerprint = hashlib.sha256(content.encode()).hexdigest()
                    connection.execute(
                        "INSERT INTO fragments(id, conversation_id, start_ordinal, end_ordinal, text, source_fingerprint, "
                        "status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?) "
                        "ON CONFLICT(id) DO UPDATE SET text=excluded.text, source_fingerprint=excluded.source_fingerprint, "
                        "status='active', updated_at=excluded.updated_at",
                        (fragment_id, conversation["id"], start, end, content, fingerprint, _now(), _now()))
                    connection.execute("DELETE FROM fragment_evidence WHERE fragment_id=?", (fragment_id,))
                    for turn in run:
                        connection.execute("INSERT OR IGNORE INTO fragment_evidence(fragment_id, sentence_id) "
                                           "SELECT ?, sentence_id FROM fragment_evidence WHERE fragment_id=?",
                                           (fragment_id, turn["id"]))
                        connection.execute("UPDATE fragments SET status='inactive' WHERE id=?", (turn["id"],))
                    merged += 1
            if progress:
                progress(position, len(conversations))
        return {"merged_turn_groups": merged, "segment_cache_hits": cache_hits}

    def list_fragments(self, project_id: str, *, topic_id: str | None = None) -> list[dict[str, Any]]:
        self.db.initialize()
        with self.db.connect() as connection:
            sql = (
                "SELECT f.id, f.conversation_id, c.title AS conversation_title, f.start_ordinal, f.end_ordinal, "
                "f.text, f.source_fingerprint, COUNT(DISTINCT fe.sentence_id) AS evidence_count "
                "FROM fragments f JOIN conversations c ON c.id=f.conversation_id "
                "LEFT JOIN fragment_evidence fe ON fe.fragment_id=f.id "
            )
            params: list[str] = []
            if topic_id:
                sql += "JOIN fragment_topics ft ON ft.fragment_id=f.id AND ft.topic_id=? "
                params.append(topic_id)
            sql += "WHERE c.project_id=? AND c.active=1 AND f.status='active' GROUP BY f.id ORDER BY c.created_at, c.id, f.start_ordinal"
            params.append(project_id)
            return [dict(row) for row in connection.execute(sql, params)]


class FragmentExtractor:
    """Runs an existing extractor on cached fragments, then feeds the existing compiler."""

    def __init__(self, db: Database, project_id: str, delegate: Extractor,
                 progress: Callable[[int, int], None] | None = None):
        self.db = db
        self.project_id = project_id
        self.delegate = delegate
        self.name = "fragment-v0.4.1-" + delegate.name
        self.model_name = delegate.model_name
        self.max_input_chars = getattr(delegate, "max_input_chars", None)
        self.rules = getattr(delegate, "rules", None)
        self.cache_hits = 0
        self.analyzed = 0
        self.progress = progress

    def extract(self, sentences: list[EvidenceSentence]) -> list[TopicCandidate]:
        by_id = {sentence.sentence_id: sentence for sentence in sentences}
        result: list[TopicCandidate] = []
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT f.id, f.source_fingerprint FROM fragments f JOIN conversations c ON c.id=f.conversation_id "
                "WHERE c.project_id=? AND c.active=1 AND f.status='active' ORDER BY c.id, f.start_ordinal",
                (self.project_id,),
            ).fetchall()
            for index, row in enumerate(rows, 1):
                fragment_sentences = [by_id[item["sentence_id"]] for item in connection.execute(
                    "SELECT fe.sentence_id FROM fragment_evidence fe JOIN sentence_segments s ON s.id=fe.sentence_id "
                    "JOIN messages m ON m.id=s.message_id WHERE fe.fragment_id=? ORDER BY m.ordinal, s.segment_index", (row["id"],)
                ).fetchall() if item["sentence_id"] in by_id]
                if not fragment_sentences:
                    continue
                key = hashlib.sha256("\x1f".join((row["id"], row["source_fingerprint"],
                    self.delegate.name, str(self.delegate.model_name), repr(getattr(self.delegate, "rules", None)),
                    str(getattr(self.delegate, "max_input_chars", None)))).encode()).hexdigest()
                cached = connection.execute("SELECT payload_json FROM fragment_analysis WHERE cache_key=?", (key,)).fetchone()
                if cached:
                    self.cache_hits += 1
                    candidates = [TopicCandidate(**item) for item in json.loads(cached["payload_json"])]
                else:
                    request_limit = min(getattr(self.delegate, "max_input_chars", None) or 80_000, 80_000)
                    max_chars = request_limit - min(2_000, request_limit // 4)
                    batches: list[list[EvidenceSentence]] = []
                    batch: list[EvidenceSentence] = []
                    used = 0
                    for sentence in fragment_sentences:
                        estimated = len(sentence.text) + len(sentence.conversation_title) + len(sentence.project_title) + 350
                        if estimated > max_chars:
                            raise ValueError(f"Sentence {sentence.sentence_id} is too large for one model request")
                        if batch and used + estimated > max_chars:
                            batches.append(batch)
                            batch = []
                            used = 0
                        batch.append(sentence)
                        used += estimated
                    if batch:
                        batches.append(batch)
                    candidates = [candidate for batch in batches for candidate in self.delegate.extract(batch)]
                    allowed = {item.sentence_id for item in fragment_sentences}
                    for candidate in candidates:
                        if not set(candidate.evidence_ids) <= allowed:
                            raise ValueError("Extractor cited evidence outside its fragment")
                    connection.execute("INSERT INTO fragment_analysis(cache_key, fragment_id, payload_json, created_at) VALUES(?, ?, ?, ?)",
                        (key, row["id"], json.dumps([vars_candidate(item) for item in candidates], ensure_ascii=False), _now()))
                    self.analyzed += 1
                result.extend(candidates)
                if self.progress:
                    self.progress(index, len(rows))
        if self.delegate.name.startswith("heuristic"):
            grouped: dict[str, TopicCandidate] = {}
            for item in result:
                if item.title not in grouped:
                    grouped[item.title] = TopicCandidate(title=item.title, summary="", ai_extension=item.ai_extension,
                                                         evidence_ids=[], keywords=[])
                grouped[item.title].evidence_ids.extend(item.evidence_ids)
                grouped[item.title].keywords.extend(item.keywords)
            for item in grouped.values():
                item.evidence_ids = list(dict.fromkeys(item.evidence_ids))
                item.keywords = list(dict.fromkeys(item.keywords))
                item.summary = (f"与“{item.title}”相关的 {len(item.evidence_ids)} 条原句已跨片段汇总。"
                                "请结合证据核对具体结论。")
            return list(grouped.values())
        grouped_llm: dict[str, list[TopicCandidate]] = {}
        for item in result:
            grouped_llm.setdefault(item.title, []).append(item)
        combined = []
        for title, items in grouped_llm.items():
            evidence_ids = list(dict.fromkeys(identifier for item in items for identifier in item.evidence_ids))
            summaries = list(dict.fromkeys((item.summary.strip(), tuple(item.evidence_ids[:3]))
                                           for item in items if item.summary.strip()))
            summary = "\n".join(f"- {value} [来源: {', '.join(cited)}]"
                                for value, cited in summaries[:8])
            if len(summaries) > 8:
                summary += f"\n- 另有 {len(summaries) - 8} 个片段摘要，请查看原始证据。"
            combined.append(TopicCandidate(
                title=title, summary=summary, ai_extension="\n".join(list(dict.fromkeys(
                    item.ai_extension.strip() for item in items if item.ai_extension.strip()))[:3]),
                evidence_ids=evidence_ids,
                keywords=list(dict.fromkeys(keyword for item in items for keyword in item.keywords)),
                claims=[insight for item in items for insight in item.claims],
                decisions=[insight for item in items for insight in item.decisions],
                open_questions=[insight for item in items for insight in item.open_questions],
            ))
        return combined


def vars_candidate(item: TopicCandidate) -> dict[str, Any]:
    return {"title": item.title, "summary": item.summary, "ai_extension": item.ai_extension,
            "evidence_ids": item.evidence_ids, "keywords": item.keywords,
            "claims": item.claims, "decisions": item.decisions, "open_questions": item.open_questions}
