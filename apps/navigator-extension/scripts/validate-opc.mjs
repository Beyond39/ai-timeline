import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { OPC_STORES, opcMutation, timelinePage, assertOPC, syncCards } from '../domain/opc.js';
import { readingParts } from '../domain/qa-content.js';
import { readableStatic } from '../domain/qa-content.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { STORES } from '../storage/database.js';

const empty = () => Object.fromEntries(STORES.map(s => [s, []]));
const state = empty(), project = createProject(state, 'OPC acceptance');
const messages = [
  { id: 'q', role: 'user', text: '问题' },
  { id: 'analysis', role: 'assistant', channel: 'analysis', text: '内部分析' },
  { id: 'status', role: 'assistant', channel: 'commentary', text: '已搜索 6 个网站' },
  { id: 'call', role: 'assistant', recipient: 'browser', text: 'search()' },
  { id: 'tool', role: 'tool', text: '工具结果' },
  { id: 'empty', role: 'assistant', text: '' },
  { id: 'a1', role: 'assistant', status: 'complete', text: '# 标题\n\n- 列表\n\n```js\nconst x = 1;\n```' },
  { id: 'a2', role: 'assistant', status: 'complete', text: '| 项 | 值 |\n| --- | --- |\n| A | B |' },
  { id: 'q2', role: 'user', text: '第二问', created_at: '2026-10-01T03:00:00Z' },
  { id: 'a3', role: 'assistant', status: 'in_progress', text: '尚未完成' }
];
const payload = { provider: 'test', conversations: [{ id: 'conv', title: '来源', messages }] };
const input = async p => (await parseImport(JSON.stringify(p), 'opc-fixture.json')).conversations[0];
await saveConversation(state, await input(payload), project.id);
assert.equal(state.qaCards.length, 2);
const first = state.qaCards.find(c => c.ordinal === 1), second = state.qaCards.find(c => c.ordinal === 2);
assert.equal(first.visibleAnswerIds.length, 2);
assert.equal(first.questionTime.value, null);
assert.equal(second.status, 'generating');
const parts = readingParts(first.responseMessageIds.map(k => state.messages.find(m => m.id === k)));
assert.equal(readingParts([{ id: 'unique-1', role: 'assistant', text: '相同段落' }, { id: 'unique-2', role: 'assistant', text: '相同段落' }]).length, 2);
assert.equal(parts.length, 2); assert.ok(parts[0].text.includes('# 标题')); assert.ok(parts[1].text.includes('| A | B |'));
assert.equal(state.versions.length, messages.length); assert.equal(state.snapshots[0].rawSource.messages.length, messages.length);
console.log('PASS 一轮归组、可见片段合并、工具/状态/空正文隐藏、原始数据保留、未知时间与生成状态');

opcMutation(state, 'metadata', { projectId: project.id, cardId: first.id, tags: ['标签'], notes: '备注', title: '自定义标题' });
const theme = opcMutation(state, 'timeline', { projectId: project.id, name: '主题 A' });
const theme2 = opcMutation(state, 'timeline', { projectId: project.id, name: '主题 B' });
for (const t of [theme, theme2]) opcMutation(state, 'membership', { projectId: project.id, timelineId: t.id, cardIds: [first.id, second.id] });
opcMutation(state, 'membership', { projectId: project.id, timelineId: theme.id, cardIds: [first.id], remove: true });
assert.ok(state.memberships.some(m => m.cardId === first.id && m.timelineId === theme2.id));
assert.ok(state.memberships.some(m => m.cardId === first.id && state.timelines.find(t => t.id === m.timelineId).kind === 'source'));
const before = state.qaCards.length;
await saveConversation(state, await input(payload), project.id);
assert.equal(state.qaCards.length, before); assert.equal(state.qaMetadata[0].notes, '备注');
assert.equal(state.qaMetadata[0].title, '自定义标题');
payload.conversations[0].messages.at(-1).text = '完整答案'; payload.conversations[0].messages.at(-1).status = 'complete';
await saveConversation(state, await input(payload), project.id);
assert.equal(state.qaCards.length, before); assert.equal(second.status, 'answered');
console.log('PASS 重复及增量导入、元数据保留、多线归属、移除主题成员不破坏其他引用');

