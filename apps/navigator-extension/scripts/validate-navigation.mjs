import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXTENSION_VERSION } from '../domain/common.js';
import { visibleSegments, qaNavigation, conversationOverview, topicGroups, resolveReadingPosition } from '../domain/navigation.js';

// Synthetic metadata only: includes branch sharing, multi-topic references and stale positions.
const segment = (id, conversationId, pathId, qaIds, topicIds = [], extra = {}) => ({ id, conversationId, pathId, qaIds, topicIds, ordinal: 1, active: true, organizationStatus: 'unorganized', ...extra });
const view = { project: { id: 'p' }, conversations: [
  { id: 'unknown', currentPathId: 'u', lastCapturedAt: '2000-01-01' },
  { id: 'first', currentPathId: 'a', sourceTime: { value: '2025-01-01T00:00:00Z' } },
  { id: 'second', currentPathId: 'b', sourceTime: { value: '2025-02-01T00:00:00Z' } },
  { id: 'empty', currentPathId: 'e' }
], paths: [{ id: 'a', conversationId: 'first' }, { id: 'alternate', conversationId: 'first' }, { id: 'b', conversationId: 'second' }, { id: 'u', conversationId: 'unknown' }, { id: 'e', conversationId: 'empty' }],
topics: [{ id: 'blue', name: '产品', color: '#2563eb' }, { id: 'cyan', name: '界面', color: '#0891b2' }],
qas: [{ id: 'q1', conversationId: 'first', pathId: 'a', ordinal: 1 }, { id: 'q2', conversationId: 'first', pathId: 'a', ordinal: 2, status: 'unanswered' },
  { id: 'qa', conversationId: 'first', pathId: 'alternate', ordinal: 1 }, { id: 'qb', conversationId: 'second', pathId: 'b', ordinal: 1 }, { id: 'qu', conversationId: 'unknown', pathId: 'u', ordinal: 1 }],
segments: [segment('s-u', 'unknown', 'u', ['qu']), segment('s-2', 'first', 'a', ['q2'], ['cyan'], { ordinal: 2, needsReview: true }),
  segment('s-1', 'first', 'a', ['q1'], ['blue', 'cyan'], { organizationStatus: 'confirmed' }), segment('s-a', 'first', 'alternate', ['qa']),
  segment('s-b', 'second', 'b', ['qb'], [], { pendingSuggestionIds: ['pending'] }), segment('inactive', 'first', 'a', [], [], { active: false })] };
const checks = [], failures = [], original = JSON.stringify(view);
async function check(name, fn) { try { await fn(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
await check('默认仅列出各对话当前路径，保留真实片段顺序', () => { assert.deepEqual(visibleSegments(view).map(row => row.id), ['s-1', 's-2', 's-b', 's-u']); });
await check('显式选择分支及全部路径分别生效，不遗漏分支问答', () => {
  assert.deepEqual(visibleSegments(view, { conversationId: 'first', filterConversationId: 'first', pathId: 'alternate' }).map(row => row.id), ['s-a']);
  assert.equal(qaNavigation(view, visibleSegments(view, { allPaths: true })).length, 5);
});
await check('错误跨对话路径不能隐藏正确当前路径', () => { assert.deepEqual(visibleSegments(view, { conversationId: 'second', pathId: 'alternate', filterConversationId: 'second' }).map(row => row.id), ['s-b']); });
await check('主题、未分类、待确认及原文需复核筛选可组合', () => {
  assert.deepEqual(visibleSegments(view, { topicId: 'cyan' }).map(row => row.id), ['s-1', 's-2']);
  assert.deepEqual(visibleSegments(view, { topicId: '__none', stateFilter: 'pending' }).map(row => row.id), ['s-b']);
  assert.deepEqual(visibleSegments(view, { stateFilter: 'needs_review' }).map(row => row.id), ['s-2']);
});
await check('问答列表保留未回答轮次并排除丢失或跨分支引用', () => {
  const rows = qaNavigation(view, [{ ...view.segments[1], qaIds: ['q2', 'missing', 'qa', 'qb'] }]);
  assert.deepEqual(rows.map(row => row.qa.id), ['q2']); assert.equal(rows[0].qa.status, 'unanswered');
});
await check('片段问答范围只展开其全部真实成员', () => { assert.deepEqual(qaNavigation(view, visibleSegments(view), 's-2').map(row => row.qa.id), ['q2']); });
await check('对话总览保留无用户问题的对话，数量按路径计算', () => {
  const overview = conversationOverview(view, visibleSegments(view));
  assert.equal(overview.length, 4); assert.equal(overview.find(row => row.conversation.id === 'empty').qaCount, 0);
  assert.equal(overview.find(row => row.conversation.id === 'first').qaCount, 2);
});
await check('多主题分组共享片段身份且保留持久颜色，不复制问答', () => {
  const groups = topicGroups(view, visibleSegments(view));
  assert.equal(groups.find(row => row.id === 'blue').color, '#2563eb'); assert.equal(groups.find(row => row.id === 'cyan').qaCount, 2);
  assert.equal(groups.find(row => row.id === 'blue').segments[0], groups.find(row => row.id === 'cyan').segments[0]);
  assert.equal(groups.at(-1).id, '__none');
});
const position = { projectId: 'p', conversationId: 'first', pathId: 'a', qaId: 'q2', segmentId: 'obsolete-segment' };
await check('片段拆分合并或重新整理后，继续阅读按真实QA恢复', () => { assert.equal(resolveReadingPosition(view, position).segment.id, 's-2'); });
await check('失效、跨项目及跨路径阅读位置安全拒绝', () => {
  for (const value of [{ ...position, projectId: 'other' }, { ...position, pathId: 'alternate' }, { ...position, qaId: 'deleted' }, { ...position, conversationId: 'second' }, null]) assert.equal(resolveReadingPosition(view, value), null);
  assert.equal(resolveReadingPosition(null, position), null);
});
await check('来源时间未知时保留来源顺序，不拿采集时间替代', () => {
  const unknown = structuredClone(view); unknown.conversations.forEach(row => delete row.sourceTime);
  assert.deepEqual(visibleSegments(unknown).map(row => row.id), ['s-u', 's-1', 's-2', 's-b']);
});
await check('导航推导不修改来源、分组或阅读位置数据', () => { assert.equal(JSON.stringify(view), original); });
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/V04_NAVIGATION_VALIDATION_REPORT.json', import.meta.url), JSON.stringify({ version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
