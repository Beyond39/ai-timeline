from __future__ import annotations

import json
import os
from ..llm import OpenAIProvider

from .base import EvidenceSentence, TopicCandidate


OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["topics"],
    "properties": {
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "summary", "ai_extension", "evidence_ids", "keywords", "claims", "decisions", "open_questions"],
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "ai_extension": {"type": "string"},
                    "evidence_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "claims": {"type": "array", "items": {"$ref": "#/$defs/insight"}},
                    "decisions": {"type": "array", "items": {"$ref": "#/$defs/insight"}},
                    "open_questions": {"type": "array", "items": {"$ref": "#/$defs/insight"}},
                },
            },
        }
    },
    "$defs": {"insight": {"type": "object", "additionalProperties": False,
                            "required": ["text", "evidence_ids"],
                            "properties": {"text": {"type": "string"}, "evidence_ids": {
                            "type": "array", "items": {"type": "string"}}}}},
}


class OpenAIResponsesExtractor:
    """Optional LLM extractor using the OpenAI Responses API.

    No request is made unless the user explicitly selects this extractor.
    The API key remains in the environment and is never written to SQLite.
    """

    name = "openai-responses-v0.2"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: int = 90,
        max_input_chars: int = 120_000,
    ):
        if not model.strip():
            raise ValueError("An explicit OpenAI model is required for the LLM extractor")
        self.model_name = model.strip()
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required when --extractor openai is selected")
        root = base_url or os.getenv("AI_MEMORY_OPENAI_BASE_URL") or "https://api.openai.com/v1"
        self.provider = OpenAIProvider(api_key=self.api_key, base_url=root, timeout=timeout)
        self.max_input_chars = max_input_chars

    def extract(self, sentences: list[EvidenceSentence]) -> list[TopicCandidate]:
        last_error = None
        for attempt in range(2):
            try:
                return self._extract_once(sentences, retry=attempt > 0)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                last_error = exc
        raise ValueError(f"Model output failed validation after retry: {last_error}")

    def _extract_once(self, sentences: list[EvidenceSentence], *, retry: bool = False) -> list[TopicCandidate]:
        allowed_ids = {sentence.sentence_id for sentence in sentences}
        evidence_payload = [
            {
                "sentence_id": item.sentence_id,
                "project": item.project_title,
                "conversation": item.conversation_title,
                "role": item.role,
                "text": item.text,
            }
            for item in sentences
        ]
        serialized = json.dumps(evidence_payload, ensure_ascii=False, separators=(",", ":"))
        if len(serialized) > self.max_input_chars:
            raise ValueError(
                f"Selected evidence is {len(serialized)} characters; limit is {self.max_input_chars}. "
                "Compile one project at a time or increase --max-input-chars intentionally."
            )

        payload = {
            "model": self.model_name,
            "store": False,
            "instructions": (
                "You compile mixed AI conversations into a reusable knowledge tree. Group ideas by semantic topic, "
                "including evidence across different conversations when relevant. Keep summaries faithful to the evidence. "
                "Put genuinely new model-generated context only in ai_extension. Every topic must cite only sentence_id "
                "values present in the input. For claims, decisions and open_questions, include only items explicitly "
                "supported by cited source sentences; return empty arrays otherwise. Return Chinese when the source is primarily Chinese."
                + (" Your previous response was invalid. Return all required fields and cite only supplied sentence IDs." if retry else "")
            ),
            "input": serialized,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "knowledge_topic_candidates",
                    "strict": True,
                    "schema": OUTPUT_SCHEMA,
                }
            },
        }
        response = self._post(payload)
        parsed = json.loads(self._output_text(response))
        candidates: list[TopicCandidate] = []
        if not isinstance(parsed, dict) or not isinstance(parsed.get("topics"), list):
            raise ValueError("Model returned no valid topics array")
        for item in parsed["topics"]:
            if not isinstance(item, dict) or not str(item.get("title", "")).strip() or not str(item.get("summary", "")).strip():
                raise ValueError("Model returned invalid topic title or summary")
            evidence_ids = list(dict.fromkeys(str(value) for value in item.get("evidence_ids", [])))
            unknown = sorted(set(evidence_ids) - allowed_ids)
            if unknown:
                raise ValueError(f"Model returned unknown evidence IDs: {unknown[:5]}")
            if not evidence_ids:
                continue
            insights = {}
            for kind in ("claims", "decisions", "open_questions"):
                values = item.get(kind, [])
                if not isinstance(values, list):
                    raise ValueError(f"Model returned invalid {kind}")
                checked = []
                for value in values:
                    if not isinstance(value, dict) or not str(value.get("text", "")).strip():
                        raise ValueError(f"Model returned invalid {kind} item")
                    cited = [str(identifier) for identifier in value.get("evidence_ids", [])]
                    if not cited or not set(cited) <= set(evidence_ids):
                        raise ValueError(f"Model returned unsupported {kind} evidence")
                    checked.append({"text": str(value["text"]).strip(), "evidence_ids": cited})
                insights[kind] = checked
            candidates.append(
                TopicCandidate(
                    title=str(item["title"]).strip(),
                    summary=str(item["summary"]).strip(),
                    ai_extension=str(item.get("ai_extension") or "").strip(),
                    evidence_ids=evidence_ids,
                    keywords=[str(value).strip() for value in item.get("keywords", []) if str(value).strip()],
                    **insights,
                )
            )
        return candidates

    def _post(self, payload: dict) -> dict:
        return self.provider.generate(payload)

    @staticmethod
    def _output_text(response: dict) -> str:
        if isinstance(response.get("output_text"), str):
            return response["output_text"]
        parts: list[str] = []
        for item in response.get("output") or []:
            if item.get("type") != "message":
                continue
            for content in item.get("content") or []:
                if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    parts.append(content["text"])
        if not parts:
            raise ValueError("Responses API result did not contain output text")
        return "".join(parts)
