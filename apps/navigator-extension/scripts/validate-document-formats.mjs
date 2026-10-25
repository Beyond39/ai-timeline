import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDocxBytes, createDocxBlob } from '../exports/docx.js';
import { documentToMarkdown, documentToPrintableHtml, documentInnerHtml } from '../exports/render.js';
import { entryBlocks, roleLabel, DOCX_MIME } from '../exports/content.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dist = path.join(root, 'dist');
const source = (role, id) => ({ conversationId: 'synthetic-conversation', conversationTitle: '量化学习 合成验收对话', sourceUrl: 'https://chatgpt.com/c/synthetic-export-check', pathId: 'synthetic-path', pathLabel: '已存阅读路径', messageId: id, versionId: `${id}-version`, role, sourceTime: { value: null, precision: 'unknown' }, capturedAt: '2026-10-08T02:00:00.000Z' });
const longText = '完整长回答校验 '.repeat(600) + '\n最后一行必须保留 END_OF_LONG_BODY';
const markdown = '# 收益率计算\n\n这是一条含有 **加粗**、*斜体* 与 `close` 的助手回答。\n\n1. 取得昨天的收盘价。\n2. 计算今天的收益率。\n\n```python\n# 中文注释\nclose = 105\nreturns = (close / 100) - 1\nprint(returns)\n```\n\n| 日期 | close | 收益率 |\n| --- | --- | --- |\n| 2026-10-07 | 100 | 0% |\n| 2026-10-08 | 105 | 5% |\n\n> 引用保留在文档中。\n\n公式保留来源表达式：$r_t = P_t / P_{t-1} - 1$。\n\n[参考资料](https://example.com/reference)\n\n![外部图片](https://example.com/image.png)\n\n<script>alert("正文应显示为文本")</script>';
const plain = 'open\nhigh\nlow\nclose\nvolume\nreturns\n\n昨天 close = 100\n今天 close = 105';
const spec = { schemaVersion: 1, title: '对话文档导出验收', subtitle: '中文 代码 表格 来源与版本', createdAt: '2026-10-08T02:10:00.000Z', project: { id: 'synthetic-project', name: '量化学习导出验收' }, includeUserPrompts: true, includeSourceAppendix: true,
  chapters: [{ title: '收益率讨论', entries: [{ text: '请说明股票收益率如何计算。', presentation: { format: 'plain' }, source: source('user', 'synthetic-user') }, { text: markdown, presentation: { format: 'markdown' }, source: source('assistant', 'synthetic-assistant') }] },
    { title: '未确认角色的正文', entries: [{ text: plain, presentation: { format: 'plain' }, source: { ...source('unknown', 'synthetic-unknown'), roleUnverified: true, confirmedRole: 'assistant' } }] },
    { title: '完整长正文', entries: [{ text: longText, presentation: { format: 'plain' }, source: source('assistant', 'synthetic-long') }] }] };
