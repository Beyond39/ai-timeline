from __future__ import annotations

import json
from typing import Any

from .base import CanonicalConversation, CanonicalMessage, ImportBundle


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content") or {}
    parts = content.get("parts") or []
    texts: list[str] = []
    for part in parts:
        if isinstance(part, str):
            texts.append(part)
        elif isinstance(part, dict):
            value = part.get("text") or part.get("content")
            if isinstance(value, str):
                texts.append(value)
            else:
                texts.append(json.dumps(part, ensure_ascii=False, sort_keys=True))
    return "\n".join(texts).strip()


class ChatGPTConnector:
    """Parses the conversations.json shape found in ChatGPT data exports.

    ChatGPT exports are account-level. For V0.1, users should place the
    conversations they want to treat as one logical project in one JSON file,
    then pass --project-title when importing.
    """

    name = "chatgpt-export"

    def can_read(self, payload: Any) -> bool:
        return (
            isinstance(payload, list)
            and bool(payload)
            and isinstance(payload[0], dict)
            and isinstance(payload[0].get("mapping"), dict)
        )

    def parse(self, payload: Any, *, project_title: str | None = None) -> ImportBundle:
        if not self.can_read(payload):
            raise ValueError("Not a supported ChatGPT conversations export")

        conversations: list[CanonicalConversation] = []
        for index, item in enumerate(payload):
            mapping = item.get("mapping") or {}
            node_to_external_id: dict[str, str] = {}
            for node_id, node in mapping.items():
                message = (node or {}).get("message")
                if isinstance(message, dict):
                    node_to_external_id[str(node_id)] = str(message.get("id") or node_id)
            messages: list[CanonicalMessage] = []
            for node_id, node in mapping.items():
                message = (node or {}).get("message")
                if not isinstance(message, dict):
                    continue
                text = _message_text(message)
                if not text:
                    continue
                author = message.get("author") or {}
                role = str(author.get("role") or "unknown")
                external_id = str(message.get("id") or node_id)
                messages.append(
                    CanonicalMessage(
                        external_id=external_id,
                        role=role,
                        text=text,
                        created_at=message.get("create_time"),
                        parent_external_id=(
                            node_to_external_id.get(str(node.get("parent")), str(node.get("parent")))
                            if node.get("parent")
                            else None
                        ),
                        raw=message,
                    )
                )
            messages.sort(
                key=lambda value: (
                    value.created_at is None,
                    value.created_at or 0,
                    value.external_id,
                )
            )
            conversations.append(
                CanonicalConversation(
                    external_id=str(item.get("id") or item.get("conversation_id") or f"conversation-{index}"),
                    title=str(item.get("title") or f"Untitled conversation {index + 1}"),
                    created_at=item.get("create_time"),
                    messages=messages,
                )
            )

        return ImportBundle(
            provider="openai-chatgpt",
            external_project_id=None,
            project_title=project_title or "Imported ChatGPT project",
            conversations=conversations,
        )
