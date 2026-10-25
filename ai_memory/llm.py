from __future__ import annotations

import json
import os
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class LLMProvider(Protocol):
    def generate(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    def structured_generate(self, *, model: str, instructions: str, input_text: str,
                            schema_name: str, schema: dict[str, Any]) -> dict[str, Any]: ...


class OpenAIProvider:
    """Minimal Responses API transport; credentials stay in the environment."""

    def __init__(self, *, api_key: str | None = None, base_url: str | None = None, timeout: int = 90):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required for OpenAI extraction")
        self.endpoint = (base_url or os.getenv("AI_MEMORY_OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/") + "/responses"
        self.timeout = timeout

    def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(self.endpoint, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                          headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                          method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI Responses API returned HTTP {exc.code}: {detail[:1000]}") from exc
        except URLError as exc:
            raise RuntimeError(f"Could not reach the OpenAI Responses API: {exc.reason}") from exc

    def structured_generate(self, *, model: str, instructions: str, input_text: str,
                            schema_name: str, schema: dict[str, Any]) -> dict[str, Any]:
        response = self.generate({"model": model, "store": False, "instructions": instructions,
                                  "input": input_text, "text": {"format": {"type": "json_schema",
                                  "name": schema_name, "strict": True, "schema": schema}}})
        from .extractors.openai_responses import OpenAIResponsesExtractor
        return json.loads(OpenAIResponsesExtractor._output_text(response))
