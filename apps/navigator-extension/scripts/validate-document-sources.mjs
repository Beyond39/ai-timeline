import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORES } from '../storage/database.js';
import { EXTENSION_VERSION } from '../domain/common.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation, moveConversation } from '../domain/captures.js';
import { assembleDocumentSources } from '../storage/document-export.js';
import { composeDocument } from '../domain/document-export.js';

// Synthetic records only. These tests use the actual import/persistence domain
// and export planner/composer; real IndexedDB/browser layout need separate checks.
const checks = [], failures = [];
async function check(name, fn) {
  try { await fn(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
const state = { ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 };
const project = createProject(state, '文档导出合成项目'), otherProject = createProject(state, '另一个合成项目');
const longText = '# 保存正文\n\n```js\nconst 代码 = "<script>";\n```\n\n| 列 | 值 |\n| --- | --- |\n| 中文 | 42 |\n\n' + '完整𠀀🤖段落\n'.repeat(15000) + 'DOCUMENT-END';
async function saveSynthetic(sourceId, title, messages, projectId = project.id) {
  const input = await parseImport(JSON.stringify({ provider: 'document-source-synthetic', conversations: [{ id: sourceId, title, url: `https://example.org/c/${sourceId}`, messages }] }), 'synthetic-document.json');
  return { input: input.conversations[0], output: await saveConversation(state, input.conversations[0], projectId) };
}
const first = await saveSynthetic('first', '技术方案', [{ id: 'q1', role: 'user', text: '原问题', created_at: '2025-01-01T00:00:00Z' }, { id: 'a1', role: 'assistant', text: longText }]);
const second = await saveSynthetic('second', '学习笔记', [{ id: 'q2', role: 'user', text: '学习问题' }, { id: 'a2', role: 'assistant', text: longText }]);
const outsider = await saveSynthetic('outside', '其他项目', [{ id: 'qo', role: 'user', text: '外部问题' }, { id: 'ao', role: 'assistant', text: '外部回答' }], otherProject.id);
const bodyInput = structuredClone(first.input);
bodyInput.sourceConversationId = 'unknown-body'; bodyInput.title = '正文回退'; bodyInput.sourceUrl = 'https://example.org/c/unknown-body';
bodyInput.messages = bodyInput.messages.slice(0, 1).map(message => ({ ...message, sourceMessageId: 'body-only', role: 'unknown', originalRole: 'unknown', roleUnverified: true,
  confirmedRole: 'user', text: '平台角色未知、人工标注用户的完整正文-END', time: { value: null, precision: 'unknown', source: null }, presentation: { format: 'plain', source: 'dom', status: 'text_only' } }));
bodyInput.paths = [{ ...bodyInput.paths[0], messageKeys: [bodyInput.messages[0].key] }];
const bodyResult = await saveConversation(state, bodyInput, project.id);
const sourceRecords = (value, projectId = project.id) => ({ project: value.projects.find(row => row.id === projectId),
  ...Object.fromEntries(['conversations', 'paths', 'qas', 'segments', 'topics', 'messages', 'versions'].map(store => [store, value[store].filter(row => row.projectId === projectId)])) });
const fixedOptions = { createdAt: '2026-10-08T01:00:00.000Z', revision: 4 };
const sourcesFor = (args, value = state) => assembleDocumentSources(sourceRecords(value, args.projectId ?? project.id), { projectId: project.id, ...args }, fixedOptions);
const ref = (conversation, message) => ({ conversationId: conversation.id, messageId: message.id, versionId: message.versionId });

await check('单对话导出保留长正文末尾、中文代码表格和不可变版本', () => {
  const sources = sourcesFor({ conversationIds: [first.output.conversationId] }), messages = sources.conversations[0].messages;
  assert.equal(messages.length, 2); assert.equal(messages[1].text, longText); assert.match(messages[1].text, /DOCUMENT-END$/);
  assert.equal(messages[1].versionId, state.messages.find(row => row.sourceMessageId === 'a1').currentVersionId);
  assert.equal(messages[1].presentation.format, 'markdown');
});
await check('原始发言时间与正文版本采集时间分开；未知时间不替换为采集日期', () => {
  const sources = sourcesFor({ conversationIds: [first.output.conversationId, bodyResult.conversationId] });
  const question = sources.conversations[0].messages[0];
  assert.equal(question.sourceTime.value, '2025-01-01T00:00:00.000Z'); assert.notEqual(question.sourceTime.value, question.capturedAt);
  assert.equal(sources.conversations[1].messages[0].sourceTime.value, null);
});
await check('无问答的未知角色正文可导出；人工用户标注不会让正文被仅回答模式删除', () => {
  assert.equal(state.qas.filter(row => row.conversationId === bodyResult.conversationId).length, 0);
  const spec = composeDocument(sourcesFor({ conversationIds: [bodyResult.conversationId] }), { includeUserPrompts: false });
  assert.equal(spec.chapters[0].entries.length, 1); assert.equal(spec.chapters[0].entries[0].source.role, 'unknown');
  assert.equal(spec.chapters[0].entries[0].source.roleUnverified, true); assert.equal(spec.chapters[0].entries[0].source.confirmedRole, 'user');
});
await check('仅回答模式只排除可靠用户角色；保留未知或未确认角色', () => {
  const sources = sourcesFor({ conversationIds: [first.output.conversationId] });
  assert.equal(composeDocument(sources, { includeUserPrompts: false }).chapters[0].entries.length, 1);
  sources.conversations[0].messages[0].roleUnverified = true;
  assert.equal(composeDocument(sources, { includeUserPrompts: false }).chapters[0].entries.length, 2);
});
await check('同项目跨对话章节支持手动标题与选择顺序；不把相同正文当作同一条消息', () => {
  const sources = sourcesFor({ conversationIds: [first.output.conversationId, second.output.conversationId] }), [a, b] = sources.conversations;
  const spec = composeDocument(sources, { title: '跨对话资料', chapters: [{ title: '手动章节', items: [ref(b, b.messages[1]), ref(a, a.messages[1])] }] });
  assert.equal(spec.title, '跨对话资料'); assert.equal(spec.chapters[0].title, '手动章节');
  assert.deepEqual(spec.chapters[0].entries.map(entry => entry.source.conversationId), [b.id, a.id]);
  assert.equal(spec.chapters[0].entries.length, 2); assert.equal(spec.chapters[0].entries[0].text, spec.chapters[0].entries[1].text);
});
await check('同一消息版本在多章节重复选择时只保留第一次；另一消息的相同文本保留', () => {
  const sources = sourcesFor({ conversationIds: [first.output.conversationId, second.output.conversationId] }), [a, b] = sources.conversations;
  const aRef = ref(a, a.messages[1]), spec = composeDocument(sources, { chapters: [{ title: '第一章', items: [aRef, aRef] }, { title: '第二章', items: [aRef, ref(b, b.messages[1])] }] });
  assert.deepEqual(spec.chapters.map(chapter => chapter.entries.length), [1, 1]);
});
await check('问答和片段选择按真实成员读取，不额外夹带其他问答', async () => {
  const third = await saveSynthetic('third', '多轮选择', [{ id: 'q3', role: 'user', text: '第一轮' }, { id: 'a3', role: 'assistant', text: '第一轮回答' }, { id: 'q4', role: 'user', text: '第二轮' }, { id: 'a4', role: 'assistant', text: '第二轮回答' }]);
  const qa = state.qas.find(row => row.conversationId === third.output.conversationId && row.ordinal === 2), segment = state.segments.find(row => row.qaIds.includes(qa.id));
  assert.deepEqual(sourcesFor({ qaIds: [qa.id] }).conversations[0].messages.map(row => row.text), ['第二轮', '第二轮回答']);
  assert.deepEqual(sourcesFor({ segmentIds: [segment.id] }).conversations[0].messages.map(row => row.text), ['第二轮', '第二轮回答']);
  assert.throws(() => sourcesFor({ qaIds: [qa.id], conversationIds: [first.output.conversationId] }), /不属于/);
});
await check('主题名称只来自所选路径上的活跃保存标签，未分类正文不猜主题', () => {
  const segment = state.segments.find(row => row.conversationId === first.output.conversationId), topic = state.topics.find(row => row.projectId === project.id);
  segment.topicIds = [topic.id];
  const sources = sourcesFor({ conversationIds: [first.output.conversationId, bodyResult.conversationId] });
  assert.deepEqual(sources.conversations[0].messages[1].topicNames, [topic.name]);
  assert.deepEqual(sources.conversations[1].messages[0].topicNames, []);
});
await check('默认只读取当前路径；替代回答需显式选择分支，不合并分支', async () => {
  const alternative = await saveSynthetic('first', '技术方案', [{ id: 'q1', role: 'user', text: '原问题' }, { id: 'alternate-answer', role: 'assistant', text: '替代回答-END' }]);
  assert.notEqual(alternative.output.pathId, first.output.pathId);
  assert.deepEqual(sourcesFor({ conversationIds: [first.output.conversationId] }).conversations[0].messages.map(row => row.text), ['原问题', '替代回答-END']);
  const main = sourcesFor({ conversationIds: [first.output.conversationId], pathSelections: { [first.output.conversationId]: first.output.pathId } });
  assert.equal(main.conversations[0].messages[1].text, longText);
  const mainQA = state.qas.find(row => row.pathId === first.output.pathId);
  assert.throws(() => sourcesFor({ qaIds: [mainQA.id] }), /当前阅读路径/);
  assert.equal(sourcesFor({ qaIds: [mainQA.id], pathSelections: { [first.output.conversationId]: first.output.pathId } }).conversations[0].messages.length, 2);
});
await check('当前路径失效或多个路径未确认时拒绝猜测；跨对话路径也拒绝', () => {
  const changed = structuredClone(state), conversation = changed.conversations.find(row => row.id === first.output.conversationId);
  conversation.currentPathId = null;
  assert.throws(() => sourcesFor({ conversationIds: [conversation.id] }, changed), /路径未确认/);
  assert.throws(() => sourcesFor({ conversationIds: [conversation.id], pathSelections: { [conversation.id]: second.output.pathId } }), /不属于/);
});
await check('另一项目的对话、问答、片段和章节引用全部拒绝', () => {
  const qa = state.qas.find(row => row.conversationId === outsider.output.conversationId), segment = state.segments.find(row => row.conversationId === outsider.output.conversationId);
  for (const args of [{ conversationIds: [outsider.output.conversationId] }, { qaIds: [qa.id] }, { segmentIds: [segment.id] }]) assert.throws(() => sourcesFor(args), /不属于/);
  const sources = sourcesFor({ conversationIds: [second.output.conversationId] }), c = sources.conversations[0];
  assert.throws(() => composeDocument(sources, { chapters: [{ title: '跨项目引用', items: [{ ...ref(c, c.messages[1]), projectId: otherProject.id }] }] }), /其他项目/);
});
await check('旧版本引用、消息与版本归属不一致、缓存正文变化均拒绝', () => {
  const args = { conversationIds: [second.output.conversationId] }, sources = sourcesFor(args), c = sources.conversations[0];
  assert.throws(() => composeDocument(sources, { chapters: [{ title: '旧版本', items: [{ ...ref(c, c.messages[1]), versionId: 'missing-old-version' }] }] }), /版本不在/);
  const mismatch = structuredClone(state), message = mismatch.messages.find(row => row.id === c.messages[1].id);
  message.currentVersionId = mismatch.messages.find(row => row.id === c.messages[0].id).currentVersionId; message.versionIds.push(message.currentVersionId);
  assert.throws(() => sourcesFor(args, mismatch), /版本不一致/);
  const changed = structuredClone(state); changed.messages.find(row => row.id === c.messages[1].id).text = '只改缓存';
  assert.throws(() => sourcesFor(args, changed), /版本不一致/);
});
await check('对话移动后旧项目选择失效，新项目记录归属完整', () => {
  const changed = structuredClone(state), conversation = changed.conversations.find(row => row.id === second.output.conversationId);
  moveConversation(changed, conversation, otherProject.id);
  assert.throws(() => sourcesFor({ conversationIds: [conversation.id] }, changed), /已移动/);
  const moved = sourcesFor({ projectId: otherProject.id, conversationIds: [conversation.id] }, changed);
  assert.equal(moved.project.id, otherProject.id); assert.equal(moved.conversations[0].messages[1].text, longText);
});
await check('超过七百条正文不分页截断，章节最后一条仍完整', () => {
  const records = structuredClone(sourceRecords(state)), conversation = records.conversations.find(row => row.id === bodyResult.conversationId), path = records.paths.find(row => row.id === conversation.currentPathId);
  const exemplar = records.messages.find(row => row.conversationId === conversation.id), version = records.versions.find(row => row.id === exemplar.currentVersionId);
  records.messages = []; records.versions = []; path.messageIds = [];
  for (let i = 0; i < 701; i++) {
    const messageId = `long-body-${i}`, versionId = `long-version-${i}`, text = `正文-${i}-END`;
    records.messages.push({ ...exemplar, id: messageId, text, currentVersionId: versionId, versionIds: [versionId] });
    records.versions.push({ ...version, id: versionId, messageId, text }); path.messageIds.push(messageId);
  }
  const sources = assembleDocumentSources(records, { projectId: project.id, conversationIds: [conversation.id] }, fixedOptions), spec = composeDocument(sources);
  assert.equal(spec.chapters[0].entries.length, 701); assert.equal(spec.chapters[0].entries.at(-1).text, '正文-700-END');
});
await check('无效重复选择和替换片段拒绝，不产生空文件', () => {
  assert.throws(() => sourcesFor({ conversationIds: [second.output.conversationId, second.output.conversationId] }), /不重复/);
  assert.throws(() => sourcesFor({ conversationIds: [] }), /至少/);
  const changed = structuredClone(state), segment = changed.segments.find(row => row.conversationId === second.output.conversationId); segment.active = false;
  assert.throws(() => sourcesFor({ segmentIds: [segment.id] }, changed), /已被替换/);
  const sources = sourcesFor({ conversationIds: [bodyResult.conversationId] });
  assert.throws(() => composeDocument(sources, { chapters: [{ title: '空章节', items: [] }] }), /没有可导出/);
});
await check('来源与章节组合保持纯函数；输出改动不污染保存的原文、标签和版本', () => {
  const records = sourceRecords(state), original = JSON.stringify(records), args = { projectId: project.id, conversationIds: [second.output.conversationId] };
  const sources = assembleDocumentSources(records, args, fixedOptions), sourceOriginal = JSON.stringify(sources), spec = composeDocument(sources);
  assert.equal(JSON.stringify(records), original); assert.equal(JSON.stringify(sources), sourceOriginal);
  spec.chapters[0].entries[0].presentation.format = 'changed'; spec.chapters[0].entries[0].source.sourceTime.value = 'changed';
  assert.equal(JSON.stringify(records), original); assert.equal(JSON.stringify(sources), sourceOriginal);
});
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/DOCUMENT_SOURCES_VALIDATION_REPORT.json', import.meta.url), JSON.stringify({ version: EXTENSION_VERSION, checkedAt: new Date().toISOString(),
  passed: checks.length, failed: failures.length, checks, failures, scope: 'Synthetic actual domain persistence, source selection/version ownership and pure document composition. No live ChatGPT, browser layout, real IndexedDB or Word/WPS rendering asserted.' }, null, 2));
if (failures.length) process.exitCode = 1;