const results = [];
function check(name, test) { test(); results.push({ name, passed: true }); }
function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder(), files = {}; let index = 0;
  while (index + 30 <= bytes.length && view.getUint32(index, true) === 0x04034b50) {
    assert.equal(view.getUint16(index + 8, true), 0, 'Expected real offline store ZIP records');
    const size = view.getUint32(index + 18, true), nameLength = view.getUint16(index + 26, true), extraLength = view.getUint16(index + 28, true);
    const name = decoder.decode(bytes.slice(index + 30, index + 30 + nameLength)), start = index + 30 + nameLength + extraLength;
    files[name] = decoder.decode(bytes.slice(start, start + size)); index = start + size;
  }
  assert.equal(view.getUint32(index, true), 0x02014b50, 'ZIP central directory exists');
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50, 'ZIP end record exists');
  assert.equal(view.getUint16(bytes.length - 12, true), Object.keys(files).length);
  return files;
}
const bytes = createDocxBytes(spec), files = unzipStored(bytes), html = documentToPrintableHtml(spec), md = documentToMarkdown(spec);
check('DOCX is a real ZIP with OOXML content types, relationships, styles and document', () => { for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'customXml/item1.xml']) assert.ok(files[name], name); assert.ok(files['[Content_Types].xml'].includes('wordprocessingml.document.main+xml')); });
check('Chinese full body and final long-answer line retained', () => { assert.ok(files['word/document.xml'].includes('END_OF_LONG_BODY')); assert.ok(html.includes('END_OF_LONG_BODY')); assert.ok(md.includes(longText)); assert.ok(files['word/document.xml'].includes('股票收益率')); });
check('Exact original texts archived without truncation', () => { const json = files['customXml/item1.xml'].match(/<acvn:originalText\b[^>]*>([\s\S]*)<\/acvn:originalText>/)[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'); const snapshot = JSON.parse(json); assert.deepEqual(snapshot.chapters.flatMap(chapter => chapter.entries.map(entry => entry.text)), spec.chapters.flatMap(chapter => chapter.entries.map(entry => entry.text))); });
check('Code, table, heading and list have real editable DOCX structure', () => { assert.ok(files['word/document.xml'].includes('<w:tbl>')); assert.ok(files['word/document.xml'].includes('<w:pStyle w:val="Code"')); assert.ok(files['word/document.xml'].includes('<w:pStyle w:val="Heading3"')); assert.ok(files['word/document.xml'].includes('<w:numPr>')); assert.ok(files['word/numbering.xml'].includes('w:numFmt w:val="decimal"')); });
check('DOCX hyperlinks only use explicit safe URLs', () => { assert.ok(files['word/_rels/document.xml.rels'].includes('https://example.com/reference')); assert.ok(files['word/_rels/document.xml.rels'].includes(source('user', 'x').sourceUrl)); assert.ok(files['word/document.xml'].includes('w:hyperlink')); });
check('Unknown roles and manual annotations remain honest', () => { assert.ok(roleLabel({ role: 'unknown' }).includes('角色未确认')); assert.ok(html.includes('助手（你标注；平台角色未确认）')); assert.ok(files['word/document.xml'].includes('助手（你标注；平台角色未确认）')); });
check('Source appendix includes exact version ID and unknown discussion time', () => { assert.ok(md.includes('synthetic-assistant-version')); assert.ok(md.includes('来源时间：未知')); assert.ok(md.includes('不代表讨论时间')); assert.ok(files['word/document.xml'].includes('synthetic-long-version')); });
check('Remote media never automatically load and raw HTML is inert', () => { assert.ok(!/<img\b|<script\b|\son[a-z]+=/i.test(html)); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('未自动加载')); assert.ok(!Object.keys(files).some(name => name.startsWith('word/media/'))); });
check('Formula source expression retained', () => { assert.ok(files['word/document.xml'].includes('$r_t = P_t / P_{t-1} - 1$')); assert.ok(md.includes('$r_t = P_t / P_{t-1} - 1$')); });
check('Prompt filtering removes verified user from every export part', () => { const filtered = { ...spec, includeUserPrompts: false }; const omitted = spec.chapters[0].entries[0].text; assert.ok(!documentToMarkdown(filtered).includes(omitted)); assert.ok(!documentInnerHtml(filtered).includes(omitted)); assert.ok(!Object.values(unzipStored(createDocxBytes(filtered))).some(value => value.includes(omitted))); });
check('Manual user annotation and unverified platform user are retained when prompts excluded', () => { const filtered = { ...spec, includeUserPrompts: false, chapters: [{ title: '未知角色', entries: [{ text: '手动用户标注正文不能丢弃', source: { ...source('unknown', 'unknown'), roleUnverified: true, confirmedRole: 'user' } }, { text: '平台角色未确认的用户正文也不能丢弃', source: { ...source('user', 'unverified'), roleUnverified: true } }] }] }; const value = documentToMarkdown(filtered); assert.ok(value.includes('手动用户标注正文不能丢弃')); assert.ok(value.includes('平台角色未确认的用户正文也不能丢弃')); });
check('Opting out sources excludes hidden origin IDs and source URL in DOCX', () => { const privateSpec = { ...spec, includeSourceAppendix: false }; const parts = Object.values(unzipStored(createDocxBytes(privateSpec))).join(''); assert.ok(!parts.includes('synthetic-conversation')); assert.ok(!parts.includes('synthetic-assistant-version')); assert.ok(!parts.includes('https://chatgpt.com/c/synthetic-export-check')); assert.ok(!documentToPrintableHtml(privateSpec).includes('https://chatgpt.com/c/synthetic-export-check')); });
check('Invalid DOM structure falls back to entire raw body', () => { const entry = { text: '完整正文不能由错误结构替换', presentation: { format: 'dom-structured', status: 'verified_structure', blocks: [{ type: 'paragraph', text: '只有部分' }] } }; assert.equal(entryBlocks(entry).blocks[0].text, entry.text); });
check('Verified DOM structure keeps code and table text', () => { const entry = { text: '代码\nprint(1)\n日期\n值\n今天\n105', presentation: { format: 'dom-structured', status: 'verified_structure', blocks: [{ type: 'heading', level: 2, text: '代码' }, { type: 'code', text: 'print(1)', language: 'python' }, { type: 'table', headers: ['日期', '值'], rows: [['今天', '105']] }] } }; assert.equal(entryBlocks(entry).blocks[1].type, 'code'); });
check('Unsafe links stay literal and cannot generate executable relationships', () => { const unsafe = { ...spec, chapters: [{ title: '安全', entries: [{ text: '[坏链接](javascript:alert(1)) [好链接](https://example.com/safe)', presentation: { format: 'markdown' }, source: source('assistant', 'unsafe') }] }] }; assert.ok(!unzipStored(createDocxBytes(unsafe))['word/_rels/document.xml.rels'].includes('Target="javascript:')); assert.ok(!documentToPrintableHtml(unsafe).includes('href="javascript:')); });
check('Title and chapter text cannot inject markup', () => { const unsafe = { ...spec, title: '<img src=x onerror=alert(1)>', chapters: [{ title: '<script>恶意标题</script>', entries: [spec.chapters[0].entries[1]] }] }; const value = documentToPrintableHtml(unsafe); assert.ok(!value.includes('<img src=')); assert.ok(value.includes('&lt;script&gt;恶意标题&lt;/script&gt;')); });
check('DOCX type and blob size are correct', () => { const blob = createDocxBlob(spec); assert.equal(blob.type, DOCX_MIME); assert.equal(blob.size, bytes.length); });
check('XML-unrepresentable control characters fail explicitly', () => { const invalid = { ...spec, chapters: [{ title: '控制字符', entries: [{ text: 'before\u0000after', source: source('assistant', 'control') }] }] }; assert.throws(() => createDocxBytes(invalid), /控制字符/); assert.ok(documentToMarkdown(invalid).includes('before\u0000after')); });
check('Empty chapters and explicitly excluded user-only chapters are omitted', () => { const empty = { ...spec, includeUserPrompts: false, chapters: [{ title: '只有问题', entries: [spec.chapters[0].entries[0]] }, { title: '空章节', entries: [] }] }; assert.ok(!documentToMarkdown(empty).includes('## 只有问题')); assert.ok(!documentToMarkdown(empty).includes('## 空章节')); });

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'SYNTHETIC_DOCUMENT_EXPORT.docx'), bytes);
fs.writeFileSync(path.join(dist, 'SYNTHETIC_DOCUMENT_EXPORT.html'), html);
fs.writeFileSync(path.join(dist, 'SYNTHETIC_DOCUMENT_EXPORT.md'), md);
fs.writeFileSync(path.join(dist, 'DOCUMENT_FORMAT_VALIDATION_REPORT.json'), JSON.stringify({ generatedAt: new Date().toISOString(), syntheticDataOnly: true, passed: results.length, checks: results, docxVisualRenderingVerified: false, limitations: ['DOCX visual Word/WPS rendering is unverified until a managed renderer is available. Formula expressions remain source text; remote images are references only.'] }, null, 2));
console.log(`Document format checks passed: ${results.length}; real OOXML DOCX, HTML and Markdown synthetic fixtures generated.`);
