import { el, button, plainBody } from './dom.js';
import { renderMath } from './math.js';

// A deliberately small, offline Markdown renderer. Source HTML is always text;
// only code below creates elements or attributes. No parser output is executable.
export function safeBodyLink(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = []; let current = '', escaped = false, fence = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { current += char === '|' ? '|' : `\\${char}`; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '`') {
      const run = value.slice(i).match(/^`+/)[0].length; current += '`'.repeat(run); i += run - 1;
      if (!fence) fence = run; else if (fence === run) fence = 0;
      continue;
    }
    if (char === '|' && !fence) { cells.push(current.trim()); current = ''; } else current += char;
  }
  if (escaped) current += '\\'; cells.push(current.trim()); return cells;
}
const isTableRule = line => { const cells = splitTableRow(line); return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell)); };
const fenceStart = line => line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
const listStart = line => line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.*)$/);
const special = (lines, index) => Boolean(fenceStart(lines[index]) || /^\s*(?:\$\$|\\\[)/.test(lines[index]) || /^ {0,3}#{1,6}\s+/.test(lines[index]) || /^ {0,3}>/.test(lines[index]) || listStart(lines[index]) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index]) || (index + 1 < lines.length && lines[index].includes('|') && isTableRule(lines[index + 1])));

export function parseMarkdown(text, depth = 0) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n'), blocks = []; let index = 0;
  while (index < lines.length) {
    const line = lines[index]; if (!line.trim()) { index++; continue; }
    const formula = line.match(/^\s*\$\$([^]*?)\$\$\s*$/);
    if (formula) { blocks.push({ type: 'math', text: formula[1] }); index++; continue; }
    if (/^\s*(?:\$\$|\\\[)\s*$/.test(line)) {
      const end = line.trim() === '$$' ? '$$' : '\\]', values = []; index++;
      while (index < lines.length && lines[index].trim() !== end) values.push(lines[index++]);
      if (index < lines.length) { index++; blocks.push({ type: 'math', text: values.join('\n') }); } else blocks.push({ type: 'paragraph', text: [line, ...values].join('\n') });
      continue;
    }
    const fence = fenceStart(line);
    if (fence) {
      const code = [], mark = fence[1][0], size = fence[1].length, language = fence[2].trim().split(/\s+/)[0]; index++;
      while (index < lines.length) {
        const ending = lines[index].match(/^ {0,3}(`+|~+)\s*$/);
        if (ending && ending[1][0] === mark && ending[1].length >= size) { index++; break; }
        code.push(lines[index++]);
      }
      blocks.push({ type: 'code', text: code.join('\n'), language }); continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); index++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ type: 'rule' }); index++; continue; }
    if (index + 1 < lines.length && line.includes('|') && isTableRule(lines[index + 1])) {
      const headers = splitTableRow(line), rows = []; index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(splitTableRow(lines[index++]));
      blocks.push({ type: 'table', headers, rows }); continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quote = []; while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}> ?/, ''));
      const text = quote.join('\n'); blocks.push({ type: 'quote', text, blocks: depth < 6 ? parseMarkdown(text, depth + 1) : null }); continue;
    }
    const first = listStart(line);
    if (first) {
      const items = [], ordered = /^\d/.test(first[1]), start = ordered ? Number.parseInt(first[1], 10) : null;
      while (index < lines.length) {
        const item = listStart(lines[index]); if (!item || /^\d/.test(item[1]) !== ordered) break;
        let value = item[2]; index++;
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !listStart(lines[index])) value += '\n' + lines[index++].trimStart();
        items.push(value);
      }
      blocks.push({ type: 'list', items, ordered, start }); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !special(lines, index)) paragraph.push(lines[index++]);
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

function appendInline(host, text, depth = 0) {
  if (depth > 8) { host.append(document.createTextNode(text)); return; }
  // The scanner consumes the exact source. Unsupported syntax is shown literally.
  const expression = /(`+)([\s\S]*?)\1|!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|\\\(([^\n]*?)\\\)|\$([^$\n]+)\$/g;
  let start = 0;
  for (const match of text.matchAll(expression)) {
    host.append(document.createTextNode(text.slice(start, match.index)));
    if (match[1]) host.append(el('code', { class: 'inline-code', text: match[2] }));
    else if (match[11] !== undefined || match[12] !== undefined) host.append(renderMath(match[11] ?? match[12]));
    else if (match[3] !== undefined) {
      const placeholder = el('span', { class: 'external-image', text: `〔图片：${match[3] || '未命名'}；未自动加载〕` }), href = safeBodyLink(match[4]);
      if (href) placeholder.append(document.createTextNode(' '), el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: '主动打开图片来源 ↗' }));
      host.append(placeholder);
    } else if (match[5] !== undefined) {
      const href = safeBodyLink(match[6]), node = href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }) : el('span');
      appendInline(node, match[5], depth + 1); if (!href) node.append(document.createTextNode(`（链接不可打开：${match[6]}）`)); host.append(node);
    } else { const value = match[7] ?? match[8] ?? match[9] ?? match[10], node = el(match[7] || match[8] ? 'strong' : 'em'); appendInline(node, value, depth + 1); host.append(node); }
    start = match.index + match[0].length;
  }
  host.append(document.createTextNode(text.slice(start)));
}
export function copyBodyButton(text, label = '复制整条正文', onError = null) {
  let control;
  control = button(label, async () => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境无法访问剪贴板，请选中原文手动复制。');
      await navigator.clipboard.writeText(text); control.textContent = '已复制'; control.title = `${text.length.toLocaleString()} 字符已完整复制`;
    } catch (error) { control.textContent = '复制失败 · 可选中原文'; control.title = error.message; onError?.(error.message); }
  }, 'btn body-copy'); return control;
}
function renderBlocks(blocks, markdown, onError) {
  const host = el('div', { class: 'message-rich' }), inline = (tag, value, attributes = {}, structure = null) => {
    const node = el(tag, attributes);
    if (markdown) appendInline(node, value);
    else if (Array.isArray(structure) && structure.every(item => item && ['text', 'code'].includes(item.type) && typeof item.text === 'string') && structure.map(item => item.text).join('') === value) {
      structure.forEach(item => node.append(item.type === 'code' ? el('code', { class: 'inline-code', text: item.text }) : document.createTextNode(item.text)));
    } else node.textContent = value;
    return node;
  };
  for (const block of blocks) {
    if (block.type === 'math') host.append(renderMath(block.text, true));
    else if (block.type === 'code') host.append(el('section', { class: 'code-block' }, [el('div', { class: 'code-toolbar' }, [el('span', { text: block.language || '代码' }), copyBodyButton(block.text, '复制代码', onError)]), el('pre', {}, [el('code', { text: block.text })])]));
    else if (block.type === 'table') {
      const count = block.rows.reduce((max, row) => Math.max(max, row.length), block.headers.length), table = el('table', { 'aria-label': '正文表格' });
      if (block.headers.length) table.append(el('thead', {}, [el('tr', {}, Array.from({ length: count }, (_, i) => inline('th', block.headers[i] ?? '', { scope: 'col' })))]));
      table.append(el('tbody', {}, block.rows.map(row => el('tr', {}, Array.from({ length: count }, (_, i) => inline('td', row[i] ?? ''))))));
      host.append(el('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': '表格；可横向滚动' }, [table]));
    } else if (block.type === 'heading') host.append(inline(`h${Math.max(1, Math.min(6, Number.isFinite(block.level) ? Math.trunc(block.level) : 2))}`, block.text, {}, block.inline));
    else if (block.type === 'list') host.append(el(block.ordered ? 'ol' : 'ul', block.ordered && block.start ? { start: block.start } : {}, block.items.map(value => inline('li', value))));
    else if (block.type === 'quote') host.append(block.blocks && markdown ? el('blockquote', {}, [renderBlocks(block.blocks, markdown, onError)]) : inline('blockquote', block.text, {}, block.inline));
    else if (block.type === 'rule') host.append(el('hr'));
    else host.append(inline('p', block.text, {}, block.inline));
  }
  return host;
}
function verifiedBlocks(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const allowed = new Set(['text', 'paragraph', 'heading', 'list', 'quote', 'code', 'table']);
  for (const block of value) {
    if (!block || !allowed.has(block.type)) return null;
    if (block.type === 'table') { if (!Array.isArray(block.headers) || !block.headers.every(v => typeof v === 'string') || !Array.isArray(block.rows) || !block.rows.every(row => Array.isArray(row) && row.every(v => typeof v === 'string'))) return null; }
    else if (block.type === 'list') { if (!Array.isArray(block.items) || !block.items.every(v => typeof v === 'string')) return null; }
    else if (typeof block.text !== 'string') return null;
  }
  return value;
}
export function presentationLabel(presentation) {
  return presentation?.format === 'markdown' ? '导入正文 · Markdown 安全排版' : presentation?.format === 'dom-structured' && presentation.status === 'verified_structure' ? '页面实际取得的文本 / 结构' : '普通文本 · 未取得完整格式';
}
export function richBody(text, presentation, onError = null) {
  if (presentation?.format === 'markdown') return renderBlocks(parseMarkdown(text), true, onError);
  const blocks = presentation?.format === 'dom-structured' && presentation.status === 'verified_structure' ? verifiedBlocks(presentation.blocks) : null;
  return blocks ? renderBlocks(blocks, false, onError) : plainBody(text);
}
function lazyDetails(label, factory, open = false, className = '') {
  const detail = el('details', { class: className }, [el('summary', { text: label })]); let content = null;
  const mount = () => { if (!content && detail.open) { content = factory(); detail.append(content); } };
  detail.addEventListener('toggle', mount); if (open) { detail.open = true; mount(); } return detail;
}
export function messageBody(text, presentation, { query = '', onError = null } = {}) {
  const host = el('div', { class: 'body-presentation' });
  const formatted = presentation?.format === 'markdown' || (presentation?.format === 'dom-structured' && presentation.status === 'verified_structure' && verifiedBlocks(presentation.blocks));
  if (query) {
    host.append(el('p', { class: 'body-format-note', text: '搜索命中在原始正文中高亮；字符位置与保存原文一致。' }), plainBody(text, query));
    if (formatted) host.append(lazyDetails('查看排版结果（保留原文）', () => richBody(text, presentation, onError)));
  } else {
    host.append(richBody(text, presentation, onError));
    host.append(lazyDetails('查看原始正文（完整、未经排版）', () => plainBody(text), false, 'original-body'));
  }
  if (presentation?.format === 'markdown' && /\$|\\\(|\\\[/.test(text)) host.append(el('p', { class: 'body-format-note', text: '公式使用本地 MathML 排版；超出支持范围的表达式保留原文。' }));
  return host;
}
