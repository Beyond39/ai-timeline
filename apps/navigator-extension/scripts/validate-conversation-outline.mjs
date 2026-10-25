import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConversationOutline, labelMessageRole } from '../domain/conversation-outline.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const message = (id, role, extra = {}) => ({ id, projectId: 'p', conversationId: 'c', role, text: `${id} 完整正文`, currentVersionId: `v-${id}`, ...extra });
const data = { conversation: { id: 'c', projectId: 'p', title: '合成 Conversation', currentPathId: 'path' },
  paths: [{ id: 'path', projectId: 'p', conversationId: 'c', messageIds: ['lead', 'q1', 'a1', 'tool', 'system', 'q2', 'unknown', 'q3'], scope: { description: '本次部分页面' } }],
  messages: [message('lead', 'assistant'), message('q1', 'user'), message('a1', 'assistant', { text: '完整回答\n'.repeat(5000) + 'ANSWER-END' }), message('tool', 'tool'), message('system', 'system'),
    message('q2', 'user'), message('unknown', 'unknown', { roleUnverified: true }), message('q3', 'user')],
  qas: [{ id: 'qa1', projectId: 'p', conversationId: 'c', pathId: 'path', userMessageId: 'q1', responseMessageIds: ['a1', 'tool', 'system'] },
    { id: 'qa2', projectId: 'p', conversationId: 'c', pathId: 'path', userMessageId: 'q2', responseMessageIds: ['unknown'] },
    { id: 'qa3', projectId: 'p', conversationId: 'c', pathId: 'path', userMessageId: 'q3', responseMessageIds: [] }] };
