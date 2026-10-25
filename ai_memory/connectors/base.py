from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(slots=True)
class CanonicalMessage:
    external_id: str
    role: str
    text: str
    created_at: float | None = None
    parent_external_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CanonicalConversation:
    external_id: str
    title: str
    created_at: float | None
    messages: list[CanonicalMessage]


@dataclass(slots=True)
class ImportBundle:
    provider: str
    external_project_id: str | None
    project_title: str
    conversations: list[CanonicalConversation]


class Connector(Protocol):
    name: str

    def can_read(self, payload: Any) -> bool: ...

    def parse(self, payload: Any, *, project_title: str | None = None) -> ImportBundle: ...

