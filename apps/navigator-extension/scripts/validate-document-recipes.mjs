import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORES } from '../storage/database.js';
import { createProject, saveConversation, moveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { composeDocument } from '../domain/document-export.js';
import { archiveDocumentRecipe, createDocumentPrint, documentRecipeSpecification, getDocumentPrint, getDocumentRecipe, listDocumentRecipes, materializeDocumentRecipe, normalizeDocumentSelection, renameDocumentRecipe, saveDocumentRecipe } from '../domain/document-recipes.js';
import { assembleDocumentSources } from '../storage/document-export.js';
import { exportProject, restoreBackup, validateBackup } from '../domain/backup.js';

const state = { ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 }, checks = [], failures = [];
const project = createProject(state, '资料包方案合成项目'), other = createProject(state, '另一项目');
const longText = '# 原始完整资料\n\n```js\nconst 代码 = "完整正文";\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 中文 | 42 |\n\n' + '不可变完整长正文。'.repeat(2000) + '\nRECIPE-ORIGINAL-END';
async function capture(sourceId, title, answer, projectId = project.id) {
  const input = await parseImport(JSON.stringify({ provider: 'recipe-synthetic', conversations: [{ id: sourceId, title, url: `https://example.org/c/${sourceId}`, messages: [{ id: `${sourceId}-q`, role: 'user', text: `${title}原问题`, created_at: '2026-10-01T00:00:00Z' }, { id: `${sourceId}-a`, role: 'assistant', text: answer }] }] }), 'synthetic-recipe.json');
  return { input: input.conversations[0], saved: await saveConversation(state, input.conversations[0], projectId) };
}
const first = await capture('first', '技术方案', longText), second = await capture('second', '学习资料', 'SECOND-ANSWER-END'), outsider = await capture('outside', '其他项目', 'OUTSIDE-END', other.id);
const records = projectId => ({ project: state.projects.find(row => row.id === projectId), ...Object.fromEntries(['conversations', 'paths', 'qas', 'segments', 'topics', 'messages', 'versions'].map(store => [store, state[store].filter(row => row.projectId === projectId)])) });
const sources = assembleDocumentSources(records(project.id), { projectId: project.id, conversationIds: [first.saved.conversationId, second.saved.conversationId] });
const [a, b] = sources.conversations;
const ref = (conversation, message) => ({ conversationId: conversation.id, pathId: conversation.pathId, messageId: message.id, versionId: message.versionId });
const selection = { title: '跨对话资料包', format: 'docx', includeUserPrompts: false, includeSourceAppendix: true, chapters: [
  { id: 'custom-first', title: '先读学习资料', items: [ref(b, b.messages[1]), ref(a, a.messages[1]), ref(a, a.messages[0])] },
  { id: 'empty-chapter', title: '待补充章节', items: [] } ] };
const check = async (name, action) => { try { await action(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); } };
let recipe;
await check('保存方案保留用户章节、段落顺序、空章节和当前排除的问题选择', () => {
  recipe = saveDocumentRecipe(state, { projectId: project.id, name: '我的资料包', selection }, { newId: 'synthetic-recipe', timestamp: '2026-10-10T00:00:00.000Z' });
  assert.deepEqual(recipe.chapters.map(chapter => chapter.id), ['custom-first', 'empty-chapter']);
  assert.deepEqual(recipe.chapters[0].items.map(item => item.messageId), [b.messages[1].id, a.messages[1].id, a.messages[0].id]);
  assert.equal(recipe.chapters[1].items.length, 0); assert.equal(recipe.chapters[0].items.length, 3);
  const spec = documentRecipeSpecification(state, recipe); assert.deepEqual(spec.chapters[0].entries.map(entry => entry.text), ['SECOND-ANSWER-END', longText]);
  const withQuestions = documentRecipeSpecification(state, { ...recipe, includeUserPrompts: true }); assert.equal(withQuestions.chapters[0].entries.length, 3);
});
await check('关闭后的方案读取是独立副本，不污染持久记录与原文', () => {
  const saved = JSON.stringify(state), loaded = getDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id }); loaded.name = '副本修改'; loaded.chapters.reverse();
  assert.equal(JSON.stringify(state), saved); assert.equal(listDocumentRecipes(state, { projectId: project.id })[0].name, '我的资料包');
});
await check('同一来源更新后，已存方案读取确切旧版完整正文而非latest替换', async () => {
  await capture('first', '技术方案更新', 'RECIPE-NEW-CURRENT-END');
  const current = state.messages.find(row => row.id === a.messages[1].id); assert.notEqual(current.currentVersionId, a.messages[1].versionId);
  const data = materializeDocumentRecipe(state, getDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id }));
  assert.equal(data.conversations.find(row => row.id === a.id).messages.find(row => row.id === current.id).text, longText);
  assert.equal(documentRecipeSpecification(state, recipe).chapters[0].entries[1].source.versionId, a.messages[1].versionId);
  assert.equal(assembleDocumentSources(records(project.id), { projectId: project.id, conversationIds: [first.saved.conversationId] }).conversations[0].messages[1].text, 'RECIPE-NEW-CURRENT-END');
});
await check('重命名不改正文/章节，并发旧revision保存拒绝且不污染状态', () => {
  const oldRevision = recipe.revision, oldChapters = JSON.stringify(recipe.chapters);
  recipe = renameDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id, expectedRevision: oldRevision, name: '已重命名方案' }); assert.equal(JSON.stringify(recipe.chapters), oldChapters);
  const before = JSON.stringify(state); assert.throws(() => saveDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id, expectedRevision: oldRevision, selection, name: '覆盖错误' }), /其他页面更新/); assert.equal(JSON.stringify(state), before);
});
await check('另存为新方案保留历史refs与用户順序，原方案不变', () => {
  const original = JSON.stringify(getDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id }));
  const copy = saveDocumentRecipe(state, { projectId: project.id, sourceRecipeId: recipe.id, sourceRevision: recipe.revision, name: '另存副本', selection }, { newId: 'synthetic-recipe-copy' });
  assert.notEqual(copy.id, recipe.id); assert.deepEqual(copy.chapters, recipe.chapters); assert.equal(JSON.stringify(getDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id })), original);
});
await check('归档和恢复仅改变状态，引用仍可阅读，归档方案拒绝直接覆盖', () => {
  recipe = archiveDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id, expectedRevision: recipe.revision });
  assert.ok(!listDocumentRecipes(state, { projectId: project.id }).some(row => row.id === recipe.id)); assert.ok(listDocumentRecipes(state, { projectId: project.id, includeArchived: true }).some(row => row.id === recipe.id));
  assert.equal(documentRecipeSpecification(state, recipe).chapters[0].entries[1].text, longText);
  assert.throws(() => saveDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id, expectedRevision: recipe.revision, selection }), /已归档/);
  recipe = archiveDocumentRecipe(state, { projectId: project.id, recipeId: recipe.id, expectedRevision: recipe.revision, archived: false }); assert.equal(recipe.status, 'active');
});
await check('打印保存重建真实不可变正文，忽略调用方伪造text与document', () => {
  const altered = structuredClone(selection); altered.chapters[0].items[1].text = 'FORGED-BODY-DO-NOT-EXPORT';
  const saved = createDocumentPrint(state, { projectId: project.id, selection: altered, recipeId: recipe.id, expectedRevision: recipe.revision, document: { title: '伪造文档', chapters: [] } }, { newId: 'synthetic-print' });
  const output = getDocumentPrint(state, { snapshotId: saved.id }); assert.equal(output.document.chapters[0].entries[1].text, longText); assert.ok(!JSON.stringify(output).includes('FORGED-BODY-DO-NOT-EXPORT'));
});
await check('打印快照重开固定内容，不被后续源对话变化覆盖', async () => {
  const original = JSON.stringify(getDocumentPrint(state, { snapshotId: 'synthetic-print' })); await capture('first', '进一步更新', 'RECIPE-THIRD-CURRENT-END');
  assert.equal(JSON.stringify(getDocumentPrint(state, { snapshotId: 'synthetic-print' })), original);
});
await check('打印和方案拒绝跨project/path、错误version-owner和非法重复引用', () => {
  const out = assembleDocumentSources(records(other.id), { projectId: other.id, conversationIds: [outsider.saved.conversationId] }).conversations[0];
  const wrong = structuredClone(selection); wrong.chapters[0].items[0] = ref(out, out.messages[0]);
  const before = JSON.stringify(state); assert.throws(() => createDocumentPrint(state, { projectId: project.id, selection: wrong }), /不属于|已删除/); assert.equal(JSON.stringify(state), before);
  for (const mutation of [item => { item.pathId = a.pathId; }, item => { item.versionId = a.messages[1].versionId; }, item => { item.projectId = other.id; }]) { const bad = structuredClone(selection); mutation(bad.chapters[0].items[0]); assert.throws(() => normalizeDocumentSelection(state, { projectId: project.id, selection: bad }), /不属于|已删除/); }
  const repeated = structuredClone(selection); repeated.chapters[0].items.push(structuredClone(repeated.chapters[0].items[0])); assert.throws(() => normalizeDocumentSelection(state, { projectId: project.id, selection: repeated }), /重复/);
});
await check('metadata伪造或源阅读标注变化时不混用新旧metadata', () => {
  const bad = structuredClone(selection); bad.chapters[0].items[0].role = 'user'; assert.throws(() => normalizeDocumentSelection(state, { projectId: project.id, selection: bad }), /角色、阅读标注/);
  bad.chapters[0].items[0].role = 'assistant'; bad.chapters[0].items[0].sourceTime = { value: '1900-01-01', precision: 'message' }; assert.throws(() => normalizeDocumentSelection(state, { projectId: project.id, selection: bad }), /来源时间/);
});
await check('无问答未知角色可保存，旧人工标注快照不随新标注替换', () => {
  const message = state.messages.find(row => row.id === a.messages[0].id), version = state.versions.find(row => row.id === message.currentVersionId);
  const local = structuredClone(state), changed = local.messages.find(row => row.id === message.id), v = local.versions.find(row => row.id === version.id);
  changed.role = 'unknown'; changed.roleUnverified = true; changed.confirmedRole = null; v.role = 'unknown';
  const choose = { title: '未知角色资料', includeUserPrompts: false, chapters: [{ id: 'unknown', title: '正文', items: [{ conversationId: changed.conversationId, pathId: a.pathId, messageId: changed.id, versionId: v.id }] }] };
  const saved = saveDocumentRecipe(local, { projectId: project.id, selection: choose }, { newId: 'unknown-recipe' }); changed.confirmedRole = 'assistant';
  const spec = documentRecipeSpecification(local, saved); assert.equal(spec.chapters[0].entries.length, 1); assert.equal(spec.chapters[0].entries[0].source.confirmedRole, null); assert.equal(spec.chapters[0].entries[0].source.role, 'unknown');
  const again = saveDocumentRecipe(local, { projectId: project.id, recipeId: saved.id, expectedRevision: saved.revision, selection: choose }); assert.equal(again.chapters[0].items[0].confirmedRole, null);
});
await check('新方案和打印快照随完整备份恢复，历史IDs重建后仍引用相同原文', () => {
  const payload = exportProject(state, project.id); validateBackup(payload);
  const restored = { ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 }, result = restoreBackup(restored, payload), saved = restored.documentRecipes.find(row => row.name === recipe.name);
  assert.equal(saved.projectId, result.projectId); assert.notEqual(saved.id, recipe.id); assert.equal(documentRecipeSpecification(restored, saved).chapters[0].entries[1].text, longText);
  const print = restored.documentPrints[0]; assert.equal(print.document.project.id, result.projectId); assert.equal(print.document.chapters[0].entries[1].text, longText); assert.notEqual(print.document.chapters[0].entries[1].source.versionId, a.messages[1].versionId);
});
await check('旧schema2备份缺少新数组时兼容恢复为空方案/打印列表', () => {
  const legacy = exportProject(state, other.id); delete legacy.records.documentRecipes; delete legacy.records.documentPrints; delete legacy.records.conversationLinks; validateBackup(legacy);
  const restored = { ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 }, output = restoreBackup(restored, legacy); assert.equal(listDocumentRecipes(restored, { projectId: output.projectId }).length, 0); assert.equal(restored.documentPrints.length, 0);
});
await check('引用源被删时失败而保留方案；有引用的对话移动失败且数据完整', () => {
  const altered = structuredClone(state), versionId = recipe.chapters[0].items[1].versionId; altered.versions = altered.versions.filter(row => row.id !== versionId);
  assert.throws(() => materializeDocumentRecipe(altered, recipe), /已删除/); assert.equal(getDocumentRecipe(altered, { projectId: project.id, recipeId: recipe.id }).name, recipe.name);
  const before = JSON.stringify(state); assert.throws(() => moveConversation(state, state.conversations.find(row => row.id === a.id), other.id), /资料包或关联引用/); assert.equal(JSON.stringify(state), before);
});

fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/DOCUMENT_RECIPES_VALIDATION_REPORT.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticDataOnly: true, passed: checks.length, failed: failures.length, checks, failures, scope: 'Actual persistence domains, immutable history, saved selection order, concurrent revisions, print snapshot authenticity and backup restore. Browser/Word/WPS visual rendering not asserted.' }, null, 2));
if (failures.length) process.exitCode = 1;