const otherInput = await input({ provider: 'test', conversations: [{ id: 'other', title: '另一条来源', messages: [{ id: 'other-q', role: 'user', text: '跨线目标' }, { id: 'other-a', role: 'assistant', text: '目标正文' }] }] });
await saveConversation(state, otherInput, project.id);
const target = state.qaCards.find(c => c.sourceTitle === '另一条来源');
const relation = opcMutation(state, 'relationship', { projectId: project.id, fromCardId: first.id, toCardId: target.id, type: '引用', directed: true, description: '说明' });
assert.equal(relation.toCardId, target.id); assert.equal(relation.directed, true);
opcMutation(state, 'relationship', { projectId: project.id, relationshipId: relation.id, fromCardId: target.id, toCardId: first.id, type: '自定义', directed: false, description: '新说明' });
assert.equal(state.relationships.length, 1); assert.ok(state.relationTypes.some(t => t.name === '自定义'));
opcMutation(state, 'layout', { projectId: project.id, positions: { [first.id]: { x: 10, y: 20 } }, viewport: { x: 3, y: 4, zoom: .8 } });
assertOPC(state);
assert.throws(() => opcMutation(state, 'layout', { projectId: project.id, positions: { [first.id]: { x: NaN, y: 0 } } }));
assert.throws(() => opcMutation(state, 'relationship', { projectId: project.id, fromCardId: first.id, toCardId: first.id, type: '引用' }));
assert.throws(() => opcMutation(state, 'membership', { projectId: project.id, timelineId: state.timelines.find(t => t.kind === 'source').id, cardIds: [first.id], remove: true }));
const restored = empty(), backup = exportProject(state, project.id); validateBackup(backup);
const malformed = structuredClone(backup); malformed.records.qaMetadata[0].tags = 'invalid'; assert.throws(() => validateBackup(malformed));
const missingReference = structuredClone(backup); missingReference.records.relationships[0].toCardId = 'missing'; assert.throws(() => validateBackup(missingReference));
const duplicateLogicalCard = structuredClone(backup); duplicateLogicalCard.records.qaCards.push({ ...duplicateLogicalCard.records.qaCards[0], id: 'duplicate-card' }); assert.throws(() => validateBackup(duplicateLogicalCard));
const result = restoreBackup(restored, JSON.parse(JSON.stringify(backup))); assertOPC(restored);
assert.equal(restored.qaMetadata[0].notes, '备注'); assert.equal(restored.relationships[0].description, '新说明');
assert.deepEqual(Object.values(restored.canvasLayouts[0].positions)[0], { x: 10, y: 20 });
assert.ok(restored.qaCards.some(c => c.id === restored.relationships[0].fromCardId));
const restoredCount = restored.qaCards.length; syncCards(restored, restored.conversations[0]); assert.equal(restored.qaCards.length, restoredCount);
console.log('PASS 跨来源有向关系、编辑和自定义类型、坐标校验、备份恢复并保留标注/关系/布局');

const structured = await input({ provider: 'test', conversations: [{ id: 'rich', messages: [{ id: 'u', role: 'user', text: '富文本' }, { id: 'a', role: 'assistant', content: { parts: [{ type: 'heading', text: '标题' }, { type: 'table', headers: ['列1', '列2'], rows: [['甲', '乙']] }, { type: 'list', items: ['一', '二'] }] } }, { id: 'html', role: 'assistant', text: '<div className="card"><h2>静态正文</h2><script>alert(1)</script><p>可读内容</p></div>' }] }] });
assert.ok(structured.messages[1].text.includes('| 甲 | 乙 |')); assert.ok(structured.messages[1].text.includes('- 一'));
assert.ok(structured.messages[2].text.includes('静态正文')); assert.ok(!structured.messages[2].text.includes('className')); assert.ok(!structured.messages[2].text.includes('alert'));
assert.ok(readableStatic('export default function Card() { return (<div><h2>组件标题</h2><p>组件正文</p></div>); }').includes('组件正文'));
console.log('PASS 结构化标题/列表/表格及组件静态转换');

const large = { ...state, ...Object.fromEntries(OPC_STORES.map(s => [s, structuredClone(state[s])])) };
for (let i = 0; i < 10000; i++) { const c = { ...first, id: `large-${i}`, ordinal: i, questionTime: { value: i % 3 ? new Date(1700000000000 + i * 3600000).toISOString() : null } }; large.qaCards.push(c); large.memberships.push({ id: `ml-${i}`, cardId: c.id, timelineId: theme2.id }); }
const start = performance.now(), page = timelinePage(large, { limit: 60 });
assert.equal(page.cards.length, 60); assert.ok(page.nextOffset); assert.ok(page.cards.every(c => c.questionTime.value));
assert.ok(performance.now() - start < 2000);
console.log(`PASS 10000 轮目录排序与分页 ${Math.round(performance.now() - start)}ms，正文不进入列表`);
console.log('OPC domain acceptance passed');
