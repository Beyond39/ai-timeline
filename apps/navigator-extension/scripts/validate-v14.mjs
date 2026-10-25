import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORES } from '../storage/database.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { opcMutation, timelinePage, assertOPC } from '../domain/opc.js';
import { cardMetadata } from '../domain/card-metadata.js';
import { cardSearchScore } from '../domain/card-search.js';
import { contentDiagnostics, readableStatic } from '../domain/qa-content.js';
import { restoreBackup, exportProject } from '../domain/backup.js';
import { basic, branches, graph, user, body } from '../validation/qa-p0-fixtures.mjs';
import { readConversationData } from '../adapters/conversation-data.js';
import { mathMarkup } from '../ui/math.js';
import { answerValidity } from '../domain/qa-validity.js';

const results = [], test = async (name, run) => { try { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, passed: false, error: e.stack }); console.error('FAIL ' + name + ': ' + e.message); } };
const state = Object.fromEntries(STORES.map(s => [s, []])), project = createProject(state, 'V1.4 regression');
const capture = async (payload, partial = false) => { const input = (await parseImport(JSON.stringify(payload), 'v14.json')).conversations[0]; if (partial) { input.scope.branches = 'unknown'; input.scope.kind = 'loaded_page'; } return saveConversation(state, input, project.id); };
await capture(branches('good')); const card = state.qaCards[0];
await test('部分读取缺失路径和完成元数据不隐藏已有有效卡片', async () => {
  const unknown = branches(null); await capture(unknown, true); assert.equal(card.validity.state, 'ACTIVE');
  const observed = branches('good'); delete observed.mapping.good.message.status; delete observed.mapping.good.message.end_turn; await capture(observed, true); assert.equal(card.validity.state, 'ACTIVE');
  await capture(branches('bad')); assert.equal(card.validity.state, 'HIDDEN_INVALID'); assert.ok(card.lastActiveAnswerVersionIds);
  await capture(branches('good')); assert.equal(card.validity.state, 'ACTIVE');
});
await test('缺失正文与工具完成不冒充确定无效；已确认最终回答不受旧工具状态污染', () => {
  const q = { role: 'user', text: '问题' }, tool = { id: 'tool', role: 'tool', text: '结果', completion: { status: 'complete' } }, a = { id: 'a', role: 'assistant', text: '完整答案', completion: { status: 'finished_successfully', endTurn: true } };
  assert.equal(answerValidity({ ...q, contentStatus: 'body_unavailable' }, [a], [a]).state, 'PENDING');
  assert.equal(answerValidity(q, [{ ...a, text: '', contentStatus: 'body_unavailable' }], []).state, 'PENDING');
  assert.equal(answerValidity(q, [tool], []).state, 'PENDING');
  assert.equal(answerValidity(q, [{ ...tool, completion: { status: 'in_progress' } }, a], [a]).state, 'ACTIVE');
});
await test('主题、类型、用户状态与系统状态独立；旧标签及收藏保留', async () => {
  assert.equal(cardMetadata().organizationStatus, '未整理');
  const m = opcMutation(state, 'metadata', { projectId: project.id, cardId: card.id, topic: 'OPC', contentType: '待验证', organizationStatus: '待验证', favorite: true, tags: ['旧标签'] });
  opcMutation(state, 'metadata', { projectId: project.id, cardId: card.id, notes: '中文备注', expectedRevision: m.revision });
  assert.equal(m.contentType, '待验证'); assert.equal(m.organizationStatus, '待验证'); assert.equal(m.favorite, true); assert.deepEqual(m.tags, ['旧标签']); assert.equal(card.validity.state, 'ACTIVE');
  assert.throws(() => opcMutation(state, 'metadata', { projectId: project.id, cardId: card.id, contentType: 'bad' }));
  assert.throws(() => opcMutation(state, 'metadata', { projectId: project.id, cardId: card.id, notes: '覆盖', expectedRevision: 0 })); assert.equal(m.notes, '中文备注');
});
await capture(graph([['q2', 'root', user('q2', '另一个问题', 1791000000)], ['a2', 'q2', body('a2', '全文深处中文关键词')]], 'a2', 'other-v14'));
const target = state.qaCards[1];
await test('有向/无向关系幂等；不同类型与独立说明可并存；反向与删除只作用关系', async () => {
  const args = { projectId: project.id, fromCardId: card.id, toCardId: target.id, type: '启发', description: '依据', directed: true };
  const r = opcMutation(state, 'relationship', args); assert.equal(opcMutation(state, 'relationship', args).id, r.id); assert.equal(state.relationships.length, 1);
  const different = opcMutation(state, 'relationship', { ...args, description: '独立说明' }); assert.notEqual(different.id, r.id);
  const u = opcMutation(state, 'relationship', { ...args, type: '自定义类型', directed: false }); assert.equal(opcMutation(state, 'relationship', { ...args, type: u.type, directed: false, fromCardId: target.id, toCardId: card.id }).id, u.id);
  opcMutation(state, 'relationship', { ...args, relationshipId: r.id, fromCardId: target.id, toCardId: card.id, expectedRevision: r.revision }); assert.equal(r.fromCardId, target.id);
  opcMutation(state, 'relationship', { projectId: project.id, relationshipId: r.id, remove: true, expectedRevision: r.revision }); assert.equal(state.qaCards.length, 2);
});
await test('中文多关键词与字段权重排序；NFKC仅用于检索', () => {
  const m = cardMetadata({ title: '插件关系标注', topic: '数据库' });
  assert.ok(cardSearchScore({}, m, '', '', '插件 标注') > cardSearchScore({}, cardMetadata(), '', '插件关系标注', '插件 标注'));
  assert.equal(cardSearchScore({}, m, '', '', '插件 不存在'), 0);
  assert.ok(cardSearchScore({}, cardMetadata(), 'ＡＢＣ 数据库', '', 'abc 数据库') > 0);
  assert.ok(cardSearchScore({}, cardMetadata({ notes: '中文备注' }), '', '', '中文备注') > 0);
});
await test('筛选覆盖日期范围、主题、类型、状态、收藏、来源和隐藏记录', async () => {
  assert.equal(timelinePage(state, { tag: 'OPC', contentType: '待验证', organizationStatus: '待验证', favorite: true }).total, 1);
  assert.equal(timelinePage(state, { dateFrom: '2026-10-01', dateTo: '2026-10-10' }).cards[0].id, target.id);
  assert.equal(timelinePage(state, { conversationId: target.conversationId }).total, 1);
  await capture(branches('bad')); assert.equal(timelinePage(state).total, 1); assert.equal(timelinePage(state, { includeInvalid: true }).total, 2); await capture(branches('good'));
});
await test('实体单次解码与 row/text 组件转换；代码和公式逐字符保留；截断仅诊断', () => {
  const code = '```html\n<row>{#each items as x} &amp; Ａ\n```', formula = '$$\\text{<row>} + ｘ$$';
  const raw = `<row><text>&amp;lt; &quot; &#39; &#x4e2d;</text></row>\n${code}\n${formula}\n{@body content}`;
  const rendered = readableStatic(raw); assert.ok(rendered.includes('&lt; " \' 中')); assert.ok(rendered.includes(code)); assert.ok(rendered.includes(formula)); assert.ok(!rendered.includes('{@body'));
  assert.ok(contentDiagnostics('```python\nx=1').some(d => d.code === 'possible_truncation'));
  assert.equal(contentDiagnostics('答案没有结束标点').length, 0);
});
await test('Markdown 正文实体按来源类型解码一次；plain 与代码中的实体保留', async () => {
  const payload = { provider: 'test', conversations: [{ id: 'entity-test', messages: [{ id: 'q', role: 'user', text: '实体' }, { id: 'a', role: 'assistant', status: 'complete', text: '&amp;lt; &quot;\n\n```html\n&amp;lt; &quot;\n```' }, { id: 'plain', role: 'assistant', status: 'complete', format: 'plain', text: '&amp;lt;' }] }] };
  const input = (await parseImport(JSON.stringify(payload), 'entities.json')).conversations[0];
  assert.ok(input.messages[1].text.startsWith('&lt; "')); assert.ok(input.messages[1].text.includes('```html\n&amp;lt; &quot;\n```')); assert.equal(input.messages[2].text, '&amp;lt;');
});
await test('备份恢复重映射有效历史版本、标注、关系与布局', () => {
  opcMutation(state, 'layout', { projectId: project.id, positions: { [card.id]: { x: 31, y: 49 } } });
  const restored = Object.fromEntries(STORES.map(s => [s, []])); restoreBackup(restored, exportProject(state, project.id)); assertOPC(restored);
  const c = restored.qaCards.find(c => c.sourceConversationId === 'p0-source'); assert.ok(Object.values(c.lastActiveAnswerVersionIds).every(id => restored.versions.some(v => v.id === id))); assert.equal(restored.qaMetadata[0].topic, 'OPC');
  assert.equal(restored.canvasLayouts[0].positions[c.id].x, 31);
});
await test('当前可见ID路径纠正滞后分支；生成控件不改写原始状态；混合路径拒绝导入', async () => {
  const saved = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  let visible = ['q', 'bad'], generating = false;
  const page = branches('good');
  globalThis.location = new URL('https://chatgpt.com/c/p0-source');
  globalThis.document = { cookie: '', title: 'Synthetic', querySelector: () => ({ querySelectorAll: () => visible.map(id => ({ closest: () => null, getClientRects: () => [1], getAttribute: () => id })), querySelector: () => generating ? {} : null }) };
  globalThis.fetch = async url => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(url.includes('/api/auth/session') ? { accessToken: 'synthetic-token' } : page) });
  try {
    const selected = await readConversationData({ expectedSourceUrl: location.href }); assert.equal(selected.conversation.current_node, 'bad');
    visible = ['q', 'good']; generating = true; const active = await readConversationData({ expectedSourceUrl: location.href }); assert.equal(active.conversation.mapping.good.message.status, 'finished_successfully'); assert.equal(active.conversation.mapping.good.message.opc_observation.status, 'in_progress');
    visible = ['good', 'bad']; const rejected = await readConversationData({ expectedSourceUrl: location.href }); assert.equal(rejected.errorCode, 'selected_branch_unavailable');
  } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
});
assertOPC(state);
await test('本地公式解析：矩阵、求和、文本、宏限额和 HTML 禁止', () => {
  for (const tex of ['\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\sum_{n=0}^{\\infty} \\frac{1}{n^2}', '\\text{中文} + \\left(x+1\\right)']) assert.ok(mathMarkup(tex).includes('<math'));
  assert.ok(!/class="evil"/.test(mathMarkup('\\htmlClass{evil}{x}'))); assert.ok(!/href=/.test(mathMarkup('\\href{javascript:alert(1)}{x}')));
  assert.throws(() => mathMarkup('\\def\\x{\\x}\\x'));
});
fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/OPC_V14_NODE_REPORT.json', JSON.stringify({ ok: results.every(r => r.passed), results, checkedAt: new Date().toISOString(), scope: 'Node regressions; browser and live ChatGPT verification reported separately.' }, null, 2));
process.exitCode = results.every(r => r.passed) ? 0 : 1;
