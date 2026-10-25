from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm

import build_guide_pdf as guide


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "V0.1_CHANGELOG_AND_LEARNING.md"
OUTPUT = ROOT / "docs" / "reports" / "GPT-SaaS-v0.1-开发变更与学习指南.pdf"


def draw_cover(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(guide.INK)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(guide.BLUE)
    canvas.circle(width - 10 * mm, height - 9 * mm, 66 * mm, fill=1, stroke=0)
    canvas.setFillColor(guide.CYAN)
    canvas.circle(width - 27 * mm, height - 31 * mm, 27 * mm, fill=1, stroke=0)

    canvas.setFillColor(guide.GOLD)
    canvas.roundRect(23 * mm, height - 55 * mm, 35 * mm, 9 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(guide.INK)
    canvas.setFont("CN", 8)
    canvas.drawCentredString(40.5 * mm, height - 52 * mm, "WORKING BASELINE")

    canvas.setFillColor(colors.white)
    canvas.setFont("CN", 25)
    canvas.drawString(23 * mm, height - 88 * mm, "AI Project Memory")
    canvas.setFont("CN", 21)
    canvas.drawString(23 * mm, height - 104 * mm, "V0.1 开发变更与学习指南")
    canvas.setFillColor(colors.HexColor("#BFD0F5"))
    canvas.setFont("CN", 10.5)
    canvas.drawString(23 * mm, height - 119 * mm, "多 AI 会话导入 · 跨项目检索 · 逐句可追溯 · 本地数据库")

    y = height - 165 * mm
    cards = [
        ("01", "统一导入", "ChatGPT + 通用 AI JSON"),
        ("02", "事实底座", "项目 / 对话 / 消息 / 句子"),
        ("03", "全局查询", "问题目录 + 跨项目检索"),
        ("04", "证据坐标", "原句 ID + 字符起止位置"),
    ]
    for number, title, subtitle in cards:
        canvas.setFillColor(colors.HexColor("#223252"))
        canvas.roundRect(23 * mm, y, 163 * mm, 14 * mm, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(guide.GOLD)
        canvas.setFont("CN", 8)
        canvas.drawString(28 * mm, y + 5 * mm, number)
        canvas.setFillColor(colors.white)
        canvas.setFont("CN", 10)
        canvas.drawString(44 * mm, y + 5 * mm, title)
        canvas.setFillColor(colors.HexColor("#AAB9D2"))
        canvas.setFont("CN", 8)
        canvas.drawRightString(180 * mm, y + 5 * mm, subtitle)
        y -= 18 * mm

    canvas.setFillColor(colors.HexColor("#8392AA"))
    canvas.setFont("CN", 8)
    canvas.drawString(23 * mm, 20 * mm, "版本 0.1.0  |  2026-09-13  |  本地最小可运行数据闭环")
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
    canvas.drawString(20 * mm, height - 11 * mm, "AI Project Memory / V0.1 变更与学习指南")
    canvas.drawRightString(width - 20 * mm, 12 * mm, f"{doc.page - 1:02d}")
    canvas.setFillColor(guide.BLUE)
    canvas.rect(20 * mm, 11.2 * mm, 18 * mm, 1.2, fill=1, stroke=0)
    canvas.restoreState()


if __name__ == "__main__":
    guide.build(
        SOURCE,
        OUTPUT,
        document_title="AI Project Memory V0.1 开发变更与学习指南",
        document_subject="V0.1 代码交付、接口、验证、局限与学习路径",
        cover_draw=draw_cover,
        content_draw=draw_content_page,
    )
