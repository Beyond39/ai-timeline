import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXTENSION_VERSION } from '../domain/common.js';
import { messageBody, parseMarkdown, richBody, safeBodyLink, splitTableRow } from '../ui/body.js';
import { messageCard, Reader } from '../ui/reader.js';

// Minimal inert DOM tree, for deterministic renderer contracts, not layout tests.
class Node {
  constructor(tag, value = '') { this.tagName = tag === '#text' ? tag : tag.toUpperCase(); this._text = value; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.className = ''; this.open = false; this.style = {}; }
  appendChild(node) { this.append(node); return node; }
  append(...nodes) { for (const value of nodes) { const node = typeof value === 'string' ? new Node('#text', value) : value; node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  async dispatch(type) { for (const listener of this.listeners[type] ?? []) await listener({ target: this }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  scrollIntoView() { this.scrolled = true; }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[') ? (() => { const match = selector.match(/^\[([^=]+)="([^"]*)"\]$/); return match && node.attributes[match[1]] === match[2]; })() : node.tagName === selector.toUpperCase();
    return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
const copied = [];
globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag), createTextNode: value => new Node('#text', value) };
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async value => copied.push(value) } }, configurable: true });
globalThis.CSS = { escape: value => value };
const nodes = host => [host, ...host.children.flatMap(nodes)];
const checks = [], failures = [];
async function check(name, fn) { try { await fn(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
const markdown = '# 完整正文\n\n段落含 **加粗**、*强调* 和 `inline()`。\n\n- 第一项\n- 第二项\n\n> 引用\n\n```js\nconst html = "<script>alert(1)</script>";\nconsole.log(html);\n```\n\n| 名称 | 内容 |\n| --- | --- |\n| 代码 | `a|b` |\n| 转义 | x\\|y |\n\n尾段保留 $x^2$。';
const presentation = { format: 'markdown', source: 'import', status: 'text_only' };

await check('未确认角色的正文默认可读，人工标注不冒充平台角色', () => {
  const card = messageCard({ id: 'pending-body', role: 'unknown', roleUnverified: true, confirmedRole: 'assistant', text: '已保存的完整正文。', presentation: { format: 'plain' }, versions: [] });
  assert.ok(card.textContent.includes('助手（你标注）')); assert.ok(card.textContent.includes('平台角色未确认')); assert.ok(card.textContent.includes('已保存的完整正文。'));
  assert.equal(card.querySelector('.answer-detail'), null);
});
await check('没有问答轮次时直接读取已保存原文，正文不会因角色未知而隐藏', async () => {
  const calls = [], host = new Node('section');
  const reader = new Reader(host, { api: async (type, args) => { calls.push([type, args]); return { conversation: { id: 'body-c', title: '正文保存测试', lastScope: { description: '角色未确认' } },
    paths: [{ id: 'body-p', label: '已加载正文顺序', messageCount: 1 }], snapshots: [], messages: [{ id: 'body-m', role: 'unknown', roleUnverified: true, text: '无需问答索引仍能阅读正文-END。', presentation: { format: 'plain' }, versions: [] }], total: 1, offset: 0, nextOffset: null }; }, onError: reason => { throw new Error(reason); } });
  reader.setView({ project: { id: 'body-prj' }, conversations: [{ id: 'body-c' }], paths: [{ id: 'body-p' }], qas: [], segments: [] });
  await reader.showPath('body-c', 'body-p'); assert.equal(calls[0][0], 'conversation'); assert.ok(host.textContent.includes('无需问答索引仍能阅读正文-END。'));
});

await check('Markdown标题、列表、引用、代码及表格生成安全本地节点', () => {
  const body = richBody(markdown, presentation); assert.equal(body.querySelectorAll('h1').length, 1); assert.equal(body.querySelectorAll('li').length, 2);
  assert.equal(body.querySelectorAll('blockquote').length, 1); assert.equal(body.querySelectorAll('table').length, 1);
  assert.equal(body.querySelector('pre').textContent, 'const html = "<script>alert(1)</script>";\nconsole.log(html);');
  assert.equal(body.querySelectorAll('td')[1].textContent, 'a|b'); assert.equal(body.querySelectorAll('td')[3].textContent, 'x|y');
});
await check('源HTML、事件属性和有害协议不会形成可执行节点', () => {
  const body = richBody('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[危险](javascript:alert) ![外图](https://example.invalid/image.png) [普通](https://example.invalid/page)', presentation);
  for (const tag of ['script', 'img', 'iframe', 'svg', 'object']) assert.equal(body.querySelectorAll(tag).length, 0);
  const links = body.querySelectorAll('a'); assert.equal(links.length, 2); assert.ok(links.every(node => node.attributes.href.startsWith('https:')));
  assert.ok(nodes(body).every(node => Object.keys(node.attributes).every(key => !key.toLowerCase().startsWith('on'))));
  assert.match(body.textContent, /<script>alert\(1\)<\/script>/); assert.match(body.textContent, /未自动加载/);
});
await check('链接协议只接受主动HTTP/HTTPS链接', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'file:///D:/x', '/relative', 'https://example.org/a\nb', 'mailto:a@example.org']) assert.equal(safeBodyLink(value), null);
  assert.equal(safeBodyLink('https://example.org/a?b=1'), 'https://example.org/a?b=1');
});
await check('长回答及代码未截断且复制保持完整正文', async () => {
  const text = '```text\n' + '长代码-𠀀🤖\n'.repeat(15000) + 'LONG-END-SENTINEL\n```\n\n最终原文-END';
  const card = messageCard({ id: 'long', role: 'assistant', text, presentation, versions: [], contentStatus: 'available' });
  const detail = card.querySelector('.answer-detail'); assert.equal(detail.open, false); assert.equal(detail.querySelectorAll('pre').length, 0);
  await card.querySelectorAll('button').find(node => node.textContent === '复制整条正文').dispatch('click'); assert.equal(copied.at(-1), text);
  detail.open = true; await detail.dispatch('toggle'); assert.match(card.textContent, /LONG-END-SENTINEL/); assert.match(card.textContent, /最终原文-END/);
  await card.querySelectorAll('button').find(node => node.textContent === '复制代码').dispatch('click'); assert.equal(copied.at(-1), parseMarkdown(text)[0].text);
});
await check('DOM仅渲染经验证的代码、表格及行内代码结构', () => {
  const dom = { format: 'dom-structured', source: 'dom', status: 'verified_structure', blocks: [{ type: 'heading', level: 2, text: '来源标题' }, { type: 'paragraph', text: '真实 inline()', inline: [{ type: 'text', text: '真实 ' }, { type: 'code', text: 'inline()' }] }, { type: 'code', text: '<img onerror=alert(1)>', language: 'html' }, { type: 'table', headers: ['列'], rows: [['完整单元格']] }, { type: 'list', ordered: true, items: ['一', '二'] }] };
  const body = richBody('原始完整可读文本', dom); assert.equal(body.querySelectorAll('table').length, 1); assert.equal(body.querySelectorAll('ol').length, 1);
  assert.equal(body.querySelector('code').textContent, 'inline()'); assert.equal(body.querySelector('pre').textContent, '<img onerror=alert(1)>'); assert.equal(body.querySelectorAll('img').length, 0);
});
await check('无结构旧数据、明确plain及无效结构保持普通文本', () => {
  for (const hint of [undefined, { format: 'plain' }, { format: 'dom-structured', status: 'text_only', blocks: [{ type: 'code', text: 'x' }] }, { format: 'dom-structured', status: 'verified_structure', blocks: [{ type: 'table', headers: '不合法', rows: [] }] }]) {
    const text = '# 不猜测标题\n```代码```\n<svg onload=alert(1)>';
    const body = richBody(text, hint); assert.equal(body.textContent, text); assert.equal(body.querySelectorAll('h1').length, 0);
  }
});
await check('原文入口延迟生成但完整保留换行与Markdown标记', async () => {
  const text = '# 原文\r\n\r\n```js\r\nconst x = 1;\r\n```', host = messageBody(text, presentation), original = host.querySelector('.original-body');
  assert.equal(original.children.length, 1); original.open = true; await original.dispatch('toggle'); assert.equal(original.querySelector('.message-text').textContent, text);
});
await check('Unicode搜索直接映射真实原文并保留组合字符', () => {
  const text = '**Ｆｏｏ** e\u0301 ﬀ 🤖', host = messageBody(text, presentation, { query: 'foo' });
  assert.equal(host.querySelector('mark').textContent, 'Ｆｏｏ'); assert.equal(host.querySelector('.message-text').textContent, text);
  const second = messageBody(text, presentation, { query: 'é' }); assert.equal(second.querySelector('mark').textContent, 'e\u0301');
});
await check('引用历史版本自动展开确切正文且保留当前正文', () => {
  const card = messageCard({ id: 'history', role: 'assistant', text: 'CURRENT-NEW', currentVersionId: 'v-new', versionCount: 3, versions: [{ id: 'v-new', text: 'CURRENT-NEW' }, { id: 'v-old', text: 'HISTORICAL-EXACT' }] }, { targetVersionId: 'v-old' });
  const historical = card.querySelector('[data-version-id="v-old"]'); assert.ok(historical); assert.match(historical.textContent, /HISTORICAL-EXACT/); assert.match(historical.textContent, /历史正文/);
  assert.match(card.textContent, /CURRENT-NEW/); assert.ok(card.querySelectorAll('details').some(node => node.open));
});
await check('历史版本只在用户打开入口及主动读取后加载', async () => {
  let calls = 0; const card = messageCard({ id: 'lazy', role: 'assistant', text: 'current', currentVersionId: 'v-current', versionCount: 2, versions: [{ id: 'v-current', text: 'current' }] }, { loadVersions: async key => { calls++; assert.equal(key, 'lazy'); return { versions: [{ id: 'v-current', text: 'current' }, { id: 'v-old', text: 'old' }] }; } });
  assert.equal(calls, 0); const details = card.querySelectorAll('details').find(node => node.children[0].textContent.startsWith('正文版本'));
  details.open = true; await details.dispatch('toggle'); assert.equal(calls, 0); await card.querySelectorAll('button').find(node => node.textContent === '读取其余历史版本').dispatch('click');
  assert.equal(calls, 1); assert.equal(card.querySelector('[data-version-id="v-old"]').textContent.includes('old'), true);
});
await check('Reader历史定位将versionId传给范围查询并滚动确切版本', async () => {
  const host = new Node('div'), reader = new Reader(host, { api: async (type, args) => {
    assert.equal(type, 'conversation'); assert.equal(args.targetVersionId, 'v-old');
    return { conversation: { id: 'c', title: '明确标记的Reader验证对话' }, messages: [{ id: 'm', role: 'assistant', text: 'latest', currentVersionId: 'v-new', versionCount: 2, versions: [{ id: 'v-new', text: 'latest' }, { id: 'v-old', text: 'exact-old' }] }], paths: [], snapshots: [], offset: 0, total: 1, nextOffset: null };
  }, onError: error => { throw new Error(error); } });
  await reader.showConversation('c', null, 'm', 0, '', 'v-old'); assert.equal(host.querySelector('[data-version-id="v-old"]').scrolled, true);
});
await check('表格分割保留转义与代码中的竖线', () => { assert.deepEqual(splitTableRow('| x\\|y | `a|b` |'), ['x|y', '`a|b`']); });
await check('常见公式本地MathML排版，复杂宏保留原文', () => { const body = messageBody('$$x^2$$\n\\(y\\)\n\n$\\unsupported{x}$', presentation); assert.ok(body.querySelector('math')); assert.ok(body.querySelector('msup')); assert.match(body.textContent, /\\unsupported\{x\}/); assert.match(body.textContent, /本地 MathML/); });

const report = { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
  scope: 'Synthetic inert DOM renderer and Reader RPC contract tests; no browser layout, real ChatGPT capture, clipboard permission or MV3 installation asserted.' };
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true }); fs.writeFileSync(new URL('../dist/READER_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
