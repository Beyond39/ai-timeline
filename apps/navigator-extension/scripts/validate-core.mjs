import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixturePayload } from '../validation/fixture.mjs';
import { STORES } from '../storage/database.js';
import { EXTENSION_VERSION } from '../domain/common.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { editSegment, undoLatest } from '../domain/edits.js';
import { assertPartition, rebuildIndexes } from '../domain/indexes.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { previewTopicChange, applyTopicChange } from '../domain/topics.js';
import { generateRuleSuggestion, getSuggestion, updateOrganizationSuggestion, applyOrganizationSuggestion, rejectOrganizationSuggestion, exportAnalysisPack, importOrganizationSuggestion } from '../domain/organization.js';

const fresh = () => ({ ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 });
const clone = structuredClone;
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function seed() {
  const state = fresh(), project = createProject(state, '域验证 · 隔离样例');
  const input = await parseImport(JSON.stringify(fixturePayload()), 'validation-example.json');
  for (const c of input.conversations) await saveConversation(state, c, project.id);
  const conversation = state.conversations[0]; return { state, project, conversation, input, args: { conversationId: conversation.id, pathId: conversation.currentPathId } };
}
const navigation = (state, pathId) => state.segments.filter(s => s.active && s.pathId === pathId).map(s => { const row = clone(s); delete row.revision; delete row.updatedAt; return row; });
const source = state => JSON.stringify([state.messages, state.versions, state.paths, state.qas, state.snapshots]);
const modelResult = (pack, groups) => ({ format: 'acvn-organization-result', schemaVersion: 1, analysisPackId: pack.id, conversationId: pack.conversationId, pathId: pack.pathId, sourceVersion: pack.sourceVersion, method: { kind: 'model', name: 'Synthetic structured-result fixture', version: 'validation-1' }, groups });

