from __future__ import annotations

from collections import defaultdict

from .base import EvidenceSentence, TopicCandidate


DEFAULT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("学习方法", ("复习", "回忆", "错题", "记忆", "推导", "反馈", "费曼", "练习", "效率")),
    ("学习规划", ("计划", "时段", "每周", "安排", "目标", "进度", "完成情况", "日程")),
    ("专业课学习", ("专业课", "课程", "考试", "教材")),
    ("高等数学", ("高等数学", "高数", "微积分", "线性代数", "概率", "推导")),
    ("英语学习", ("英语", "单词", "听力", "阅读", "写作", "口语")),
)


class HeuristicExtractor:
    """Deterministic offline baseline.

    The rule set proves the knowledge compilation pipeline without sending
    private conversations to any external model. It is deliberately modest:
    users should review the generated candidates or switch to an LLM extractor.
    """

    name = "heuristic-v0.2"
    model_name = None

    def __init__(self, rules=DEFAULT_RULES):
        self.rules = rules

    def extract(self, sentences: list[EvidenceSentence]) -> list[TopicCandidate]:
        grouped: dict[str, list[EvidenceSentence]] = defaultdict(list)
        keywords_by_title: dict[str, list[str]] = {}
        assigned: set[str] = set()

        for title, keywords in self.rules:
            matched_keywords: set[str] = set()
            for sentence in sentences:
                hits = [keyword for keyword in keywords if keyword.casefold() in sentence.text.casefold()]
                if not hits:
                    continue
                grouped[title].append(sentence)
                assigned.add(sentence.sentence_id)
                matched_keywords.update(hits)
            if matched_keywords:
                keywords_by_title[title] = sorted(matched_keywords)

        # Preserve useful content outside the starter rules by falling back to
        # its original conversation title. Assistant text is preferred because
        # it usually carries the answer rather than only the question.
        for sentence in sentences:
            if sentence.sentence_id in assigned or sentence.role != "assistant":
                continue
            title = sentence.conversation_title.strip() or "未分类主题"
            grouped[title].append(sentence)

        candidates: list[TopicCandidate] = []
        for title, evidence in grouped.items():
            unique = {item.sentence_id: item for item in evidence}
            ordered = sorted(
                unique.values(),
                key=lambda item: (item.project_title, item.conversation_title, item.message_id, item.start_offset),
            )
            conversations = {(item.project_id, item.conversation_id) for item in ordered}
            summary = f"从 {len(ordered)} 条可追溯原句、{len(conversations)} 条对话中整理出与“{title}”相关的内容。"
            extension = (
                "当前由离线规则提取器生成，未调用外部模型。建议重点检查主题边界、重复观点和上下文，"
                "确认后再把它作为稳定知识使用。"
            )
            candidates.append(
                TopicCandidate(
                    title=title,
                    summary=summary,
                    ai_extension=extension,
                    evidence_ids=[item.sentence_id for item in ordered],
                    keywords=keywords_by_title.get(title, []),
                )
            )
        return sorted(candidates, key=lambda item: item.title)
