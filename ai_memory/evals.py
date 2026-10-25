from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from typing import Any

from .database import Database
from .tree import ProjectTree


FIELDS = ("check", "project_id", "topic_id", "fragment_id", "sentence_id", "source", "system_output",
          "expected", "verdict", "notes")


def export_review(db: Database, project_id: str, path: str | Path) -> dict[str, Any]:
    """Create human review rows; blank verdicts are never reported as passes."""
    tree = ProjectTree(db)
    nodes = tree.tree(project_id)["nodes"]
    fragments = tree.fragments.list_fragments(project_id)
    rows: list[dict[str, str]] = []
    for fragment in fragments:
        rows.append({"check": "fragmentation", "project_id": project_id,
                     "fragment_id": fragment["id"], "source": fragment["conversation_title"],
                     "system_output": fragment["text"][:1000]})
    with db.connect() as connection:
        assignments = connection.execute(
            "SELECT ft.fragment_id, ft.topic_id, t.title, f.text FROM fragment_topics ft "
            "JOIN topics t ON t.id=ft.topic_id JOIN fragments f ON f.id=ft.fragment_id "
            "JOIN conversations c ON c.id=f.conversation_id WHERE c.project_id=? AND c.active=1 AND f.status='active'",
            (project_id,),
        ).fetchall()
        for item in assignments:
            rows.append({"check": "topic_assignment", "project_id": project_id, "topic_id": item["topic_id"],
                         "fragment_id": item["fragment_id"], "source": item["text"][:500],
                         "system_output": item["title"]})
        reviews = connection.execute(
            "SELECT r.id, r.status, a.title AS candidate, b.title AS suggested "
            "FROM merge_reviews r JOIN topics a ON a.id=r.candidate_topic_id "
            "JOIN topics b ON b.id=r.suggested_topic_id WHERE r.candidate_topic_id IN "
            "(SELECT topic_id FROM topic_tree_nodes WHERE project_id=?)", (project_id,),
        ).fetchall()
        for item in reviews:
            rows.append({"check": "wrong_merge", "project_id": project_id, "source": item["id"],
                         "system_output": f"{item['candidate']} → {item['suggested']} ({item['status']})"})
    rows.append({"check": "missed_merge", "project_id": project_id,
                 "system_output": "人工检查主题树中是否有应合并但未被提示的主题对"})
    for node in nodes:
        detail = tree.topic_detail(project_id, node["id"])
        ids = ",".join(item["sentence_id"] for item in detail["evidence"])
        rows.append({"check": "unsupported_summary", "project_id": project_id, "topic_id": node["id"],
                     "source": ids, "system_output": detail["summary"]})
        for insight in detail["insights"]:
            rows.append({"check": "unsupported_" + insight["kind"], "project_id": project_id,
                         "topic_id": node["id"], "source": ",".join(insight["evidence_ids"]),
                         "system_output": insight["text"]})
        for evidence in detail["evidence"]:
            rows.append({"check": "evidence_correctness", "project_id": project_id, "topic_id": node["id"],
                         "sentence_id": evidence["sentence_id"],
                         "source": f"{evidence['conversation_title']} / {evidence['message_id']}",
                         "system_output": evidence["text"]})
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return {"path": str(destination.resolve()), "rows": len(rows), "checks": dict(Counter(row["check"] for row in rows))}


def review_report(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    counts: dict[str, Counter] = {}
    for row in rows:
        verdict = (row.get("verdict") or "").strip().casefold()
        if verdict not in {"pass", "fail", ""}:
            raise ValueError(f"Invalid verdict: {verdict}")
        counts.setdefault(row["check"], Counter())[verdict or "unreviewed"] += 1
    summaries = {check: dict(counter) for check, counter in counts.items()}
    unsupported = Counter()
    for check, values in counts.items():
        if check.startswith("unsupported_"):
            unsupported.update(values)
    assessed = unsupported["pass"] + unsupported["fail"]
    return {"rows": len(rows), "checks": summaries,
            "unsupported_knowledge_rate": unsupported["fail"] / assessed if assessed else None,
            "unsupported_knowledge_reviewed": assessed}
