import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixturePayload } from '../validation/fixture.mjs';
import { STORES } from '../storage/database.js';
import { EXTENSION_VERSION } from '../domain/common.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation, moveConversation } from '../domain/captures.js';
import { editSegment, undoLatest } from '../domain/edits.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { generateRuleSuggestion, applyOrganizationSuggestion, getSuggestion } from '../domain/organization.js';
import { previewTopicChange, applyTopicChange } from '../domain/topics.js';
import { latestDraftRecord } from '../domain/drafts.js';
import { findTextMatches } from '../domain/search.js';

const checks = [], failures = [];
const fresh = () => ({ ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 });
async function check(name, fn) {
  try { await fn(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function seedOrganized() {
  const state = fresh(), project = createProject(state, '回归验证 · 隔离样例');
  const input = await parseImport(JSON.stringify(fixturePayload()), 'regression-example.json');
  for (const c of input.conversations) await saveConversation(state, c, project.id);
  const conversation = state.conversations[0], pathId = conversation.currentPathId;
  const suggestion = await generateRuleSuggestion(state, { conversationId: conversation.id, pathId });
  await applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
  return { state, project, input, conversation, pathId };
}
async function changeSource(env, segment) {
  const qa = env.state.qas.find(q => segment.qaIds.includes(q.id) && q.assistantMessageIds.length);
  const message = env.state.messages.find(m => m.id === qa.assistantMessageIds[0]);
  const input = structuredClone(env.input.conversations[0]);
  input.messages.find(m => m.sourceMessageId === message.sourceMessageId).text += '\n回归验证：后来更新的正文。';
  await saveConversation(env.state, input, env.project.id);
}

for (const operation of ['rename', 'topics']) await check(`${operation} 不将历史整理证据替换为更新后的正文`, async () => {
  const env = await seedOrganized(), segment = env.state.segments.find(s => s.active && s.qaIds.length > 1);
  const evidence = structuredClone(segment.organization.evidence), signatures = structuredClone(segment.organization.qaSignatures);
  await changeSource(env, segment);
  assert.equal(segment.needsReview, true);
  editSegment(env.state, { operation, segmentId: segment.id, baseRevision: segment.revision, title: '更新导航标题', names: '回归验证' });
  assert.deepEqual(segment.organization.evidence, evidence);
  assert.deepEqual(segment.organization.qaSignatures, signatures);
  assert.equal(segment.needsReview, true);
  validateBackup(exportProject(env.state, env.project.id));
});

await check('拆分已确认段保留各成员的原始证据版本', async () => {
  const env = await seedOrganized(), segment = env.state.segments.find(s => s.active && s.qaIds.length > 1);
  const evidence = structuredClone(segment.organization.evidence), memberIds = [...segment.qaIds];
  await changeSource(env, segment);
  editSegment(env.state, { operation: 'split', segmentId: segment.id, baseRevision: segment.revision, afterQAId: segment.qaIds[0] });
  for (const child of env.state.segments.filter(s => s.active && s.qaIds.every(key => memberIds.includes(key)))) {
    assert.deepEqual(child.organization.evidence, evidence.filter(ref => child.qaIds.includes(ref.qaId)));
    assert.ok(child.organization.qaSignatures.every(ref => child.qaIds.includes(ref.qaId)));
  }
  validateBackup(exportProject(env.state, env.project.id));
});

await check('合并两个已确认段保留两边的历史证据', async () => {
  const env = await seedOrganized(), segments = env.state.segments.filter(s => s.active && s.pathId === env.pathId).sort((a,b) => a.ordinal-b.ordinal);
  const evidence = structuredClone([...segments[0].organization.evidence, ...segments[1].organization.evidence]);
  await changeSource(env, segments[0]);
  editSegment(env.state, { operation: 'merge', segmentId: segments[0].id, baseRevision: segments[0].revision, otherSegmentId: segments[1].id, otherBaseRevision: segments[1].revision });
  assert.deepEqual(segments[0].organization.evidence, evidence);
  validateBackup(exportProject(env.state, env.project.id));
});

await check('未整理段与已整理段合并时保留后段证据', async () => {
  const env = await seedOrganized(), segments = env.state.segments.filter(s => s.active && s.pathId === env.pathId).sort((a,b) => a.ordinal-b.ordinal);
  delete segments[0].organization; segments[0].organizationStatus = 'unorganized'; segments[0].manual = false;
  const evidence = structuredClone(segments[1].organization.evidence);
  editSegment(env.state, { operation: 'merge', segmentId: segments[0].id, baseRevision: segments[0].revision, otherSegmentId: segments[1].id, otherBaseRevision: segments[1].revision });
  assert.ok(segments[0].organization, '合并后的活动片段必须保留已整理一侧的来源信息');
  assert.deepEqual(segments[0].organization.evidence.filter(ref => segments[1].qaIds.includes(ref.qaId)), evidence);
  validateBackup(exportProject(env.state, env.project.id));
});

await check('补采用户问题改变回答归属后仍可备份历史整理证据', async () => {
  const env = await seedOrganized(), originalQA = env.state.qas.find(q => q.pathId === env.pathId && q.ordinal === 1);
  const previous = env.state.segments.find(s => s.active && s.qaIds.includes(originalQA.id));
  const evidence = structuredClone(previous.organization.evidence);
  const input = fixturePayload();
  input.conversations[0].messages.splice(1, 0, { id: 'newly-observed-user', role: 'user', text: '合成补采：之前页面未显示的用户追问。' });
  const parsed = await parseImport(JSON.stringify(input), 'regression-example.json');
  await saveConversation(env.state, parsed.conversations[0], env.project.id);
  assert.equal(previous.needsReview, true);
  assert.deepEqual(previous.organization.evidence, evidence);
  const backup = exportProject(env.state, env.project.id); validateBackup(backup);
  const restored = fresh(), result = restoreBackup(restored, backup); validateBackup(exportProject(restored, result.projectId));
});

await check('历史证据校验仍拒绝其他问答及后来才产生的版本', async () => {
  const env = await seedOrganized(), originalQA = env.state.qas.find(q => q.pathId === env.pathId && q.ordinal === 1);
  const segment = env.state.segments.find(s => s.active && s.qaIds.includes(originalQA.id));
  const messageId = originalQA.assistantMessageIds[0], input = fixturePayload();
  input.conversations[0].messages.splice(1, 0, { id: 'newly-observed-user', role: 'user', text: '合成补采问题。' });
  input.conversations[0].messages.find(m => m.id === 'a-0').text += '\n补采之后产生的新正文版本。';
  const parsed = await parseImport(JSON.stringify(input), 'regression-example.json');
  await saveConversation(env.state, parsed.conversations[0], env.project.id);
  const backup = exportProject(env.state, env.project.id), row = backup.records.segments.find(s => s.id === segment.id);
  const ref = row.organization.evidence.find(ref => ref.messageId === messageId);
  ref.versionId = env.state.messages.find(m => m.id === messageId).currentVersionId;
  assert.throws(() => validateBackup(backup), /历史采集依据/);
  const other = env.state.qas.find(q => q.pathId === env.pathId && q.ordinal === 5), otherMessage = env.state.messages.find(m => m.id === other.assistantMessageIds[0]);
  ref.messageId = otherMessage.id; ref.versionId = otherMessage.currentVersionId;
  assert.throws(() => validateBackup(backup), /历史采集依据/);
});

await check('拆分和合并不清除源更新后的复核状态', async () => {
  const env = await seedOrganized(), segment = env.state.segments.find(s => s.active && s.qaIds.length > 1);
  const lastQA = env.state.qas.find(q => q.id === segment.qaIds.at(-1));
  const message = env.state.messages.find(m => m.id === lastQA.assistantMessageIds[0]);
  const input = structuredClone(env.input.conversations[0]);
  input.messages.find(m => m.sourceMessageId === message.sourceMessageId).text += '\n后半段更新。';
  await saveConversation(env.state, input, env.project.id);
  const split = editSegment(env.state, { operation: 'split', segmentId: segment.id, baseRevision: segment.revision, afterQAId: segment.qaIds[0] });
  const second = env.state.segments.find(s => s.active && s.pathId === env.pathId && s.qaIds.includes(lastQA.id));
  assert.equal(second.needsReview, true);
  const reviewed = await generateRuleSuggestion(env.state, { conversationId: env.conversation.id, pathId: env.pathId,
    startQAId: segment.qaIds[0], endQAId: segment.qaIds.at(-1) });
  await applyOrganizationSuggestion(env.state, { suggestionId: reviewed.id, baseRevision: reviewed.revision, reviewManual: true });
  assert.equal(segment.needsReview, false);
  editSegment(env.state, { operation: 'merge', segmentId: split.segmentId, baseRevision: segment.revision, otherSegmentId: second.id, otherBaseRevision: second.revision });
  assert.equal(segment.needsReview, true); assert.equal(segment.organizationStatus, 'needs_review');
});

await check('同毫秒的预览按持久序号选择，输入数组不被修改', async () => {
  const drafts = [{ id: 'z-old', createdAt: '2026-10-03T00:00:00Z', sequence: 1 }, { id: 'a-new', createdAt: '2026-10-03T00:00:00Z', sequence: 2 }];
  const before = structuredClone(drafts); assert.equal(latestDraftRecord(drafts).id, 'a-new'); assert.deepEqual(drafts, before);
});

await check('读取缓存结果一致，后续写入仍重新识别过期建议', async () => {
  const env = await seedOrganized(), pending = await generateRuleSuggestion(env.state, { conversationId: env.conversation.id, pathId: env.pathId });
  const cache = new Map(), cached = await getSuggestion(env.state, { suggestionId: pending.id }, cache);
  assert.deepEqual(cached, await getSuggestion(env.state, { suggestionId: pending.id }));
  assert.equal(cache.size, 1); assert.equal(cached.stale, false);
  await changeSource(env, env.state.segments.find(s => s.active && s.pathId === env.pathId && s.qaIds.length > 1));
  const changed = await getSuggestion(env.state, { suggestionId: pending.id });
  assert.equal(changed.stale, true); assert.equal(changed.status, 'needs_review');
  await assert.rejects(() => applyOrganizationSuggestion(env.state, { suggestionId: pending.id, baseRevision: pending.revision, reviewManual: true }), /源对话/);
});

await check('搜索偏移保留连字、组合字符、全角和 emoji 的原文边界', async () => {
  const text = 'ﬀ'.repeat(500) + ' Ｆｏｏ Café e\u0301 🤖 target-search';
  const target = findTextMatches(text, 'target-search', 1)[0]; assert.equal(text.slice(target.start, target.end), 'target-search');
  const full = findTextMatches(text, 'foo', 1)[0]; assert.equal(text.slice(full.start, full.end), 'Ｆｏｏ');
  assert.deepEqual(findTextMatches(text, 'é').map(r => text.slice(r.start, r.end)), ['é', 'e\u0301']);
  assert.deepEqual(findTextMatches('🤖 ﬀ', 'f'), [{ start: 3, end: 4 }]);
  assert.deepEqual(findTextMatches('ΟΣ ος οσ', 'οσ').map(r => 'ΟΣ ος οσ'.slice(r.start,r.end)), ['ΟΣ', 'ος', 'οσ']);
  assert.deepEqual(findTextMatches('<img onerror=alert(1)>', '   '), []);
});

await check('拒绝备份中的循环正文版本链', async () => {
  const env = await seedOrganized(), backup = exportProject(env.state, env.project.id);
  backup.records.versions[0].previousVersionId = backup.records.versions[0].id;
  assert.throws(() => validateBackup(backup), /版本.*循环|循环.*版本/);
});

await check('拒绝跨下一条用户问题的回答组', async () => {
  const env = await seedOrganized(), backup = exportProject(env.state, env.project.id);
  const qas = backup.records.qas.filter(q => q.pathId === env.pathId).sort((a,b) => a.ordinal-b.ordinal);
  qas[0].responseMessageIds.push(qas[1].responseMessageIds[0]);
  assert.throws(() => validateBackup(backup), /Q\/A|问答|轮次/);
});

await check('当前正文版本必须出现在消息的版本历史中', async () => {
  const env = await seedOrganized(), backup = exportProject(env.state, env.project.id), message = backup.records.messages[0];
  message.versionIds = message.versionIds.filter(id => id !== message.currentVersionId);
  assert.throws(() => validateBackup(backup), /当前.*版本|版本.*历史/);
});

await check('主题合并后仍可撤销整次整理并导出备份', async () => {
  const env = await seedOrganized(), original = env.state.topics.find(t => t.name === '聊天采集'), target = env.state.topics.find(t => t.name === '问答阅读');
  const preview = await previewTopicChange(env.state, { projectId: env.project.id, topicId: original.id, operation: 'merge', targetTopicId: target.id });
  await applyTopicChange(env.state, preview); undoLatest(env.state, env.project.id);
  validateBackup(exportProject(env.state, env.project.id));
});

await check('移动项目后可撤销整理，恢复备份后引用仍完整', async () => {
  const env = await seedOrganized(), target = createProject(env.state, '回归验证 · 目标项目');
  moveConversation(env.state, env.conversation, target.id); undoLatest(env.state, target.id);
  const backup = exportProject(env.state, target.id); validateBackup(backup);
  const next = fresh(), result = restoreBackup(next, backup); validateBackup(exportProject(next, result.projectId));
});

const report = { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
  scope: 'Synthetic regression fixtures only; exact historical evidence, backup corruption, undo and migration' };
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/REGRESSION_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
