from __future__ import annotations

from typing import Any

from .base import CanonicalConversation, CanonicalMessage, ImportBundle


class GenericJSONConnector:
    """Provider-neutral interchange format used by V0.1 fixtures and adapters."""

    name = "generic-json"

    def can_read(self, payload: Any) -> bool:
        return isinstance(payload, dict) and isinstance(payload.get("conversations"), list)

    def parse(self, payload: Any, *, project_title: str | None = None) -> ImportBundle:
        if not self.can_read(payload):
            raise ValueError("Expected an object with a conversations array")
        conversations: list[CanonicalConversation] = []
        for conv_index, item in enumerate(payload["conversations"]):
            messages: list[CanonicalMessage] = []
            previous_id: str | None = None
            for msg_index, message in enumerate(item.get("messages") or []):
                external_id = str(message.get("id") or f"message-{conv_index}-{msg_index}")
                messages.append(
                    CanonicalMessage(
                        external_id=external_id,
                        role=str(message.get("role") or "unknown"),
                        text=str(message.get("text") or message.get("content") or "").strip(),
                        created_at=message.get("created_at"),
                        parent_external_id=message.get("parent_id") or previous_id,
                        raw=message,
                    )
                )
                previous_id = external_id
            conversations.append(
                CanonicalConversation(
                    external_id=str(item.get("id") or f"conversation-{conv_index}"),
                    title=str(item.get("title") or f"Untitled conversation {conv_index + 1}"),
                    created_at=item.get("created_at"),
                    messages=[message for message in messages if message.text],
                )
            )
        return ImportBundle(
            provider=str(payload.get("provider") or "generic-llm"),
            external_project_id=(str(payload["project_id"]) if payload.get("project_id") else None),
            project_title=project_title or str(payload.get("project_title") or "Imported AI project"),
            conversations=conversations,
        )

