from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SCHEMA_VERSION = 6

SCHEMA = """
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    project_id TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(provider, external_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at REAL,
    UNIQUE(project_id, external_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    parent_external_id TEXT,
    ordinal INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at REAL,
    raw_json TEXT NOT NULL,
    UNIQUE(conversation_id, external_id)
);

CREATE TABLE IF NOT EXISTS sentence_segments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    UNIQUE(message_id, segment_index)
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    normalized_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    detected_by TEXT NOT NULL,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS question_answers (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relation TEXT NOT NULL DEFAULT 'direct',
    PRIMARY KEY(question_id, answer_message_id)
);

CREATE TABLE IF NOT EXISTS compiler_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    extractor TEXT NOT NULL,
    model TEXT,
    source_fingerprint TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL DEFAULT '',
    output_dir TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    ai_extension TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_evidence (
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    sentence_id TEXT NOT NULL REFERENCES sentence_segments(id) ON DELETE CASCADE,
    compiler_run_id TEXT NOT NULL REFERENCES compiler_runs(id) ON DELETE CASCADE,
    extractor TEXT NOT NULL,
    relevance REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'needs_review',
    current_revision_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    content_sha256 TEXT NOT NULL,
    content TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    compiler_run_id TEXT NOT NULL REFERENCES compiler_runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, revision_no),
    UNIQUE(document_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS review_events (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

-- V0.2.1: durable question/answer knowledge units and deterministic caches.
CREATE TABLE IF NOT EXISTS analysis_cache (
    cache_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    extractor TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_units (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    summary TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    extractor TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'candidate',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(question_id, answer_message_id)
);

CREATE TABLE IF NOT EXISTS qa_evidence (
    qa_unit_id TEXT NOT NULL REFERENCES qa_units(id) ON DELETE CASCADE,
    sentence_id TEXT NOT NULL REFERENCES sentence_segments(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    PRIMARY KEY(qa_unit_id, sentence_id, relation)
);

CREATE TABLE IF NOT EXISTS topic_aliases (
    alias_sha256 TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL UNIQUE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_keywords (
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    PRIMARY KEY(topic_id, keyword)
);

CREATE TABLE IF NOT EXISTS qa_topics (
    qa_unit_id TEXT NOT NULL REFERENCES qa_units(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    confidence REAL NOT NULL,
    assigned_by TEXT NOT NULL,
    PRIMARY KEY(qa_unit_id, topic_id)
);

CREATE TABLE IF NOT EXISTS merge_reviews (
    id TEXT PRIMARY KEY,
    candidate_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    suggested_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    similarity REAL NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolution_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE(candidate_topic_id, suggested_topic_id)
);

CREATE TABLE IF NOT EXISTS source_files (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id),
    source_sha256 TEXT NOT NULL,
    source_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_versions (
    source_id TEXT NOT NULL REFERENCES source_files(id),
    source_sha256 TEXT NOT NULL,
    raw_bytes BLOB NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY(source_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS fragments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    start_ordinal INTEGER NOT NULL,
    end_ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(conversation_id, start_ordinal, end_ordinal)
);

CREATE TABLE IF NOT EXISTS fragment_evidence (
    fragment_id TEXT NOT NULL REFERENCES fragments(id),
    sentence_id TEXT NOT NULL REFERENCES sentence_segments(id),
    PRIMARY KEY(fragment_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS fragment_topics (
    fragment_id TEXT NOT NULL REFERENCES fragments(id),
    topic_id TEXT NOT NULL REFERENCES topics(id),
    PRIMARY KEY(fragment_id, topic_id)
);

CREATE TABLE IF NOT EXISTS fragment_analysis (
    cache_key TEXT PRIMARY KEY,
    fragment_id TEXT NOT NULL REFERENCES fragments(id),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_tree_nodes (
    project_id TEXT NOT NULL REFERENCES projects(id),
    topic_id TEXT NOT NULL REFERENCES topics(id),
    parent_topic_id TEXT REFERENCES topics(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, topic_id)
);

CREATE TABLE IF NOT EXISTS tree_change_proposals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    topic_id TEXT NOT NULL REFERENCES topics(id),
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS topic_insights (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    compiler_run_id TEXT NOT NULL REFERENCES compiler_runs(id)
);

CREATE TABLE IF NOT EXISTS topic_insight_evidence (
    insight_id TEXT NOT NULL REFERENCES topic_insights(id) ON DELETE CASCADE,
    sentence_id TEXT NOT NULL REFERENCES sentence_segments(id),
    PRIMARY KEY(insight_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS semantic_match_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_segment_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_hierarchy_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_review_queue (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    candidate_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fragment_topic_overrides (
    fragment_id TEXT PRIMARY KEY REFERENCES fragments(id),
    topic_id TEXT NOT NULL REFERENCES topics(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    object_id TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    current_result TEXT NOT NULL,
    correction TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fragment_evaluations (
    fragment_id TEXT PRIMARY KEY REFERENCES fragments(id),
    fragment_correct INTEGER,
    topic_correct INTEGER,
    evidence_correct INTEGER,
    summary_supported INTEGER,
    duplicate_topic INTEGER,
    note TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations(project_id);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, ordinal);
CREATE INDEX IF NOT EXISTS segments_message_idx ON sentence_segments(message_id, segment_index);
CREATE INDEX IF NOT EXISTS segments_text_idx ON sentence_segments(text);
CREATE INDEX IF NOT EXISTS questions_created_idx ON questions(created_at);
CREATE INDEX IF NOT EXISTS compiler_runs_fingerprint_idx ON compiler_runs(project_id, extractor, model, source_fingerprint);
CREATE INDEX IF NOT EXISTS topic_evidence_sentence_idx ON topic_evidence(sentence_id);
CREATE INDEX IF NOT EXISTS document_revisions_document_idx ON document_revisions(document_id, revision_no);
CREATE INDEX IF NOT EXISTS review_events_document_idx ON review_events(document_id, created_at);
CREATE INDEX IF NOT EXISTS analysis_cache_conversation_idx ON analysis_cache(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS qa_units_conversation_idx ON qa_units(conversation_id, updated_at);
CREATE INDEX IF NOT EXISTS qa_units_hash_idx ON qa_units(content_sha256);
CREATE INDEX IF NOT EXISTS qa_evidence_sentence_idx ON qa_evidence(sentence_id);
CREATE INDEX IF NOT EXISTS qa_topics_topic_idx ON qa_topics(topic_id, confidence);
CREATE INDEX IF NOT EXISTS merge_reviews_status_idx ON merge_reviews(status, similarity);
CREATE INDEX IF NOT EXISTS source_files_project_idx ON source_files(project_id, status);
CREATE INDEX IF NOT EXISTS fragments_conversation_idx ON fragments(conversation_id, status);
CREATE INDEX IF NOT EXISTS fragment_evidence_sentence_idx ON fragment_evidence(sentence_id);
CREATE INDEX IF NOT EXISTS fragment_topics_topic_idx ON fragment_topics(topic_id);
CREATE INDEX IF NOT EXISTS topic_insights_topic_idx ON topic_insights(topic_id, kind);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(compiler_runs)").fetchall()}
            if "config_fingerprint" not in columns:
                connection.execute(
                    "ALTER TABLE compiler_runs ADD COLUMN config_fingerprint TEXT NOT NULL DEFAULT ''"
                )
            for table, additions in {
                "conversations": (("source_id", "TEXT"), ("source_sha256", "TEXT"),
                                  ("active", "INTEGER NOT NULL DEFAULT 1")),
                "messages": (("active", "INTEGER NOT NULL DEFAULT 1"),),
                "knowledge_documents": (("dirty", "INTEGER NOT NULL DEFAULT 0"),),
            }.items():
                present = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
                for name, definition in additions:
                    if name not in present:
                        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
            connection.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
