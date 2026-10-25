import assert from 'node:assert/strict';
import { OPC_STORES, opcMutation, timelinePage } from '../domain/opc.js';
import { turnStatus, readingParts, structuredText } from '../domain/qa-content.js';
import { comparePositions } from '../ui/opc.js';
import { AnnotationDrafts } from '../ui/opc-drafts.js';
import { canvasEdge } from '../domain/canvas-layout.js';
import { parseMarkdown } from '../ui/body.js';
import { timeLabel } from '../ui/dom.js';

const state = { ...Object.fromEntries(OPC_STORES.map(k => [k, []])), projects: [{ id: 'p' }] };
for (let i = 0; i < 150; i++) {
  state.qaCards.push({ id: `c${i}`, validity: { state: 'ACTIVE' }, projectId: 'p', ordinal: i, conversationId: 'conv', questionPreview: `问题 ${i}`, questionTime: { value: new Date(1700000000000 + i * 3600000).toISOString() } });
  state.memberships.push({ id: `m${i}`, projectId: 'p', cardId: `c${i}`, timelineId: 't' });
}
state.timelines.push({ id: 't', projectId: 'p', kind: 'source', name: '来源' });
const first = timelinePage(state), last = timelinePage(state, { offset: 120 });
assert.deepEqual(first.timeRange, last.timeRange);
const a = comparePositions(first.cards, 1800, first.timeRange), b = comparePositions(last.cards, 1800, last.timeRange);
assert.equal(a.min, b.min); assert.equal(a.max, b.max); assert.ok(a.positions.get('c59') < b.positions.get('c120'));
const reveal = timelinePage(state, { revealCardId: 'c145' }); assert.equal(reveal.offset, 120); assert.equal(reveal.cards.length, 30); assert.ok(reveal.cards.some(c => c.id === 'c145'));
assert.equal(timelinePage(state, { offset: 99999 }).offset, 120);
assert.equal(first.memberships.length, 60);
const pinned = timelinePage(state, { canvasCardIds: ['c149'] }); assert.equal(pinned.cards.length, 60); assert.equal(pinned.pinnedCards[0].id, 'c149');
console.log('PASS 翻页共享完整时间范围、跨页导航保持相邻卡片、分页引用有界、跨页关联节点展开');

const metadataArgs = { projectId: 'p', cardId: 'c0', title: '标题', tags: ['标签'], notes: '原始备注' };
opcMutation(state, 'metadata', { ...metadataArgs, expectedRevision: 0 });
assert.throws(() => opcMutation(state, 'metadata', { ...metadataArgs, notes: '过期覆盖', expectedRevision: 0 }));
assert.equal(state.qaMetadata[0].notes, '原始备注');
const relation = opcMutation(state, 'relationship', { projectId: 'p', fromCardId: 'c0', toCardId: 'c149', type: '依赖', directed: true, expectedRevision: 0 });
opcMutation(state, 'relationship', { projectId: 'p', relationshipId: relation.id, fromCardId: 'c0', toCardId: 'c149', type: '引用', directed: true, expectedRevision: 1 });
assert.throws(() => opcMutation(state, 'relationship', { projectId: 'p', relationshipId: relation.id, remove: true, expectedRevision: 1 }));
assert.equal(state.relationships.length, 1); assert.equal(state.relationships[0].type, '引用');
opcMutation(state, 'layout', { projectId: 'p', positions: { c0: { x: 0, y: 0 }, c149: { x: 300, y: 0 } } });
opcMutation(state, 'layout', { projectId: 'p', positions: { c0: { x: 10, y: 20 } }, expectedPositions: { c0: { x: 0, y: 0 } } });
opcMutation(state, 'layout', { projectId: 'p', positions: { c149: { x: 320, y: 0 } }, expectedPositions: { c149: { x: 300, y: 0 } } });
assert.deepEqual(state.canvasLayouts[0].positions.c0, { x: 10, y: 20 });
const snapshot = structuredClone(state.canvasLayouts);
assert.throws(() => opcMutation(state, 'layout', { projectId: 'p', positions: { c149: { x: 350, y: 0 }, c0: { x: 90, y: 90 } }, expectedPositions: { c149: { x: 300, y: 0 }, c0: { x: 10, y: 20 } } }));
assert.deepEqual(state.canvasLayouts, snapshot);
console.log('PASS 标注/关系过期版本拒绝、独立节点并发移动可合并、同节点冲突无部分写入');

class Storage {
  constructor() { this.values = new Map(); } get length() { return this.values.size; } key(i) { return [...this.values.keys()][i]; }
  getItem(k) { return this.values.get(k) ?? null; } setItem(k, v) { this.values.set(k, v); } removeItem(k) { this.values.delete(k); }
}
const storage = new Storage(), session = new Storage(), draft = { title: '草稿标题', tags: '草稿标签', notes: '未保存备注', baseRevision: 3 };
const drafts = new AnnotationDrafts({ storage, session }); drafts.set('p', 'c0', draft); drafts.flush();
assert.equal(new AnnotationDrafts({ storage, session }).get('p', 'c0').notes, draft.notes);
const restarted = new AnnotationDrafts({ storage, session: new Storage() }); assert.equal(restarted.get('p', 'c0').baseRevision, 3);
restarted.set('p', 'c0', { ...draft, notes: '恢复后编辑' }); restarted.flush(); restarted.remove('p', 'c0'); assert.equal(storage.length, 0);
console.log('PASS 未保存元数据草稿在刷新与新会话中恢复，正式保存后清理草稿');

const question = { text: '问题' };
assert.equal(turnStatus(question, [{ role: 'tool', text: '已搜索' }, { role: 'assistant', channel: 'analysis', text: '分析' }]), 'generating');
assert.equal(turnStatus(question, [{ role: 'assistant', channel: 'analysis', streaming: 'generating', text: '进行中的分析' }]), 'generating');
assert.equal(turnStatus(question, [{ role: 'assistant', text: '部分答案' }, { role: 'assistant', text: '', contentStatus: 'body_unavailable' }]), 'generating');
const attachment = { id: 'attachment', role: 'assistant', text: '', attachments: [{ name: '图表.png' }], contentStatus: 'body_unavailable' };
assert.equal(turnStatus(question, [attachment]), 'generating'); assert.ok(readingParts([attachment])[0].text.includes('图表.png'));
assert.equal(turnStatus(question, [{ role: 'assistant', channel: 'analysis', streaming: 'generating', text: '思考' }, { role: 'assistant', text: '答案' }]), 'generating');
const code = structuredText({ type: 'code', language: 'md', text: '```js\nconst x = 1;\n```' }); assert.equal(parseMarkdown(code)[0].text, '```js\nconst x = 1;\n```');
const backward = canvasEdge({ x: 500, y: 0 }, { x: 0, y: 0 }); assert.equal(backward.start.x, 500); assert.equal(backward.end.x, 270);
const vertical = canvasEdge({ x: 0, y: 0 }, { x: 0, y: 400 }); assert.equal(vertical.start.y, 140); assert.equal(vertical.end.y, 400);
console.log('PASS 回答缺失/工具状态判断、附件静态引用、嵌套代码围栏、反向/垂直连线端点');
assert.ok(!timeLabel({ value: '2026-10-01T00:00:00Z', precision: 'date_only' }).includes('8:00'));
console.log('PASS 仅日期的时间来源不显示伪造的小时和分钟');