try {
  await check('真实数据结构 fixture：完整长回答、工具、未回答和多对话索引', async () => {
    const { state, args } = await seed(); assert.equal(state.qas.filter(q => q.pathId === args.pathId).length, 7);
    assert.equal(state.qas.filter(q => q.status === 'unanswered').length, 1);
    assert.ok(state.messages.some(m => m.role === 'assistant' && m.text.length > 1800)); assert.ok(state.messages.some(m => m.role === 'tool'));
    for (const p of state.paths) assertPartition(state, p.id);
  });
  await check('同源重复保存保留对象 ID；正文更新保留旧版本', async () => {
    const { state, project, input } = await seed(); const before = state.messages.map(m => m.id), versions = state.versions.length;
    await saveConversation(state, input.conversations[0], project.id); assert.deepEqual(state.messages.map(m => m.id), before); assert.equal(state.versions.length, versions);
    const changed = clone(input.conversations[0]); changed.messages.find(m => m.role === 'assistant').text += ' 正文更新';
    await saveConversation(state, changed, project.id); assert.equal(state.versions.length, versions + 1); assert.deepEqual(state.messages.map(m => m.id), before);
  });
  await check('规则预览及标题/标签编辑不改变地图或原文', async () => {
    const { state, args } = await seed(), before = source(state), nodes = clone(state.segments);
    const suggestion = await generateRuleSuggestion(state, args); assert.ok(suggestion.groups.length < suggestion.rangeQAIds.length); assert.equal(suggestion.status, 'pending');
    const edited = await updateOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision, groups: suggestion.groups.map((g,i) => ({ ...g, title: i ? g.title : '聊天采集方案 · 人工预览', topics: i ? g.topics : ['采集验证'] })) });
    assert.equal(edited.groups[0].title, '聊天采集方案 · 人工预览'); assert.deepEqual(state.segments, nodes); assert.equal(source(state), before);
  });
  await check('确认更新真实成员地图，整次撤销完整恢复组织前导航', async () => {
    const { state, args, project } = await seed(), before = navigation(state, args.pathId), original = source(state);
    const suggestion = await generateRuleSuggestion(state, args); await applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
    assert.equal(source(state), original); assert.equal(state.segments.filter(s => s.active && s.pathId === args.pathId).length, suggestion.groups.length);
    assert.ok(state.segments.some(s => s.active && s.organization?.evidence.length)); assertPartition(state, args.pathId);
    undoLatest(state, project.id); assert.deepEqual(navigation(state, args.pathId), before);
    assert.equal((await getSuggestion(state, { suggestionId: suggestion.id })).status, 'needs_review');
  });
  await check('人工标题标签边界保护；显式复核后才允许覆盖', async () => {
    const { state, args } = await seed(), first = state.segments[0];
    editSegment(state, { operation: 'rename', segmentId: first.id, baseRevision: first.revision, title: '受保护人工标题' });
    const suggestion = await generateRuleSuggestion(state, args); assert.equal(suggestion.groups[0].title, '受保护人工标题'); assert.equal(suggestion.manualConflicts.length, 0);
    const changed = await updateOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision, groups: suggestion.groups.map((g,i) => ({ ...g, title: i ? g.title : '主动改人工标题' })) });
    assert.ok(changed.manualConflicts.length); await assert.rejects(applyOrganizationSuggestion(state, { suggestionId: changed.id, baseRevision: changed.revision }), /人工/);
    assert.equal(first.title, '受保护人工标题'); await applyOrganizationSuggestion(state, { suggestionId: changed.id, baseRevision: changed.revision, reviewManual: true }); assert.equal(first.title, '主动改人工标题');
  });
  await check('拒绝建议保持原地图', async () => {
    const { state, args } = await seed(), before = clone(state.segments); const suggestion = await generateRuleSuggestion(state, args);
    const result = await rejectOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision }); assert.equal(result.status, 'rejected'); assert.deepEqual(state.segments, before);
  });
  await check('源正文更新使旧建议失效，并保留已确认边界与原文版本', async () => {
    const { state, args, input, project } = await seed(); const suggestion = await generateRuleSuggestion(state, args);
    const changed = clone(input.conversations[0]); changed.messages.find(m => m.role === 'assistant').text += ' 新正文'; await saveConversation(state, changed, project.id);
    const stale = await getSuggestion(state, { suggestionId: suggestion.id }); assert.ok(stale.stale); assert.equal(stale.status, 'needs_review');
    await assert.rejects(applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision }), /更新/);
    const newer = await generateRuleSuggestion(state, args); await applyOrganizationSuggestion(state, { suggestionId: newer.id, baseRevision: newer.revision });
    const before = state.segments.filter(s => s.active).map(s => [s.id,s.title,s.qaIds,s.topicIds]); changed.messages.find(m => m.role === 'assistant').text += ' 再次更新'; await saveConversation(state, changed, project.id);
    assert.deepEqual(state.segments.filter(s => s.active).map(s => [s.id,s.title,s.qaIds,s.topicIds]), before); assert.ok(state.segments.some(s => s.active && s.needsReview));
  });
  await check('模型稳定引用导入及多批上下文完整覆盖校验', async () => {
    const { state, args } = await seed(); const exported = await exportAnalysisPack(state, { ...args, batchSize: 2 }); assert.equal(exported.batches.length, 4); assert.ok(exported.batches[1].contextQAIds.length);
    const rules = await generateRuleSuggestion(state, args), model = modelResult(exported.pack, rules.groups);
    const imported = await importOrganizationSuggestion(state, { text: JSON.stringify(model) }); assert.equal(imported.method.kind, 'model'); assert.equal(imported.status, 'pending');
    const batched = { ...model }; delete batched.groups; batched.batches = exported.pack.batches.map(b => ({ batchId: b.id, groups: b.coreQAIds.map(qaId => ({ title: '批次中的真实成员', topics: ['验证'], qaIds: [qaId], reason: '仅整理本批目标成员', evidence: [b.qas.find(q => q.id === qaId).evidence[0]] })) }));
    const combined = await importOrganizationSuggestion(state, { text: JSON.stringify(batched) }); assert.equal(combined.groups.flatMap(g => g.qaIds).length, 7);
    batched.batches.pop(); await assert.rejects(importOrganizationSuggestion(state, { text: JSON.stringify(batched) }), /全部批次/);
    const invalid = clone(model); invalid.groups[0].evidence[0].versionId = 'missing-version'; await assert.rejects(importOrganizationSuggestion(state, { text: JSON.stringify(invalid) }), /版本/);
    await assert.rejects(updateOrganizationSuggestion(state, { suggestionId: rules.id, baseRevision: rules.revision, groups: invalid.groups }), /版本/);
    const duplicate = clone(model); duplicate.groups[0].qaIds.push(duplicate.groups[0].qaIds[0]); await assert.rejects(importOrganizationSuggestion(state, { text: JSON.stringify(duplicate) }), /覆盖|遗漏|重复/);
  });
  await check('分支引用不可跨路径合并', async () => {
    const state = fresh(), project = createProject(state, '分支验证');
    const nodes = { root: { parent: null, children: ['u'], message: null }, u: { parent: 'root', children: ['a','b'], message: { id: 'u', author: { role: 'user' }, content: { parts: ['分支问题'] } } }, a: { parent: 'u', children: [], message: { id: 'a', author: { role: 'assistant' }, content: { parts: ['分支 A'] } } }, b: { parent: 'u', children: [], message: { id: 'b', author: { role: 'assistant' }, content: { parts: ['分支 B'] } } } };
    const input = await parseImport(JSON.stringify([{ id: 'branch', title: '分支验证', current_node: 'a', mapping: nodes }]), 'branch-example.json'); const saved = await saveConversation(state, input.conversations[0], project.id);
    assert.equal(state.paths.length, 2); const rules = await generateRuleSuggestion(state, { conversationId: saved.conversationId, pathId: saved.pathId });
    const other = state.qas.find(q => q.pathId !== saved.pathId); const invalid = rules.groups.map(g => ({ ...g, qaIds: [other.id] }));
    await assert.rejects(updateOrganizationSuggestion(state, { suggestionId: rules.id, baseRevision: rules.revision, groups: invalid }), /跨对话|分支/);
  });
  await check('主题重命名/合并先预览，颜色一致且备份引用完整', async () => {
    const { state, args, project } = await seed(); const suggestion = await generateRuleSuggestion(state, args); await applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
    const pending = await generateRuleSuggestion(state, args); const topic = state.topics.find(t => t.name === '聊天采集'), color = topic.color;
    const impact = await previewTopicChange(state, { projectId: project.id, topicId: topic.id, operation: 'rename', name: '聊天抓取' }); assert.ok(impact.segmentCount > 0);
    await applyTopicChange(state, impact); assert.equal(topic.color, color); assert.ok((await getSuggestion(state, { suggestionId: pending.id })).stale);
    const target = state.topics.find(t => t.name === '问答阅读'); const merge = await previewTopicChange(state, { projectId: project.id, topicId: topic.id, operation: 'merge', targetTopicId: target.id });
    await applyTopicChange(state, merge); assert.ok(!state.topics.some(t => t.id === topic.id)); validateBackup(exportProject(state, project.id));
  });
  await check('V0.1 备份读取、V0.2 全关系备份恢复和过期建议保护', async () => {
    const legacy = JSON.parse(fs.readFileSync(new URL('../validation/v01-backup.json', import.meta.url))); validateBackup(legacy);
    const old = fresh(); const restored = restoreBackup(old, legacy); assert.ok(old.segments.some(s => s.title === 'V0.1 人工标题 · 必须保留' && s.manual)); validateBackup(exportProject(old, restored.projectId));
    const { state, args, project } = await seed(); const suggestion = await generateRuleSuggestion(state, args); await exportAnalysisPack(state, args); await applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
    await generateRuleSuggestion(state, args); const backup = exportProject(state, project.id); validateBackup(backup);
    const next = fresh(); const recovered = restoreBackup(next, backup); validateBackup(exportProject(next, recovered.projectId));
    assert.equal(next.messages.length, state.messages.length); assert.ok(next.suggestions.some(s => s.status === 'needs_review' && s.restoredRefState));
    const retained = next.suggestions.find(s => s.status === 'needs_review'); assert.ok((await getSuggestion(next, { suggestionId: retained.id })).stale);
  });
  await check('同毫秒修订按持久顺序连续撤销', async () => {
    const { state, project } = await seed(), first = state.segments[0], original = first.title;
    editSegment(state, { operation: 'rename', segmentId: first.id, baseRevision: first.revision, title: '第一次修改' });
    editSegment(state, { operation: 'rename', segmentId: first.id, baseRevision: first.revision, title: '第二次修改' });
    state.revisions[0].createdAt = state.revisions[1].createdAt;
    undoLatest(state, project.id); assert.equal(first.title, '第一次修改'); undoLatest(state, project.id); assert.equal(first.title, original);
  });
  await check('长人工分段不会被整理包的批次切开', async () => {
    const { state, args } = await seed(), first = state.segments[0];
    for (let i = 0; i < 4; i++) editSegment(state, { operation: 'merge', segmentId: first.id, baseRevision: first.revision });
    assert.equal(first.qaIds.length, 5);
    const exported = await exportAnalysisPack(state, { ...args, batchSize: 2 }); assert.equal(exported.pack.batches[0].coreQAIds.length, 5);
    assert.deepEqual(exported.pack.batches[0].beforeSegments[0].qaIds, first.qaIds); assert.ok(exported.pack.warnings.length);
  });
  await check('版本签名键顺序变化不会误标复核；生成状态变化会复核', async () => {
    const { state, args, conversation } = await seed(), suggestion = await generateRuleSuggestion(state, args);
    await applyOrganizationSuggestion(state, { suggestionId: suggestion.id, baseRevision: suggestion.revision });
    for (const segment of state.segments.filter(s => s.active && s.pathId === args.pathId)) for (const signature of segment.organization.qaSignatures) signature.messageVersionIds = Object.fromEntries(Object.entries(signature.messageVersionIds).reverse());
    rebuildIndexes(state, conversation); assert.ok(!state.segments.some(s => s.active && s.pathId === args.pathId && s.needsReview));
    state.messages.find(m => m.role === 'assistant').streaming = 'generating'; rebuildIndexes(state, conversation);
    assert.ok(state.segments.some(s => s.active && s.pathId === args.pathId && s.needsReview));
  });
  await check('大小写和全角重复主题只保留同一标签引用', async () => {
    const { state, project } = await seed(), first = state.segments[0];
    editSegment(state, { operation: 'topics', segmentId: first.id, baseRevision: first.revision, names: 'Foo，foo，Ｆｏｏ，工程，工程' });
    assert.equal(first.topicIds.length, 2); assert.equal(state.topics.find(t => t.id === first.topicIds[0]).name, 'Foo'); validateBackup(exportProject(state, project.id));
  });
  await check('V0.1 历史修订恢复后可撤销', async () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../validation/v01-backup.json', import.meta.url))), state = fresh();
    const result = restoreBackup(state, payload); undoLatest(state, result.projectId);
    assert.ok(!state.segments.some(s => s.active && s.title === 'V0.1 人工标题 · 必须保留')); validateBackup(exportProject(state, result.projectId));
  });
  await check('V0.1 重复标签无损规范化；V0.2 坏引用仍拒绝', async () => {
    const payload = JSON.parse(fs.readFileSync(new URL('../validation/v01-backup.json', import.meta.url))), state = fresh(), topicId = payload.records.topics[0].id;
    payload.records.segments[0].topicIds = [topicId,topicId]; for (const snapshot of [...payload.records.revisions[0].before,...payload.records.revisions[0].after]) snapshot.topicIds = [topicId,topicId];
    validateBackup(payload); const result = restoreBackup(state, payload); assert.equal(state.segments[0].topicIds.length, 1); undoLatest(state, result.projectId);
    const broken = exportProject(state, result.projectId); broken.records.segments[0].topicIds.push(broken.records.segments[0].topicIds[0]); assert.throws(()=>validateBackup(broken), /成员列表/);
  });
  const report = { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, checks, scope: 'Pure domain operations with explicit synthetic fixtures; no user data / browser / live model', automatedTestsRun: true };
  fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true }); fs.writeFileSync(new URL('../dist/CORE_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
