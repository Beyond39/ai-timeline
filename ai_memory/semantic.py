"""Small-project semantic topic reconciliation over the existing Topic system."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher

from .database import Database
from .extractors.base import TopicCandidate
from .fragments import vars_candidate


MATCH_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["decision", "selected_titles", "confidence", "reason"],
    "properties": {
        "decision": {"type": "string", "enum": ["ATTACH_EXISTING", "CREATE_NEW", "ATTACH_MULTIPLE", "REVIEW_REQUIRED"]},
        "selected_titles": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number"}, "reason": {"type": "string"},
    },
}


class SemanticMatchingExtractor:
    """Maps extracted candidate titles to existing and in-run topics before compilation."""

    def __init__(self, db: Database, project_id: str, delegate, progress=None):
        self.db, self.project_id, self.delegate = db, project_id, delegate
        self.name = delegate.name + "+semantic-match-v1"
        self.model_name = delegate.model_name
        self.max_input_chars = delegate.max_input_chars
        self.provider = delegate.delegate.provider
        self.progress = progress
        self.review_required = 0
        self.match_cache_hits = 0
        self.aliases_to_add: list[tuple[str, str]] = []

    def extract(self, sentences):
        candidates = self.delegate.extract(sentences)
        with self.db.connect() as connection:
            rows = connection.execute(
                "SELECT t.title, t.summary, t.id FROM topics t JOIN topic_tree_nodes n ON n.topic_id=t.id "
                "WHERE n.project_id=? AND t.status!='merged'", (self.project_id,)).fetchall()
            catalog = {row["title"]: {"summary": row["summary"], "aliases": [], "keywords": [], "id": row["id"]} for row in rows}
            for row in connection.execute("SELECT t.title, a.alias FROM topic_aliases a JOIN topics t ON t.id=a.topic_id "
                                          "JOIN topic_tree_nodes n ON n.topic_id=t.id WHERE n.project_id=? AND t.status!='merged'",
                                          (self.project_id,)):
                catalog[row["title"]]["aliases"].append(row["alias"])
            for row in connection.execute("SELECT t.title, k.keyword FROM topic_keywords k JOIN topics t ON t.id=k.topic_id "
                                          "JOIN topic_tree_nodes n ON n.topic_id=t.id WHERE n.project_id=? AND t.status!='merged'",
                                          (self.project_id,)):
                catalog[row["title"]]["keywords"].append(row["keyword"])
        mapped: list[TopicCandidate] = []
        for index, candidate in enumerate(candidates, 1):
            if self.progress:
                self.progress("matching", index, len(candidates))
            exact = next((title for title, item in catalog.items() if candidate.title.casefold() == title.casefold()
                          or candidate.title.casefold() in {alias.casefold() for alias in item["aliases"]}), None)
            if exact:
                mapped.append(self._rename(candidate, exact))
                continue
            if not catalog:
                mapped.append(candidate)
                catalog[candidate.title] = {"summary": candidate.summary, "aliases": [], "keywords": candidate.keywords, "id": None}
                continue
            ranked = sorted(catalog, key=lambda title: max(
                SequenceMatcher(None, candidate.title.casefold(), title.casefold()).ratio(),
                SequenceMatcher(None, candidate.summary[:160].casefold(), catalog[title]["summary"][:160].casefold()).ratio(),
                len({word.casefold() for word in candidate.keywords} &
                    {word.casefold() for word in catalog[title]["keywords"]}) / max(1, len(candidate.keywords))),
                reverse=True)[:8]
            shortlist = [{"title": title, "aliases": catalog[title]["aliases"][:8],
                          "keywords": catalog[title]["keywords"][:20],
                          "summary": catalog[title]["summary"][:360]} for title in ranked]
            key = hashlib.sha256(json.dumps({"candidate": vars_candidate(candidate), "shortlist": shortlist,
                                             "model": self.model_name, "version": 1},
                                            ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            with self.db.connect() as connection:
                cached = connection.execute("SELECT payload_json FROM semantic_match_cache WHERE cache_key=?", (key,)).fetchone()
            if cached:
                answer = json.loads(cached["payload_json"])
                self.match_cache_hits += 1
            else:
                answer = self.provider.structured_generate(
                    model=self.model_name,
                    instructions=("You reconcile semantic topics within one project. Respect existing names and aliases, "
                                  "especially human renamed topics. Return ATTACH_EXISTING for true synonyms, "
                                  "CREATE_NEW for a clearly distinct topic, ATTACH_MULTIPLE only when both existing topics "
                                  "are independently supported, otherwise REVIEW_REQUIRED. Only choose titles from candidates. "
                                  "Be conservative. Do not use surface spelling alone."),
                    input_text=json.dumps({"new_topic": {"title": candidate.title, "summary": candidate.summary,
                                                         "keywords": candidate.keywords[:20]}, "existing": shortlist},
                                          ensure_ascii=False), schema_name="topic_match_decision", schema=MATCH_SCHEMA)
                self._validate(answer, set(ranked))
                with self.db.connect() as connection:
                    connection.execute("INSERT OR IGNORE INTO semantic_match_cache(cache_key, payload_json, created_at) VALUES(?, ?, ?)",
                                       (key, json.dumps(answer, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
            decision, confidence = answer["decision"], float(answer["confidence"])
            if decision == "CREATE_NEW" and confidence >= 0.75:
                mapped.append(candidate)
                catalog[candidate.title] = {"summary": candidate.summary, "aliases": [], "keywords": candidate.keywords, "id": None}
            elif decision in {"ATTACH_EXISTING", "ATTACH_MULTIPLE"} and confidence >= 0.75:
                for title in answer["selected_titles"]:
                    mapped.append(self._rename(candidate, title))
                if len(answer["selected_titles"]) == 1 and candidate.title != answer["selected_titles"][0]:
                    self.aliases_to_add.append((candidate.title, answer["selected_titles"][0]))
            else:
                self.review_required += 1
                queue_id = "smr_" + hashlib.sha256((self.project_id + key).encode()).hexdigest()[:32]
                with self.db.connect() as connection:
                    connection.execute("INSERT OR IGNORE INTO semantic_review_queue(id, project_id, candidate_json, reason, created_at) "
                                       "VALUES(?, ?, ?, ?, ?)",
                                       (queue_id, self.project_id, json.dumps(vars_candidate(candidate), ensure_ascii=False),
                                        answer.get("reason", "Low confidence"), datetime.now(timezone.utc).isoformat()))
        return mapped

    @staticmethod
    def _rename(candidate: TopicCandidate, title: str) -> TopicCandidate:
        value = vars_candidate(candidate)
        value["title"] = title
        if candidate.title != title:
            value["keywords"] = list(dict.fromkeys([*value["keywords"], candidate.title]))
        return TopicCandidate(**value)

    @staticmethod
    def _validate(answer, titles: set[str]):
        if not isinstance(answer, dict) or answer.get("decision") not in MATCH_SCHEMA["properties"]["decision"]["enum"]:
            raise ValueError("Invalid semantic topic decision")
        selected = answer.get("selected_titles")
        if not isinstance(selected, list) or not all(isinstance(item, str) and item in titles for item in selected):
            raise ValueError("Model selected unknown topic")
        if answer["decision"] in {"ATTACH_EXISTING", "ATTACH_MULTIPLE"} and not selected:
            raise ValueError("Model selected no existing topic")
        if not isinstance(answer.get("confidence"), (float, int)) or not 0 <= answer["confidence"] <= 1:
            raise ValueError("Invalid match confidence")
