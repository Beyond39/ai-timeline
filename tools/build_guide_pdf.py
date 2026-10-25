from __future__ import annotations

import html
import os
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "PROJECT_IMPLEMENTATION_GUIDE.md"
OUTPUT = ROOT / "docs" / "reports" / "GPT-SaaS-项目实现指导书.pdf"
FONT = Path(r"C:\Windows\Fonts\simhei.ttf")

INK = colors.HexColor("#17233C")
BLUE = colors.HexColor("#3867D6")
CYAN = colors.HexColor("#2D9CDB")
PALE = colors.HexColor("#EEF4FF")
MINT = colors.HexColor("#E9F8F3")
GOLD = colors.HexColor("#F5B942")
GRAY = colors.HexColor("#5E6B7A")
LINE = colors.HexColor("#D7DFEA")
PAPER = colors.HexColor("#FAFBFD")


def register_fonts() -> None:
    if not FONT.exists():
        raise FileNotFoundError(f"Chinese font not found: {FONT}")
    pdfmetrics.registerFont(TTFont("CN", str(FONT)))


def rich(text: str) -> str:
    value = html.escape(text.strip())
    value = re.sub(r"`([^`]+)`", r'<font name="CN" color="#2457B5">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


class GuideDocTemplate(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and hasattr(flowable, "toc_level"):
            level = flowable.toc_level
            text = flowable.getPlainText()
            key = f"h-{self.page}-{abs(hash((text, self.page))) % 10_000_000}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level, closed=False)
            self.notify("TOCEntry", (level, text, self.page, key))


class ArchitectureDiagram(Flowable):
    def __init__(self, width=168 * mm, height=62 * mm):
        super().__init__()
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFont("CN", 8)
        labels = [
            ("项目来源", "ChatGPT 项目 / 多条混杂对话", colors.HexColor("#E8F0FF")),
            ("双重索引", "原始问答档案 + 知识片段池", colors.HexColor("#EAF8F4")),
            ("知识编译", "跨对话归并 + 文件框架 + 来源", colors.HexColor("#FFF6DF")),
            ("学习视图", "知识文件 / AI 补充 / 演化时间线", colors.HexColor("#F2ECFF")),
        ]
        box_h = 11 * mm
        gap = 4 * mm
        y = self.height - box_h
        for i, (left, right, fill) in enumerate(labels):
            c.setFillColor(fill)
            c.setStrokeColor(LINE)
            c.roundRect(0, y, self.width, box_h, 3 * mm, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont("CN", 9)
            c.drawString(5 * mm, y + 4 * mm, left)
            c.setFillColor(GRAY)
            c.setFont("CN", 8)
            c.drawString(40 * mm, y + 4 * mm, right)
            if i < len(labels) - 1:
                c.setStrokeColor(BLUE)
                c.line(self.width / 2, y, self.width / 2, y - gap + 1 * mm)
                c.line(self.width / 2, y - gap + 1 * mm, self.width / 2 - 1.5 * mm, y - gap + 2.5 * mm)
                c.line(self.width / 2, y - gap + 1 * mm, self.width / 2 + 1.5 * mm, y - gap + 2.5 * mm)
            y -= box_h + gap
        c.restoreState()


def make_styles():
    base = getSampleStyleSheet()
    styles = {
        "body": ParagraphStyle(
            "body", parent=base["BodyText"], fontName="CN", fontSize=9.4,
            leading=15.2, textColor=INK, wordWrap="CJK", spaceAfter=5.5,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Heading1"], fontName="CN", fontSize=18,
            leading=24, textColor=INK, wordWrap="CJK", spaceBefore=12, spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName="CN", fontSize=13,
            leading=18, textColor=BLUE, wordWrap="CJK", spaceBefore=11, spaceAfter=6,
            borderColor=colors.HexColor("#BFD0F5"), borderWidth=0, borderPadding=0,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontName="CN", fontSize=10.8,
            leading=16, textColor=INK, wordWrap="CJK", spaceBefore=8, spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "bullet", parent=base["BodyText"], fontName="CN", fontSize=9.2,
            leading=14.6, leftIndent=13, firstLineIndent=-8, textColor=INK,
            wordWrap="CJK", spaceAfter=3,
        ),
        "small": ParagraphStyle(
            "small", parent=base["BodyText"], fontName="CN", fontSize=7.7,
            leading=11.3, textColor=INK, wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "table_head", parent=base["BodyText"], fontName="CN", fontSize=7.8,
            leading=10.8, textColor=colors.white, wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "table", parent=base["BodyText"], fontName="CN", fontSize=7.6,
            leading=10.7, textColor=INK, wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "code", fontName="CN", fontSize=6.9, leading=10.2,
            leftIndent=7, rightIndent=7, textColor=colors.HexColor("#253B64"),
            backColor=colors.HexColor("#EEF4FF"), borderPadding=7,
        ),
        "toc0": ParagraphStyle(
            "toc0", fontName="CN", fontSize=10, leading=15, leftIndent=0,
            firstLineIndent=0, textColor=INK,
        ),
        "toc1": ParagraphStyle(
            "toc1", fontName="CN", fontSize=8.6, leading=13, leftIndent=13,
            firstLineIndent=0, textColor=GRAY,
        ),
    }
    return styles


def parse_table(lines, styles, available_width):
    rows = []
    for line in lines:
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        rows.append(parts)
    if len(rows) > 1 and all(re.fullmatch(r":?-{3,}:?", p) for p in rows[1]):
        rows.pop(1)
    cols = max(len(r) for r in rows)
    for row in rows:
        row.extend([""] * (cols - len(row)))
    cooked = []
    for ri, row in enumerate(rows):
        style = styles["table_head"] if ri == 0 else styles["table"]
        cooked.append([Paragraph(rich(cell), style) for cell in row])
    if cols == 2:
        weights = [0.27, 0.73]
    elif cols == 3:
        weights = [0.20, 0.34, 0.46]
    elif cols == 4:
        weights = [0.16, 0.27, 0.20, 0.37]
    else:
        weights = [1 / cols] * cols
    table = Table(cooked, colWidths=[available_width * w for w in weights], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
    ]))
    return table


def markdown_story(styles, available_width, source=None):
    source = source or SOURCE
    lines = source.read_text(encoding="utf-8").splitlines()
    story = []
    paragraph = []
    in_code = False
    code_lines = []
    inserted_diagram = False

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            story.append(Paragraph(rich(" ".join(x.strip() for x in paragraph)), styles["body"]))
            paragraph = []

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush_paragraph()
            if in_code:
                story.append(Preformatted("\n".join(code_lines), styles["code"], maxLineLength=110))
                story.append(Spacer(1, 5))
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_lines.append(line)
            i += 1
            continue
        if line.strip() == "<!-- pagebreak -->":
            flush_paragraph()
            story.append(PageBreak())
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and lines[i + 1].startswith("|"):
            flush_paragraph()
            table_lines = []
            while i < len(lines) and lines[i].startswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.append(parse_table(table_lines, styles, available_width))
            story.append(Spacer(1, 6))
            continue
        if line.startswith("# "):
            i += 1
            continue
        if line.startswith("## "):
            flush_paragraph()
            title = line[3:].strip()
            p = Paragraph(rich(title), styles["h1"])
            p.toc_level = 0
            story.append(p)
            if title.startswith("16.") and not inserted_diagram:
                story.append(ArchitectureDiagram(width=available_width))
                story.append(Spacer(1, 6))
                inserted_diagram = True
            i += 1
            continue
        if line.startswith("### "):
            flush_paragraph()
            p = Paragraph(rich(line[4:]), styles["h2"])
            p.toc_level = 1
            story.append(p)
            i += 1
            continue
        if re.match(r"^\d+\. ", line):
            flush_paragraph()
            story.append(Paragraph(rich(line), styles["bullet"], bulletText=None))
            i += 1
            continue
        if line.startswith("- "):
            flush_paragraph()
            story.append(Paragraph("- " + rich(line[2:]), styles["bullet"]))
            i += 1
            continue
        if not line.strip():
            flush_paragraph()
            i += 1
            continue
        if line.startswith("版本：") or line.startswith("日期：") or line.startswith("阶段："):
            i += 1
            continue
        paragraph.append(line)
        i += 1
    flush_paragraph()
    return story


def draw_cover(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(INK)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.circle(w - 8 * mm, h - 8 * mm, 67 * mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.circle(w - 22 * mm, h - 25 * mm, 30 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.roundRect(24 * mm, h - 58 * mm, 28 * mm, 9 * mm, 2 * mm, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.setFont("CN", 8)
    canvas.drawCentredString(38 * mm, h - 55 * mm, "ARCHITECTURE FIRST")
    canvas.setFillColor(colors.white)
    canvas.setFont("CN", 26)
    canvas.drawString(24 * mm, h - 90 * mm, "GPT-SaaS")
    canvas.setFont("CN", 22)
    canvas.drawString(24 * mm, h - 106 * mm, "AI 对话知识库编译系统")
    canvas.setFillColor(colors.HexColor("#BFD0F5"))
    canvas.setFont("CN", 11)
    canvas.drawString(24 * mm, h - 121 * mm, "把混杂的多条对话，编译成可追溯、可更新的学习知识文件")

    y = h - 166 * mm
    cards = [
        ("01", "问答档案", "知道过去问过什么"),
        ("02", "跨对话归纳", "打破原始聊天边界"),
        ("03", "知识文件树", "生成可学习的稳定结构"),
        ("04", "增量演化", "新对话只更新相关内容"),
    ]
    for idx, title, subtitle in cards:
        canvas.setFillColor(colors.HexColor("#223252"))
        canvas.roundRect(24 * mm, y, 162 * mm, 14 * mm, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(GOLD)
        canvas.setFont("CN", 8)
        canvas.drawString(29 * mm, y + 5 * mm, idx)
        canvas.setFillColor(colors.white)
        canvas.setFont("CN", 10)
        canvas.drawString(44 * mm, y + 5 * mm, title)
        canvas.setFillColor(colors.HexColor("#AAB9D2"))
        canvas.setFont("CN", 8)
        canvas.drawRightString(180 * mm, y + 5 * mm, subtitle)
        y -= 18 * mm
    canvas.setFillColor(colors.HexColor("#8392AA"))
    canvas.setFont("CN", 8)
    canvas.drawString(24 * mm, 20 * mm, "重新审核版 v2.0  |  2026-09-12  |  双产物与知识编译蓝图")
    canvas.restoreState()


def draw_content_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, h - 15 * mm, w - 20 * mm, h - 15 * mm)
    canvas.setFont("CN", 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(20 * mm, h - 11 * mm, "GPT-SaaS / AI 对话知识库编译指导书")
    canvas.drawRightString(w - 20 * mm, 12 * mm, f"{doc.page - 1:02d}")
    canvas.setFillColor(BLUE)
    canvas.rect(20 * mm, 11.2 * mm, 18 * mm, 1.2, fill=1, stroke=0)
    canvas.restoreState()


def build(
    source=None,
    output=None,
    *,
    document_title="GPT-SaaS AI 对话知识库编译系统实现指导书",
    document_subject="从混杂多对话到可追溯知识文件树的产品与技术规划",
    cover_draw=draw_cover,
    content_draw=draw_content_page,
):
    source = source or SOURCE
    output = output or OUTPUT
    register_fonts()
    output.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    page_w, page_h = A4
    frame = Frame(20 * mm, 18 * mm, page_w - 40 * mm, page_h - 37 * mm, id="content")
    cover_frame = Frame(0, 0, page_w, page_h, id="cover", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = GuideDocTemplate(
        str(output), pagesize=A4, title=document_title,
        author="Codex", subject=document_subject,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=19 * mm, bottomMargin=18 * mm,
    )
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_draw),
        PageTemplate(id="Content", frames=[frame], onPage=content_draw),
    ])

    story = [
        Spacer(1, page_h - 2 * mm),
        NextPageTemplate("Content"),
        PageBreak(),
        Paragraph("目录", styles["h1"]),
    ]
    toc = TableOfContents()
    toc.levelStyles = [styles["toc0"], styles["toc1"]]
    story.extend([toc, PageBreak()])
    story.extend(markdown_story(styles, page_w - 40 * mm, source))
    doc.multiBuild(story)
    print(output)


if __name__ == "__main__":
    build()
