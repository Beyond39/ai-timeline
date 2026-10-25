from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(slots=True, frozen=True)
class EvidenceSentence:
    sentence_id: str
    message_id: str
    role: str
    text: str
    start_offset: int
    end_offset: int
    project_id: str
    project_title: str
    conversation_id: str
    conversation_title: str


@dataclass(slots=True)
class TopicCandidate:
    title: str
    summary: str
    ai_extension: str
    evidence_ids: list[str]
    keywords: list[str] = field(default_factory=list)
    claims: list[dict] = field(default_factory=list)
    decisions: list[dict] = field(default_factory=list)
    open_questions: list[dict] = field(default_factory=list)


class Extractor(Protocol):
    name: str
    model_name: str | None

    def extract(self, sentences: list[EvidenceSentence]) -> list[TopicCandidate]: ...
