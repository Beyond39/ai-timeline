from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Sentence:
    index: int
    start: int
    end: int
    text: str
    sha256: str


_BOUNDARY = re.compile(r"(?<=[。！？!?；;])\s*|\n+")


def split_sentences(text: str) -> list[Sentence]:
    """Split text while retaining exact character offsets for traceability."""
    results: list[Sentence] = []
    cursor = 0
    index = 0
    for match in _BOUNDARY.finditer(text):
        end = match.start()
        raw = text[cursor:end]
        stripped = raw.strip()
        if stripped:
            leading = len(raw) - len(raw.lstrip())
            start_offset = cursor + leading
            end_offset = start_offset + len(stripped)
            results.append(_sentence(index, start_offset, end_offset, stripped))
            index += 1
        cursor = match.end()
    raw = text[cursor:]
    stripped = raw.strip()
    if stripped:
        leading = len(raw) - len(raw.lstrip())
        start_offset = cursor + leading
        results.append(_sentence(index, start_offset, start_offset + len(stripped), stripped))
    return results


def _sentence(index: int, start: int, end: int, text: str) -> Sentence:
    return Sentence(
        index=index,
        start=start,
        end=end,
        text=text,
        sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )

