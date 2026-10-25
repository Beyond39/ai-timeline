// Reading projection only. Raw messages and their versions remain untouched.
import { answerValidity, evidenceState } from './qa-validity.js';
export function bodyPreview(text, length = 240) {
  return String(text ?? '').replace(/```[^]*?```|~~~[^]*?~~~/g, '〔代码〕').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '')
    .replace(/^\s*\|?\s*:?-{3,}[^\n]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:#{1,6}|[-+*>]|\d+[.)])\s+/gm, '')
    .replace(/[*_`|]/g, '').replace(/\s+/g, ' ').trim().slice(0, length);
}
export function markdownPreview(text, length = 500) {
  // Only this bounded preview elides blocks; the complete body stays in versions.
  return String(text ?? '').replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[^]*?(?:^ {0,3}\1\s*$|$(?![^]))/gm, '〔代码，可在详情阅读〕').slice(0, length);
}
export function readableStatic(text, context = {}) {
  const value = String(text ?? '');
  // Fenced and inline code are opaque, including legitimate component examples.
  const protectedText = [], token = i => `\u0000OPC${i}\u0000`;
  let markup = value.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[^]*?(?:^ {0,3}\1\s*$|$(?![^]))|(`+)[^]*?\2/gm, match => { protectedText.push(match); return token(protectedText.length - 1); });
  markup = markup.replace(/\$\$[^]*?\$\$|\\\[[^]*?\\\]|\\\([^]*?\\\)|\$[^$\n]+\$/g, match => { protectedText.push(match); return token(protectedText.length - 1); });
  const component = /<(box|row|text|title|div|section|article|p|h[1-6]|table)\b[^>]*>[^]*?<\/\1>/i.test(markup) || /\{(?:@body\b|#(?:each|if|await)\b)/.test(markup);
  if (!component) return context.decodeEntities ? markup.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, decodeEntity).replace(/\u0000OPC(\d+)\u0000/g, (_, i) => protectedText[Number(i)]) : value;
  const first = markup.search(/<(?:box|row|text|title|div|section|article|p|h[1-6]|table)\b/i);
  // Strip a component module's executable wrapper only when it has markup.
  if (/^\s*(?:import\s|export\s)/.test(markup) && first >= 0) markup = markup.slice(first, markup.lastIndexOf('>') + 1);
  markup = markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\{#(each|if|await)\b[^}]*\}[^]*?\{\/\1\}/g, '\n〔动态内容无法静态还原；原始来源已保留〕\n')
    .replace(/\{(?:@body|@html|#each|#if|#await|:else|:then|:catch|\/each|\/if|\/await)[^}]*\}/g, '〔动态内容无法静态还原；原始来源已保留〕')
    .replace(/>\s*\{([a-zA-Z_$][\w.$]*)\}\s*</g, '>〔动态表达式无法静态还原；原始来源已保留〕<')
    .replace(/<table\b[^>]*>([^]*?)<\/table>/gi, (_, table) => {
      const rows = [...table.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/gi)].map(cell => cell[1].replace(/<[^>]*>/g, '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim())).filter(row => row.length);
      if (!rows.length) return '〔表格无法静态还原；原始来源已保留〕';
      const header = rows.shift(); return `\n\n| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${rows.map(row => '| ' + row.join(' | ') + ' |').join('\n')}\n\n`;
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<title\b[^>]*>/gi, '\n## ')
    .replace(/<\/(?:p|box|row|text|title|div|section|article|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<\/(?:td|th)>/gi, ' | ').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, decodeEntity)
    .replace(/\n{3,}/g, '\n\n').trim();
  return markup.replace(/\u0000OPC(\d+)\u0000/g, (_, i) => protectedText[Number(i)]);
}
function decodeEntity(entity) {
  const name = entity.slice(1, -1).toLowerCase(), named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  if (Object.hasOwn(named, name)) return named[name];
  const point = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
  return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
}
export function contentDiagnostics(text, rendered = readableStatic(text)) {
  const findings = []; let fence = null;
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/); if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
  }
  if (String(text ?? '').includes('\uFFFD')) findings.push({ code: 'source_replacement_character', reason: '源文本已包含 Unicode 替换字符（U+FFFD），可能在上游解码或导入前损坏；原字符保留，请核对原始版本。' });
  else if (String(rendered).includes('\uFFFD')) findings.push({ code: 'render_replacement_character', reason: '源文本不含 U+FFFD，阅读投影出现替换字符；应检查渲染链路。' });
  if (fence) findings.push({ code: 'possible_truncation', reason: '代码围栏未闭合；不据此改变回答完成状态' });
  if (rendered.includes('动态内容无法静态还原') || rendered.includes('动态表达式无法静态还原')) findings.push({ code: 'dynamic_component_fallback', reason: '动态组件未执行，原始内容保留在来源版本中' });
  if (rendered !== String(text ?? '')) findings.push({ code: 'static_component_projection', reason: '只转换阅读副本，来源内容未覆盖' });
  return findings;
}
export function structuredText(part, depth = 0, context = {}) {
  if (depth > 12 || part == null) return '';
  if (typeof part === 'string') return readableStatic(part, context);
  if (Array.isArray(part)) return part.map(p => structuredText(p, depth + 1, context)).filter(Boolean).join('\n\n');
  if (typeof part !== 'object') return '';
  const type = part.type ?? part.content_type;
  if (['tool_call', 'tool_result', 'thoughts', 'reasoning_recap'].includes(type)) return '';
  const cell = value => structuredText(value, depth + 1, context).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (type === 'table' && Array.isArray(part.rows)) {
    const headers = (part.headers ?? part.columns ?? []).map(cell), rows = part.rows.map(row => (Array.isArray(row) ? row : row.cells ?? []).map(cell));
    if (!headers.length && rows.length) headers.push(...rows.shift());
    return headers.length ? `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(row => '| ' + row.join(' | ') + ' |').join('\n')}` : '';
  }
  const text = [part.text, part.content, part.description, part.summary].find(v => typeof v === 'string');
  if (type === 'code' || type === 'code_block') { const fence = '`'.repeat(Math.max(3, ...[...(text ?? '').matchAll(/`+/g)].map(m => m[0].length + 1))); return `${fence}${String(part.language ?? '').replace(/[\r\n`]/g, '')}\n${text ?? ''}\n${fence}`; }
  if (type === 'heading') return '#'.repeat(Math.max(1, Math.min(6, Number(part.level) || 2))) + ' ' + (text ?? part.title ?? '');
  if (type === 'math' || type === 'equation') return `$$\n${text ?? part.latex ?? ''}\n$$`;
  if ((type === 'list' || type === 'bullet_list') && Array.isArray(part.items)) return part.items.map(item => '- ' + cell(item)).join('\n');
  if (text != null) return readableStatic(text, context);
  return [part.title, structuredText(part.children ?? part.items ?? part.blocks, depth + 1, context)].filter(v => typeof v === 'string' && v.trim()).join('\n\n');
}
export function visibility(message) {
  const raw = message.raw ?? {}, channel = message.channel ?? raw.channel ?? raw.metadata?.channel;
  const recipient = message.recipient ?? raw.recipient;
  const type = message.contentTypes?.[0] ?? raw.content?.content_type;
  if (message.isAuxiliary || raw.metadata?.is_visually_hidden_from_conversation) return 'context';
  if (['tool', 'function', 'system', 'developer'].includes(message.role)) return 'tool';
  if (message.role !== 'assistant' && message.role !== 'user') return 'unknown';
  if (message.role === 'assistant' && evidenceState(message) === 'invalid') return 'invalid';
  if (message.role === 'assistant' && (['analysis', 'commentary', 'summary', 'justify', 'confidence'].includes(channel) || recipient && recipient !== 'all' || ['thoughts', 'reasoning_recap', 'tool_call', 'computer', 'tool_result'].includes(type))) return 'status';
  if (!String(message.text ?? '').trim()) return message.attachments?.length ? 'reference' : 'empty';
  return 'body';
}
export function readingParts(messages) {
  const parts = [], byId = new Map();
  for (const message of messages) {
    const kind = visibility(message);
    if (!['body', 'reference'].includes(kind)) continue;
    const text = kind === 'reference' ? message.attachments.map(a => `〔附件：${a.name || '未命名'}；正文未导入〕`).join('\n\n') : (message.readingText ?? (message.presentation?.normalized ? String(message.text ?? '') : readableStatic(message.text))).trim();
    if (!text) continue;
    const key = message.sourceMessageId ?? message.id;
    // Distinct stable messages may legitimately contain the same paragraph.
    // Only repeated observations of the same message replace its projection.
    if (key && byId.has(key)) parts[byId.get(key)] = { ...message, text };
    else { if (key) byId.set(key, parts.length); parts.push({ ...message, text }); }
  }
  return parts;
}
export function turnStatus(question, responses) {
  const parts = readingParts(responses.filter(m => m.role === 'assistant'));
  const validity = answerValidity(question, responses, parts);
  return validity.state === 'ACTIVE' ? 'answered' : validity.state === 'PENDING' ? 'generating' : 'incomplete';
}