const args = { projectId: 'p', conversationId: 'c' }, checks = [], failures = [];
async function check(name, action) { try { await action(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
await check('目录按来源顺序完整覆盖问题、回答、工具、系统及问题之前的回答', () => {
  const outline = buildConversationOutline(data, args); assert.equal(outline.rounds.length, 4);
  assert.deepEqual(outline.rounds.flatMap(row => row.messageIds), data.paths[0].messageIds);
  assert.equal(outline.rounds[0].questionMessageId, null); assert.equal(outline.rounds[1].qaId, 'qa1');
  assert.deepEqual(outline.rounds[1].responseMessageIds, ['a1', 'tool', 'system']); assert.equal(outline.rounds[1].status, 'answered');
});
await check('有未知正文不冒充回答；无回答和生成中分别标记', () => {
  const outline = buildConversationOutline(data, args); assert.equal(outline.rounds[2].status, 'role_unverified'); assert.equal(outline.rounds[3].status, 'unanswered');
  const source = structuredClone(data); source.messages[2].streaming = 'generating'; assert.equal(buildConversationOutline(source, args).rounds[1].status, 'generating');
});
await check('不可靠的user角色字段也不会冒充平台Q/A', () => {
  const source = structuredClone(data); source.messages[0].role = 'user'; source.messages[0].roleUnverified = true;
  const outline = buildConversationOutline(source, args); assert.equal(outline.rounds[0].questionMessageId, null); assert.equal(outline.rounds[0].qaId, null);
});
await check('目录只保留正文摘要和真实版本；不以目录摘要替换长回答', () => {
  const summary = buildConversationOutline(data, args).rounds[1].messageSummaries[1];
  assert.equal(summary.textLength, data.messages[2].text.length); assert.ok(summary.textPreview.length <= 180); assert.equal(summary.currentVersionId, 'v-a1');
  assert.match(data.messages[2].text, /ANSWER-END$/);
});
const unknown = { conversation: data.conversation, paths: [{ ...data.paths[0], messageIds: ['u1', 'u2', 'u3', 'u4'] }], qas: [],
  messages: ['u1', 'u2', 'u3', 'u4'].map(id => message(id, 'unknown', { roleUnverified: true })) };
await check('完全没有Q/A索引的旧正文仍有可读目录，不猜测交替角色', () => {
  const outline = buildConversationOutline(unknown, args); assert.equal(outline.rounds.length, 4); assert.equal(outline.unknownMessages, 4);
  assert.ok(outline.rounds.every(row => row.qaId === null && row.ordinal === null));
});
await check('用户阅读标注形成显式人工Q/A，并保留平台角色未知及源索引', () => {
  const source = structuredClone(unknown); source.messages.forEach((row, index) => { row.confirmedRole = index % 2 === 0 ? 'user' : 'assistant'; });
  const outline = buildConversationOutline(source, args); assert.equal(outline.rounds.length, 2); assert.ok(outline.rounds.every(row => row.qaId === null && row.labelBasis === 'manual' && row.status === 'answered'));
  assert.ok(source.messages.every(row => row.role === 'unknown')); assert.equal(source.qas.length, 0);
});
await check('缺失消息、重复路径成员、跨Conversation或项目引用均拒绝', () => {
  for (const change of [source => source.messages.pop(), source => source.paths[0].messageIds.push('q1'), source => source.messages[1].conversationId = 'other', source => source.messages[1].projectId = 'other']) {
    const source = structuredClone(data); change(source); assert.throws(() => buildConversationOutline(source, args));
  }
  assert.throws(() => buildConversationOutline(data, { ...args, projectId: 'other' }));
});
await check('多条分支未选当前路径时拒绝混合，显式选分支仅返回对应成员', () => {
  const source = structuredClone(data); source.paths.push({ ...source.paths[0], id: 'alternate', messageIds: ['q1', 'a1'] });
  assert.equal(buildConversationOutline(source, { ...args, pathId: 'alternate' }).totalMessages, 2);
  source.conversation.currentPathId = null; assert.throws(() => buildConversationOutline(source, args));
  assert.throws(() => buildConversationOutline(source, { ...args, pathId: 'foreign' }));
});
await check('阅读标注只改标注元信息，正文、版本、平台角色及Q/A原样', () => {
  const state = { conversations: [unknown.conversation], paths: unknown.paths, messages: structuredClone(unknown.messages), qas: [], versions: [{ id: 'v-u1', text: '原始正文' }] };
  const version = JSON.stringify(state.versions), text = state.messages[0].text;
  labelMessageRole(state, { ...args, pathId: 'path', messageId: 'u1', role: 'user', expectedVersionId: 'v-u1' });
  assert.equal(state.messages[0].confirmedRole, 'user'); assert.equal(state.messages[0].role, 'unknown'); assert.equal(state.messages[0].text, text); assert.equal(JSON.stringify(state.versions), version); assert.equal(state.qas.length, 0);
  labelMessageRole(state, { ...args, pathId: 'path', messageId: 'u1', role: 'unknown', expectedVersionId: 'v-u1' }); assert.equal(state.messages[0].confirmedRole, 'unknown');
});
await check('过期版本、跨项目、跨路径、错误标注和平台角色替换均失败且不改资料', () => {
  const state = { conversations: [data.conversation], paths: data.paths, messages: structuredClone(data.messages) }, before = JSON.stringify(state);
  for (const override of [{ expectedVersionId: 'old' }, { projectId: 'foreign' }, { pathId: 'other' }, { role: 'admin' }, { messageId: 'q1', expectedVersionId: 'v-q1' }]) {
    assert.throws(() => labelMessageRole(state, { ...args, pathId: 'path', messageId: 'unknown', role: 'assistant', expectedVersionId: 'v-unknown', ...override })); assert.equal(JSON.stringify(state), before);
  }
});
await check('一轮超过80条回答和工具仍列出全部成员，不被目录页大小截断', () => {
  const source = structuredClone(data); source.messages = [message('many-q', 'user'), ...Array.from({ length: 123 }, (_, i) => message(`many-${i}`, i % 2 ? 'tool' : 'assistant'))]; source.paths[0].messageIds = source.messages.map(row => row.id); source.qas = [];
  const outline = buildConversationOutline(source, args); assert.equal(outline.rounds.length, 1); assert.equal(outline.rounds[0].responseMessageIds.length, 123);
});
await check('目录推导不改变输入资料，输出改动不改变来源', () => {
  const before = JSON.stringify(data); const outline = buildConversationOutline(data, args); assert.equal(JSON.stringify(data), before);
  outline.rounds[1].messageIds.pop(); outline.path.messageIds.pop(); outline.paths[0].messageIds.pop(); outline.conversation.title = '输出修改'; assert.equal(JSON.stringify(data), before);
});
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/V07_OUTLINE_VALIDATION_REPORT.json', import.meta.url), JSON.stringify({ version: EXTENSION_VERSION, passed: checks.length, failed: failures.length, checks, failures, scope: 'Synthetic domain fixtures, no real user/browser data', checkedAt: new Date().toISOString() }, null, 2));
if (failures.length) process.exitCode = 1;
