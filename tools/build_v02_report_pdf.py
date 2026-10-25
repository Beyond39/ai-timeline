from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm

import build_guide_pdf as guide


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "V0.2_CHANGELOG_AND_LEARNING.md"
OUTPUT = ROOT / "docs" / "reports" / "GPT-SaaS-v0.2-开发变更与学习指南.pdf"


def draw_cover(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(guide.INK)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#6941C6"))
    canvas.circle(width - 12 * mm, height - 9 * mm, 68 * mm, fill=1, stroke=0)
    canvas.setFillColor(guide.CYAN)
    canvas.circle(width - 28 * mm, height - 31 * mm, 27 * mm, fill=1, stroke=0)

    canvas.setFillColor(guide.GOLD)
    canvas.roundRect(23 * mm, height - 55 * mm, 39 * mm, 9 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(guide.INK)
    canvas.setFont("CN", 8)
    canvas.drawCentredString(42.5 * mm, height - 52 * mm, "KNOWLEDGE COMPILER")

    canvas.setFillColor(colors.white)
    canvas.setFont("CN", 25)
    canvas.drawString(23 * mm, height - 88 * mm, "AI Project Memory")
    canvas.setFont("CN", 21)
    canvas.drawString(23 * mm, height - 104 * mm, "V0.2 开发变更与学习指南")
    canvas.setFillColor(colors.HexColor("#D7CCF5"))
    canvas.setFont("CN", 10.5)
    canvas.drawString(23 * mm, height - 119 * mm, "跨对话主题 · 证据绑定 · 知识文件树 · 修订与审核")

    y = height - 165 * mm
    cards = [
        ("01", "跨对话归并", "同一主题突破原始聊天边界"),
        ("02", "证据优先", "每个观点回到句子与消息"),
        ("03", "增量修订", "内容变化才产生新版本"),
        ("04", "人工审核", "模型候选不等于最终事实"),
    ]
    for number, title, subtitle in cards:
        canvas.setFillColor(colors.HexColor("#282D4F"))
        canvas.roundRect(23 * mm, y, 163 * mm, 14 * mm, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(guide.GOLD)
        canvas.setFont("CN", 8)
        canvas.drawString(28 * mm, y + 5 * mm, number)
        canvas.setFillColor(colors.white)
        canvas.setFont("CN", 10)
        canvas.drawString(44 * mm, y + 5 * mm, title)
        canvas.setFillColor(colors.HexColor("#B9B5D8"))
        canvas.setFont("CN", 8)
        canvas.drawRightString(180 * mm, y + 5 * mm, subtitle)
        y -= 18 * mm

    canvas.setFillColor(colors.HexColor("#9893B7"))
    canvas.setFont("CN", 8)
    canvas.drawString(23 * mm, 20 * mm, "版本 0.2.0  |  2026-09-13  |  可追溯知识编译 Alpha")
    canvas.restoreState()


def draw_content_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setStrokeColor(guide.LINE)
    canvas.line(20 * mm, height - 15 * mm, width - 20 * mm, height - 15 * mm)
    canvas.setFont("CN", 7.5)
    canvas.setFillColor(guide.GRAY)
    canvas.drawString(20 * mm, height - 11 * mm, "AI Project Memory / V0.2 变更与学习指南")
    canvas.drawRightString(width - 20 * mm, 12 * mm, f"{doc.page - 1:02d}")
    canvas.setFillColor(colors.HexColor("#6941C6"))
    canvas.rect(20 * mm, 11.2 * mm, 18 * mm, 1.2, fill=1, stroke=0)
    canvas.restoreState()


if __name__ == "__main__":
    guide.build(
        SOURCE,
        OUTPUT,
        document_title="AI Project Memory V0.2 开发变更与学习指南",
        document_subject="V0.2 知识编译、证据、修订、审核、开源成熟度与学习路径",
        cover_draw=draw_cover,
        content_draw=draw_content_page,
    )
