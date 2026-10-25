import { includedChapters, roleLabel, sourceLines, entrySources, entryBlocks, inlineStructure, safeExportLink, escapeHtml as e } from './content.js';

export const DOCUMENT_STYLES = `
.export-document{font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;font-size:14px;line-height:1.7;color:#18181b;background:#fff;max-width:860px;margin:0 auto;padding:32px;box-sizing:border-box;overflow-wrap:anywhere}
.export-document *{box-sizing:border-box}.export-document h1{font-size:28px;line-height:1.35;margin:0 0 12px;color:#000}.export-document .export-subtitle{font-size:17px;margin:0 0 12px;color:#000}
.export-document h2{font-size:21px;line-height:1.4;margin:28px 0 14px;color:#000}.export-document h3,.export-document h4,.export-document h5,.export-document h6{line-height:1.45;margin:18px 0 10px;color:#000}
.export-document p{margin:0 0 12px;white-space:pre-wrap}.export-document .export-meta,.export-document .export-source-lines{font-size:12px;line-height:1.65;color:#52525b}.export-document .export-role{font-size:14px;font-weight:700;color:#342a65;margin:20px 0 10px}
.export-document .export-plain{white-space:pre-wrap}.export-document pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#f3f4f6;border-radius:6px;padding:12px;font-family:Consolas,"Microsoft YaHei",monospace;font-size:12px;line-height:1.6;margin:0 0 16px}
.export-document code{font-family:Consolas,"Microsoft YaHei",monospace;font-size:.92em;background:#f3f4f6}.export-document pre code{font-size:inherit;background:transparent}.export-document .export-code-language{font-size:11px;color:#52525b;margin:4px 0}.export-document blockquote{margin:12px 0;padding:8px 14px;background:#f7f7fa;border-left:3px solid #d4d4d8;white-space:pre-wrap}
.export-document table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0 18px;font-size:12px;overflow-wrap:anywhere}.export-document th,.export-document td{border:1px solid #d4d4d8;padding:7px 9px;vertical-align:top;white-space:pre-wrap}.export-document th{background:#f0f0f4;text-align:left}.export-document ul,.export-document ol{padding-left:24px;margin:8px 0 16px}.export-document li{white-space:pre-wrap}.export-document a{color:#2255aa;text-decoration:underline}.export-document .export-source{margin-top:16px}.export-document .export-original{font-size:12px;color:#52525b;margin:10px 0 20px}.export-document .export-original pre{color:#18181b}.export-document .export-image-reference{font-size:12px}
@media(max-width:560px){.export-document{padding:18px;font-size:13px}.export-document h1{font-size:24px}.export-document h2{font-size:19px}}
.export-print-hint{max-width:860px;margin:16px auto;padding:12px 20px;background:#f1efff;color:#342a65;font:14px/1.6 "Microsoft YaHei",Arial,sans-serif;border-radius:8px}
@page{size:A4;margin:18mm 20mm}
@media print{.export-print-hint{display:none}.export-document{max-width:none;padding:0;font-size:11pt}.export-document h1{font-size:22pt}.export-document h2{font-size:16pt}.export-document h3,.export-document h4,.export-document h5,.export-document h6,.export-document .export-role{break-after:avoid;page-break-after:avoid}.export-document h1,.export-document h2{break-after:avoid;page-break-after:avoid}.export-document .export-meta,.export-document .export-source-lines{font-size:9pt}.export-document pre,.export-document table{font-size:9pt}.export-document th{print-color-adjust:exact;-webkit-print-color-adjust:exact}.export-document thead{display:table-header-group}.export-document tr{break-inside:auto}.export-document .export-original{display:none}.export-document a{text-decoration:none}.export-document .export-chapter{break-inside:auto}}
`;

