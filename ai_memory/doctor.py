"""Read-only local readiness check for the first real semantic trial."""
from __future__ import annotations

import os
import sqlite3

from .database import Database


def inspect_project(db: Database) -> dict:
    path = db.path.resolve()
    counts = {name: 0 for name in (
        "projects", "active_conversations", "active_fragments", "active_topics",
        "semantic_compiles", "reviewed_fragments", "pending_topic_reviews", "issue_reports",
    )}
    if path.is_file():
        # A URI opened in read-only mode guarantees that this status command
        # cannot create or migrate the user's database.
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
        try:
            present = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            queries = {
                "projects": ("projects", "SELECT COUNT(*) FROM projects"),
                "active_conversations": ("conversations", "SELECT COUNT(*) FROM conversations WHERE active=1"),
                "active_fragments": ("fragments", "SELECT COUNT(*) FROM fragments WHERE status='active'"),
                "active_topics": ("topics", "SELECT COUNT(*) FROM topics WHERE status='active'"),
                "semantic_compiles": ("compiler_runs", "SELECT COUNT(*) FROM compiler_runs WHERE status='completed' AND extractor LIKE '%semantic-match%'"),
                "reviewed_fragments": ("fragment_evaluations", "SELECT COUNT(*) FROM fragment_evaluations"),
                "pending_topic_reviews": ("semantic_review_queue", "SELECT COUNT(*) FROM semantic_review_queue WHERE status='pending'"),
                "issue_reports": ("issue_reports", "SELECT COUNT(*) FROM issue_reports"),
            }
            for name, (table, query) in queries.items():
                if table in present:
                    try:
                        counts[name] = connection.execute(query).fetchone()[0]
                    except sqlite3.OperationalError:
                        # Older schema versions may lack a queried column.
                        pass
        finally:
            connection.close()

    key_set = bool(os.getenv("OPENAI_API_KEY"))
    model_set = bool(os.getenv("AI_MEMORY_MODEL"))
    if not path.is_file() or counts["projects"] == 0:
        stage = "not_started"
        next_action = "打开本地界面，选择文件或粘贴第一段对话。"
    elif counts["active_conversations"] == 0:
        stage = "no_conversations"
        next_action = "给已有项目导入至少三段真实对话。"
    elif not key_set or not model_set:
        stage = "offline_trial"
        next_action = "先核对导入和原文证据；要做 Semantic Compile，再在启动服务前配置 OPENAI_API_KEY 与 AI_MEMORY_MODEL。"
    elif counts["semantic_compiles"] == 0:
        stage = "ready_for_semantic_trial"
        next_action = "在网页选择 Semantic，编译已导入的真实对话。"
    elif counts["reviewed_fragments"] < 20:
        stage = "needs_quality_review"
        next_action = "打开“抽查片段”，完成至少 20 条人工核对；AI 可先整理错误候选。"
    else:
        stage = "quality_review_started"
        next_action = "检查人工抽查结果和待复核主题，再针对主要错误改进模型提示词或分段规则。"
    return {
        "version": "0.4.2",
        "database": str(path),
        "database_exists": path.is_file(),
        "stage": stage,
        "counts": counts,
        "semantic_provider": {"api_key_configured": key_set, "model_configured": model_set},
        "next_action": next_action,
    }
