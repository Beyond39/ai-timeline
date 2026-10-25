from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm

import build_guide_pdf as guide


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "V0.2.1_V0.3_COMBINED_REPORT.md"
OUTPUT = ROOT / "docs" / "reports" / "AI-Project-Memory-v0.2.1-v0.3-联合开发与验收指南.pdf"


def draw_cover(canvas, doc):
    canvas.saveState()
    width, height = A4
    dark = colors.HexColor("#163D2C")
    cream = colors.HexColor("#F4F0E6")
    mint = colors.HexColor("#CBE2D3")
    amber = colors.HexColor("#E8B44D")
    canvas.setFillColor(dark)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#20553E"))
    canvas.circle(width - 8 * mm, height - 12 * mm, 72 * mm, fill=1, stroke=0)
    canvas.setFillColor(mint)
    canvas.circle(width - 26 * mm, height - 34 * mm, 29 * mm, fill=1, stroke=0)

    canvas.setFillColor(amber)
    canvas.roundRect(23 * mm, height - 55 * mm, 49 * mm, 9 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(dark)
    canvas.setFont("CN", 8)
    canvas.drawCentredString(47.5 * mm, height - 52 * mm, "TRUSTED MEMORY PIPELINE")

    canvas.setFillColor(cream)
    canvas.setFont("CN", 24)
    canvas.drawString(23 * mm, height - 88 * mm, "AI Project Memory")
    canvas.setFont("CN", 18)
    canvas.drawString(23 * mm, height - 104 * mm, "V0.2.1 + V0.3 联合开发报告")
    canvas.setFillColor(colors.HexColor("#BFD6C8"))
    canvas.setFont("CN", 10)
    canvas.drawString(23 * mm, height - 120 * mm, "Q/A 单元 · 哈希缓存 · 标签复核 · 总结框 · 时间线 · Context Package")

    y = height - 166 * mm
    cards = [
        ("01", "可信底座", "原始消息不被摘要覆盖"),
        ("02", "逐对话分析", "Q/A 与缓存控制成本"),
        ("03", "人在回路", "相似标签不静默合并"),
        ("04", "本地体验", "总结、证据、时间线一体"),
    ]
    for number, title, subtitle in cards:
        canvas.setFillColor(colors.HexColor("#214C39"))
        canvas.roundRect(23 * mm, y, 163 * mm, 14 * mm, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(amber)
        canvas.setFont("CN", 8)
        canvas.drawString(28 * mm, y + 5 * mm, number)
        canvas.setFillColor(cream)
        canvas.setFont("CN", 10)
        canvas.drawString(44 * mm, y + 5 * mm, title)
        canvas.setFillColor(colors.HexColor("#AFC8B8"))
        canvas.setFont("CN", 8)
        canvas.drawRightString(180 * mm, y + 5 * mm, subtitle)
        y -= 18 * mm

    canvas.setFillColor(colors.HexColor("#9EB8A8"))
    canvas.setFont("CN", 8)
    canvas.drawString(23 * mm, 20 * mm, "版本 0.2.1 / 0.3.0  |  2026-09-13  |  本地产品 Alpha")
    canvas.restoreState()


def draw_content_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    dark = colors.HexColor("#163D2C")
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor("#D7DDD7"))
    canvas.line(20 * mm, height - 15 * mm, width - 20 * mm, height - 15 * mm)
    canvas.setFont("CN", 7.5)
    canvas.setFillColor(colors.HexColor("#66736A"))
    canvas.drawString(20 * mm, height - 11 * mm, "AI Project Memory / V0.2.1 + V0.3 联合开发与验收")
    canvas.drawRightString(width - 20 * mm, 12 * mm, f"{doc.page - 1:02d}")
    canvas.setFillColor(dark)
    canvas.rect(20 * mm, 11.2 * mm, 20 * mm, 1.2, fill=1, stroke=0)
    canvas.restoreState()


if __name__ == "__main__":
    guide.BLUE = colors.HexColor("#1E5A41")
    guide.CYAN = colors.HexColor("#378A66")
    guide.PALE = colors.HexColor("#EDF5EF")
    guide.MINT = colors.HexColor("#E6F1E9")
    guide.build(
        SOURCE,
        OUTPUT,
        document_title="AI Project Memory V0.2.1 + V0.3 联合开发、验收与学习报告",
        document_subject="Q/A 知识单元、哈希缓存、标签复核、本地总结界面、时间线与上下文包",
        cover_draw=draw_cover,
        content_draw=draw_content_page,
    )