function inlineHtml(text, markdown, structure = null) {
  return inlineStructure(text, markdown, structure).map(part => {
    let body = e(part.text);
    if (part.code) body = `<code>${body}</code>`;
    if (part.bold) body = `<strong>${body}</strong>`;
    if (part.italic) body = `<em>${body}</em>`;
    if (part.href) body = `<a href="${e(part.href)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
    return body;
  }).join('');
}
function blocksHtml(blocks, markdown) {
  return blocks.map(block => {
    if (block.type === 'heading') { const level = Math.min(6, Math.max(3, Number(block.level) + 2 || 3)); return `<h${level}>${inlineHtml(block.text, markdown, block.inline)}</h${level}>`; }
    if (block.type === 'code') return `${block.language ? `<div class="export-code-language">${e(block.language)}</div>` : ''}<pre><code>${e(block.text)}</code></pre>`;
    if (block.type === 'table') {
      const count = block.rows.reduce((max, row) => Math.max(max, row.length), block.headers.length);
      const row = (values, header = false) => `<tr>${Array.from({ length: count }, (_, index) => `<${header ? 'th scope="col"' : 'td'}>${inlineHtml(values[index] ?? '', markdown)}</${header ? 'th' : 'td'}>`).join('')}</tr>`;
      return `<table>${block.headers.length ? `<thead>${row(block.headers, true)}</thead>` : ''}<tbody>${block.rows.map(values => row(values)).join('')}</tbody></table>`;
    }
    if (block.type === 'list') { const tag = block.ordered ? 'ol' : 'ul'; return `<${tag}${block.ordered && Number.isInteger(block.start) ? ` start="${block.start}"` : ''}>${block.items.map(item => `<li>${inlineHtml(item, markdown)}</li>`).join('')}</${tag}>`; }
    if (block.type === 'quote') return `<blockquote>${block.blocks && markdown ? blocksHtml(block.blocks, markdown) : inlineHtml(block.text, markdown, block.inline)}</blockquote>`;
    if (block.type === 'rule') return '<hr>';
    return `<p>${inlineHtml(block.text ?? '', markdown, block.inline)}</p>`;
  }).join('');
}
export function documentInnerHtml(spec) {
  const chapters = includedChapters(spec), sources = []; let number = 0;
  const content = chapters.map(chapter => `<section class="export-chapter"><h2>${e(chapter.title)}</h2>${chapter.entries.map(entry => {
    const index = ++number, parsed = entryBlocks(entry); sources.push(...entrySources(entry, index).map(s => ({ source: s.source, index: s.number })));
    return `<section class="export-entry"><h3 class="export-role">${e(roleLabel(entry.source))}${spec.includeSourceAppendix ? ` · 来源 ${index}` : ''}</h3><div class="${parsed.markdown || entry.presentation?.format === 'dom-structured' ? 'export-body' : 'export-body export-plain'}">${blocksHtml(parsed.blocks, parsed.markdown)}</div><details class="export-original"><summary>完整原始正文</summary><pre>${e(entry.text)}</pre></details></section>`;
  }).join('')}</section>`).join('');
  const appendix = spec.includeSourceAppendix && sources.length ? `<section class="export-appendix"><h2>来源与正文版本</h2>${sources.map(({ source, index }) => {
    const lines = sourceLines(source, index), href = safeExportLink(source.sourceUrl);
    return `<section class="export-source"><h3>${e(lines[0])}</h3><div class="export-source-lines"><p>${href ? `来源地址：<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(source.sourceUrl)}</a>` : e(lines[1])}</p>${lines.slice(2).map(line => `<p>${e(line)}</p>`).join('')}</div></section>`;
  }).join('')}</section>` : '';
  return `<article class="export-document"><header><h1>${e(spec.title)}</h1>${spec.subtitle ? `<p class="export-subtitle">${e(spec.subtitle)}</p>` : ''}<p class="export-meta">本地项目：${e(spec.project?.name || '未命名项目')}；导出快照时间：${e(spec.createdAt || '未知')}</p></header>${content}${appendix}</article>`;
}
export function renderDocument(document, spec) {
  // Every source value is escaped before parsing. Generated HTML contains no
  // scripts, event handlers, forms, media requests, or untrusted raw markup.
  const template = document.createElement('template'); template.innerHTML = documentInnerHtml(spec);
  return template.content.firstElementChild;
}
export function documentToPrintableHtml(spec) {
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${e(spec.title)}</title><style>${DOCUMENT_STYLES}</style></head><body><aside class="export-print-hint">按 Ctrl+P 打开打印窗口，选择“另存为 PDF”。打印时可关闭浏览器的页眉和页脚。本页已包含导出时选定的完整正文。</aside>${documentInnerHtml(spec)}</body></html>`;
}
export function documentToMarkdown(spec) {
  const chapters = includedChapters(spec), output = [`# ${spec.title}`, spec.subtitle || '', `本地项目：${spec.project?.name || '未命名项目'}；导出快照时间：${spec.createdAt || '未知'}`], sources = []; let index = 0;
  for (const chapter of chapters) {
    output.push(`## ${chapter.title}`);
    for (const entry of chapter.entries) {
      const number = ++index; output.push(`### ${roleLabel(entry.source)}${spec.includeSourceAppendix ? ` · 来源 ${number}` : ''}`, entry.text); sources.push(...entrySources(entry, number));
    }
  }
  if (spec.includeSourceAppendix && sources.length) {
    output.push('## 来源与正文版本');
    for (const { source, number } of sources) output.push(...sourceLines(source, number));
  }
  // Full readable bodies, with component conversion, remain unabridged.
  return output.join('\n\n') + '\n';
}
