import { parseMarkdown, safeBodyLink } from '../ui/body.js';
import { readableStatic } from '../domain/qa-content.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const roleNames = { user: '用户', assistant: '助手', tool: '工具', function: '工具', system: '系统', developer: '开发者', unknown: '未确认角色' };

export function validateDocument(spec) {
  if (!spec || spec.schemaVersion !== 1 || typeof spec.title !== 'string' || !Array.isArray(spec.chapters)) throw new Error('文档快照格式不正确，请重新生成预览。');
  for (const chapter of spec.chapters) {
    if (!chapter || typeof chapter.title !== 'string' || !Array.isArray(chapter.entries)) throw new Error('文档章节格式不正确。');
    for (const entry of chapter.entries) if (!entry || typeof entry.text !== 'string' || !entry.source || typeof entry.source !== 'object') throw new Error('文档中有无效正文或来源记录。');
  }
  return spec;
}
export function includedChapters(spec) {
  validateDocument(spec);
  return spec.chapters.map(chapter => {
    const entries = [];
    for (const entry of chapter.entries.filter(entry => spec.includeUserPrompts !== false || entry.source.role !== 'user' || entry.source.roleUnverified === true)) {
      const last = entries.at(-1);
      if (entry.source.qaCardId && entry.source.role === 'assistant' && last?.source.role === 'assistant' && last.source.qaCardId === entry.source.qaCardId) {
        last.text += '\n\n' + readableStatic(entry.text); last.sourceParts.push(entry.source);
      } else entries.push({ ...entry, text: readableStatic(entry.text), sourceParts: [entry.source] });
    }
    return { ...chapter, entries };
  }).filter(chapter => chapter.entries.length);
}
export function roleLabel(source) {
  if (source.roleUnverified || source.role === 'unknown' || !source.role) {
    const manual = roleNames[source.confirmedRole];
    return manual && source.confirmedRole !== 'unknown' ? `${manual}（你标注；平台角色未确认）` : '正文片段（角色未确认）';
  }
  return roleNames[source.role] ?? `其他角色：${source.role}`;
}
export function sourceTimeLabel(sourceTime) {
  if (typeof sourceTime === 'string') return sourceTime || '未知';
  const precision = { message: '消息时间', conversation: '对话时间', date_only: '仅日期', unknown: '精度未知' }[sourceTime?.precision] ?? sourceTime?.precision;
  return sourceTime?.value ? `${sourceTime.value}${precision ? `（${precision}）` : ''}` : '未知';
}
export function sourceLines(source, index) {
  return [
    `来源 ${index} · ${source.conversationTitle || '未命名对话'}`,
    `来源地址：${source.sourceUrl || '未知（未生成链接）'}`,
    `阅读路径：${source.pathLabel || source.pathId || '未知'}`,
    `已存采集范围：${source.scopeDescription || '未知；仅导出已保存正文'}`,
    `对话 ID：${source.conversationId || '未知'}`,
    `消息 ID：${source.messageId || '未知'}；正文版本 ID：${source.versionId || '未知'}`,
    `说话人：${roleLabel(source)}`,
    `来源时间：${sourceTimeLabel(source.sourceTime)}；版本采集时间：${source.capturedAt || '未知'}（不代表讨论时间）`
  ];
}
export function entrySources(entry, number) { return (entry.sourceParts ?? [entry.source]).map((source, i) => ({ source, number: i ? `${number}.${i + 1}` : number })); }
export const safeExportLink = safeBodyLink;
export function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function escapeXml(value) {
  const text = String(value ?? '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text)) throw new Error('正文包含 DOCX XML 无法保存的控制字符或无效 Unicode。请使用 Markdown 导出保留原文。');
  return escapeHtml(text);
}

function flatBlockText(block) {
  if (block.type === 'table') return [...block.headers, ...block.rows.flat()].join('');
  if (block.type === 'list') return block.items.join('');
  return block.text ?? '';
}
function verifiedBlocks(presentation, text) {
  if (presentation?.format !== 'dom-structured' || presentation.status !== 'verified_structure' || !Array.isArray(presentation.blocks) || !presentation.blocks.length) return null;
  for (const block of presentation.blocks) {
    if (!block || !['text', 'paragraph', 'heading', 'list', 'quote', 'code', 'table'].includes(block.type)) return null;
    if (block.type === 'table') {
      if (!Array.isArray(block.headers) || !block.headers.every(v => typeof v === 'string') || !Array.isArray(block.rows) || !block.rows.every(row => Array.isArray(row) && row.every(v => typeof v === 'string'))) return null;
    } else if (block.type === 'list') { if (!Array.isArray(block.items) || !block.items.every(v => typeof v === 'string')) return null; }
    else if (typeof block.text !== 'string') return null;
  }
  const compact = value => value.replace(/\s/gu, '');
  return compact(presentation.blocks.map(flatBlockText).join('')) === compact(text) ? presentation.blocks : null;
}
export function entryBlocks(entry) {
  if (entry.presentation?.format === 'markdown') return { markdown: true, blocks: parseMarkdown(readableStatic(entry.text)) };
  return { markdown: false, blocks: verifiedBlocks(entry.presentation, entry.text) ?? [{ type: 'paragraph', text: entry.text }] };
}

// Inline formatting creates only typed records. Unsupported syntax is literal text.
// Images are references; none of the exporters retrieve or embed remote media.
export function inlineParts(text, markdown = false, depth = 0) {
  text = String(text ?? '');
  if (!markdown || depth > 8) return [{ text }];
  // Markdown emphasis must not consume underscores or asterisks inside LaTeX.
  // Formula expressions remain literal source text until a local math renderer
  // can reliably produce an editable native equation.
  const formula = /\$\$[\s\S]*?\$\$|\$[^\n$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
  const formulas = [...text.matchAll(formula)];
  if (formulas.length) {
    const parts = []; let position = 0;
    for (const match of formulas) {
      if (match.index > position) parts.push(...inlineParts(text.slice(position, match.index), true, depth + 1));
      parts.push({ text: match[0] }); position = match.index + match[0].length;
    }
    if (position < text.length) parts.push(...inlineParts(text.slice(position), true, depth + 1));
    return parts;
  }
  const expression = /(`+)([\s\S]*?)\1|!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_/g;
  const result = []; let start = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index > start) result.push({ text: text.slice(start, match.index) });
    if (match[1]) result.push({ text: match[2], code: true });
    else if (match[3] !== undefined) result.push({ text: `〔图片引用：${match[3] || '未命名'}；未自动加载〕 ${match[4]}`, href: safeExportLink(match[4]) });
    else if (match[5] !== undefined) {
      const href = safeExportLink(match[6]);
      if (href) result.push(...inlineParts(match[5], true, depth + 1).map(part => ({ ...part, href })));
      else result.push({ text: match[0] });
    } else {
      const bold = match[7] !== undefined || match[8] !== undefined;
      result.push(...inlineParts(match[7] ?? match[8] ?? match[9] ?? match[10], true, depth + 1).map(part => ({ ...part, ...(bold ? { bold: true } : { italic: true }) })));
    }
    start = match.index + match[0].length;
  }
  if (start < text.length) result.push({ text: text.slice(start) });
  return result.length ? result : [{ text }];
}
export function inlineStructure(text, markdown, structure) {
  if (!markdown && Array.isArray(structure) && structure.every(part => part && ['text', 'code'].includes(part.type) && typeof part.text === 'string') && structure.map(part => part.text).join('') === text) return structure.map(part => ({ text: part.text, code: part.type === 'code' }));
  return inlineParts(text, markdown);
}
